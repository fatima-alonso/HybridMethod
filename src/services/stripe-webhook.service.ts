import type Stripe from "stripe";

import type { Contract, WebhookEventStatus } from "@/generated/prisma/client";
import { getConfig } from "@/lib/config";
import { getPrisma, type Db } from "@/lib/prisma";
import { fromMinorUnits, getStripe, normalizeCurrency, STRIPE_WEBHOOK_EVENTS } from "@/lib/stripe";
import { applicationHref } from "@/content/landing";
import { formatPrice } from "@/utils/format";

import { recordAudit } from "./audit.service";
import {
  detachCheckoutSession,
  effectiveContractStatus,
  markContractPaid,
} from "./contract.service";
import { createPlanDeliveryLink } from "./delivery-link";
import { sendExtraPaymentAlertEmail, sendPaymentNotCompletedEmail } from "./email.service";
import { sendPaidNotifications } from "./payment-notifications.service";
import { recordFailedStripePayment, recordStripePayment } from "./payment.service";
import { createServicePeriod, nextOneMonthPeriod } from "./service-period.service";
import {
  sendSubscriptionNotices,
  type SubscriptionNotice,
} from "./subscription-notifications.service";
import {
  handleInvoicePaid,
  handleInvoicePaymentFailed,
  handleSubscriptionChanged,
  handleSubscriptionCheckoutCompleted,
  type SubscriptionEventContext,
} from "./stripe-subscription-webhook.service";
import { checkoutSessionDiscount } from "./discount.service";
import {
  auditChargedAmount,
  lockContract,
  notifyQuietly,
  UNPAID,
  type ContractWithRelations,
  type Handled,
} from "./stripe-webhook-shared";

/**
 * Webhooks de Stripe (RF-07, RN-11, SDD §7.5, DECISIONS A6, A26).
 *
 * La ruta verifica la firma y llama a `processStripeEvent`, que:
 * 1. Registra el evento en WebhookEvent (`stripeEventId` UNIQUE).
 * 2. En una transacción que bloquea esa fila: si ya se procesó, no hace nada (entregas repetidas);
 *    si no, aplica el evento y lo marca `processed` o `ignored`. Dos entregas simultáneas del mismo
 *    evento se serializan en ese bloqueo.
 * 3. Si el procesamiento falla, la transacción se revierte, el evento queda `failed` y la ruta
 *    responde 500 para que Stripe lo reintente.
 * 4. Después de confirmar la transacción, envía los correos. Un fallo de correo nunca revierte el
 *    pago.
 *
 * Pago único (Fase 5): `checkout.session.completed` (con `payment_status = paid`),
 * `checkout.session.async_payment_succeeded` y `checkout.session.async_payment_failed`.
 * Suscripción (Fase 6, `stripe-subscription-webhook.service`): `checkout.session.completed` en modo
 * `subscription` (solo liga la suscripción), `invoice.paid` (única fuente de los pagos),
 * `invoice.payment_failed` y `customer.subscription.*` (solo sincronizan). Los demás eventos se marcan
 * `ignored`. Nunca se usa `payment_intent.*` (A6).
 */

export type WebhookResult =
  | { status: "processed" | "ignored"; note?: string }
  | { status: "duplicate" }
  /** El evento no se puede aplicar y reintentarlo no ayudaría (p. ej. contrato inexistente). */
  | { status: "failed"; note: string };

export const HANDLED_EVENT_TYPES = STRIPE_WEBHOOK_EVENTS;

export async function processStripeEvent(
  event: Stripe.Event,
  db = getPrisma(),
  now: Date = new Date(),
  stripe: Pick<Stripe, "subscriptions" | "promotionCodes"> | null = getStripe(),
): Promise<WebhookResult> {
  await db.webhookEvent.createMany({
    data: [{ stripeEventId: event.id, eventType: event.type, createdAt: now }],
    skipDuplicates: true,
  });

  const notices: SubscriptionNotice[] = [];
  let handled: Handled | null;
  try {
    handled = await db.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<Array<{ status: WebhookEventStatus }>>`
          SELECT "status" FROM "webhook_events" WHERE "stripeEventId" = ${event.id} FOR UPDATE`;
        const status = rows[0]?.status;
        if (status === "processed" || status === "ignored") return null;

        notices.length = 0;
        const result = await dispatch(event, { tx, now, stripe, event, notices });
        await tx.webhookEvent.update({
          where: { stripeEventId: event.id },
          data: { status: result.status, error: result.note ?? null, processedAt: now },
        });
        return result;
      },
      { timeout: 20_000 },
    );
  } catch (error) {
    const name = error instanceof Error ? error.name : "error desconocido";
    console.error(`[stripe.webhook] No se pudo procesar ${event.type} (${event.id}):`, name);
    await db.webhookEvent
      .update({
        where: { stripeEventId: event.id },
        data: { status: "failed", error: name.slice(0, 200), processedAt: now },
      })
      .catch(() => undefined);
    throw error;
  }

  if (!handled) return { status: "duplicate" };
  if (handled.after) await handled.after(db);
  await sendSubscriptionNotices(notices, db);
  if (handled.status === "failed") return { status: "failed", note: handled.note ?? "" };
  return { status: handled.status, note: handled.note };
}

async function dispatch(event: Stripe.Event, context: SubscriptionEventContext): Promise<Handled> {
  const { tx } = context;
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      if (session.mode === "subscription") {
        return handleSubscriptionCheckoutCompleted(session, context);
      }
      if (session.mode !== "payment") return { status: "ignored", note: `mode_${session.mode}` };
      // `no_payment_required`: un cupón del 100 % (cortesía) dejó el total en $0 (DECISIONS A34).
      if (session.payment_status === "paid" || session.payment_status === "no_payment_required") {
        return fulfillCheckout(session, event, context);
      }
      if (session.payment_status === "unpaid") {
        // Pago asíncrono (p. ej. OXXO): se espera `async_payment_succeeded` o `_failed`.
        return { status: "processed", note: "awaiting_async_payment" };
      }
      return { status: "ignored", note: `payment_status_${session.payment_status}` };
    }
    case "checkout.session.async_payment_succeeded": {
      const session = event.data.object;
      if (session.mode !== "payment") return { status: "ignored", note: `mode_${session.mode}` };
      return fulfillCheckout(session, event, context);
    }
    case "checkout.session.async_payment_failed": {
      const session = event.data.object;
      if (session.mode !== "payment") return { status: "ignored", note: `mode_${session.mode}` };
      return failAsyncCheckout(session, event, tx);
    }
    case "invoice.paid":
      return handleInvoicePaid(event.data.object, context);
    case "invoice.payment_failed":
      return handleInvoicePaymentFailed(event.data.object, context);
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      return handleSubscriptionChanged(event.data.object, context);
    default:
      return { status: "ignored", note: "event_type_not_handled" };
  }
}

/** Contrato de la sesión (`metadata.contractId` o `client_reference_id`), bloqueado para el pago. */
function lockSessionContract(
  session: Stripe.Checkout.Session,
  tx: Db,
): Promise<ContractWithRelations | null> {
  return lockContract(session.metadata?.contractId ?? session.client_reference_id, tx);
}

function paymentIntentId(session: Stripe.Checkout.Session): string | null {
  const intent = session.payment_intent;
  if (!intent) return null;
  return typeof intent === "string" ? intent : intent.id;
}

function chargedAmount(session: Stripe.Checkout.Session, contract: Contract) {
  return {
    amount: session.amount_total === null ? contract.amount : fromMinorUnits(session.amount_total),
    currency: session.currency ? normalizeCurrency(session.currency) : contract.currency,
  };
}

/**
 * Pago único confirmado (SDD §8.2): Payment + ServicePeriod (un mes desde el pago, o desde que
 * termine el mes vigente si pagó por adelantado) + botón de entrega + contrato `active` o
 * `scheduled`, en la transacción del evento. Respeta un pago tardío (A20).
 */
async function fulfillCheckout(
  session: Stripe.Checkout.Session,
  event: Stripe.Event,
  { tx, now, stripe }: SubscriptionEventContext,
): Promise<Handled> {
  const contract = await lockSessionContract(session, tx);
  if (!contract) {
    console.error(`[stripe.webhook] La sesión ${session.id} no corresponde a ningún contrato.`);
    return { status: "failed", note: "contract_not_found" };
  }
  const intentId = paymentIntentId(session);
  if (intentId) {
    const recorded = await tx.payment.findFirst({
      where: { stripePaymentIntentId: intentId, status: "succeeded" },
      select: { id: true },
    });
    // Ya registrado (p. ej. `completed` y `async_payment_succeeded` del mismo pago).
    if (recorded) return { status: "processed", note: "already_recorded" };
  }

  const { amount, currency } = chargedAmount(session, contract);
  const discount = await checkoutSessionDiscount(session, stripe);
  const paidAt = new Date(event.created * 1000);
  const auditBase = {
    actor: "stripe" as const,
    entityType: "Contract",
    entityId: contract.id,
  };

  if (!UNPAID.includes(contract.status)) {
    // El contrato ya estaba pagado: es un cobro adicional (p. ej. dos pestañas de Checkout). Se
    // registra el dinero, no se abre otro mes y se avisa a Ferro para que lo revise en Stripe.
    const payment = await recordStripePayment(
      {
        contractId: contract.id,
        method: "stripe_one_time",
        stripePaymentIntentId: intentId,
        amount,
        currency,
        discount,
      },
      tx,
      paidAt,
    );
    await recordAudit(
      {
        ...auditBase,
        action: "stripe.extra_payment",
        metadata: {
          reference: contract.reference,
          paymentId: payment.id,
          checkoutSessionId: session.id,
          contractStatus: contract.status,
          amount: amount.toFixed(2),
        },
      },
      tx,
    );
    return {
      status: "processed",
      note: "extra_payment",
      after: (db) =>
        notifyQuietly(db, contract, "extra_payment_alert", () =>
          sendExtraPaymentAlertEmail({
            reference: contract.reference,
            customerName: contract.customer.fullName,
            customerEmail: contract.customer.email,
            amount: formatPrice(amount.toFixed(2) as `${number}`, currency),
            stripePaymentIntentId: intentId ?? session.id,
          }),
        ),
    };
  }

  const from = contract.status as "pending_payment" | "expired";
  const paidAfterExpiry = effectiveContractStatus(contract, paidAt) === "expired";
  const period = await nextOneMonthPeriod(contract, paidAt, tx);
  const paid = await markContractPaid(contract.id, period, tx, now, { from });
  const payment = await recordStripePayment(
    {
      contractId: contract.id,
      method: "stripe_one_time",
      stripePaymentIntentId: intentId,
      amount,
      currency,
      discount,
    },
    tx,
    paidAt,
  );
  const servicePeriod = await createServicePeriod(
    { contract: paid, payment, paidAt, ...period },
    tx,
  );
  const deliveryLink = await createPlanDeliveryLink(servicePeriod.id, tx, now);
  await recordAudit(
    {
      ...auditBase,
      action: "stripe.payment_succeeded",
      metadata: {
        reference: contract.reference,
        stripeEventId: event.id,
        checkoutSessionId: session.id,
        paymentId: payment.id,
        servicePeriodId: servicePeriod.id,
        amount: amount.toFixed(2),
        currency,
        status: paid.status,
        serviceStartDate: period.serviceStartDate.toISOString(),
        serviceEndDate: period.serviceEndDate.toISOString(),
      },
    },
    tx,
  );
  await auditChargedAmount(
    {
      contract,
      paymentId: payment.id,
      charged: { amount, currency },
      expected: { amount: contract.amount, currency: contract.currency },
      discount,
    },
    tx,
  );
  if (paidAfterExpiry) {
    await recordAudit(
      {
        ...auditBase,
        action: "contract.paid_after_expiry",
        metadata: { reference: contract.reference, method: "stripe_one_time" },
      },
      tx,
    );
  }

  return {
    status: "processed",
    after: (db) =>
      sendPaidNotifications(
        {
          contract: paid,
          customer: contract.customer,
          program: contract.program,
          servicePeriod,
          method: "stripe_one_time",
          amount: amount.toFixed(2) as `${number}`,
          currency,
          deliveryUrl: deliveryLink.url,
          failureAuditAction: "payment.notification_failed",
          discount,
        },
        db,
      ),
  };
}

/**
 * Pago asíncrono que no se completó (p. ej. OXXO vencido). Se registra el Payment fallido y el
 * contrato **sigue pendiente**: nunca tuvo servicio que suspender y el cliente puede volver a
 * intentarlo (DECISIONS A26). Se avisa al cliente.
 */
async function failAsyncCheckout(
  session: Stripe.Checkout.Session,
  event: Stripe.Event,
  tx: Db,
): Promise<Handled> {
  const contract = await lockSessionContract(session, tx);
  if (!contract) {
    console.error(`[stripe.webhook] La sesión ${session.id} no corresponde a ningún contrato.`);
    return { status: "failed", note: "contract_not_found" };
  }
  const intentId = paymentIntentId(session);
  if (intentId) {
    const recorded = await tx.payment.findFirst({
      where: { stripePaymentIntentId: intentId },
      select: { id: true },
    });
    if (recorded) return { status: "processed", note: "already_recorded" };
  }

  const { amount, currency } = chargedAmount(session, contract);
  const payment = await recordFailedStripePayment(
    {
      contractId: contract.id,
      method: "stripe_one_time",
      stripePaymentIntentId: intentId,
      amount,
      currency,
    },
    tx,
    new Date(event.created * 1000),
  );
  // La sesión ya no sirve: el siguiente intento abre otra.
  await detachCheckoutSession(contract.id, session.id, tx);
  await recordAudit(
    {
      actor: "stripe",
      action: "stripe.async_payment_failed",
      entityType: "Contract",
      entityId: contract.id,
      metadata: {
        reference: contract.reference,
        stripeEventId: event.id,
        checkoutSessionId: session.id,
        paymentId: payment.id,
        contractStatus: contract.status,
      },
    },
    tx,
  );

  const stillUnpaid = UNPAID.includes(contract.status);
  return {
    status: "processed",
    note: stillUnpaid ? undefined : "contract_already_paid",
    after: stillUnpaid
      ? (db) =>
          notifyQuietly(db, contract, "payment_not_completed", () =>
            sendPaymentNotCompletedEmail({
              to: contract.customer.email,
              customerName: contract.customer.fullName,
              reference: contract.reference,
              programName: contract.program.name,
              retryUrl: `${getConfig().APP_URL}${applicationHref(contract.program.slug)}`,
            }),
          )
      : undefined,
  };
}
