import type Stripe from "stripe";

import type { Contract, Program, Subscription } from "@/generated/prisma/client";
import type { Db } from "@/lib/prisma";
import { fromMinorUnits, normalizeCurrency } from "@/lib/stripe";
import { formatPrice } from "@/utils/format";

import { recordAudit } from "./audit.service";
import {
  activateContract,
  cancelContract,
  detachCheckoutSession,
  effectiveContractStatus,
  extendSubscriptionContract,
  markContractPaymentFailed,
} from "./contract.service";
import { createPlanDeliveryLink } from "./delivery-link";
import {
  sendExtraPaymentAlertEmail,
  sendPaymentFailedAlertEmail,
  sendPaymentFailedEmail,
} from "./email.service";
import { sendPaidNotifications, sendRenewalNotifications } from "./payment-notifications.service";
import { recordFailedStripePayment, recordStripePayment } from "./payment.service";
import { createServicePeriod } from "./service-period.service";
import {
  fetchSubscriptionSnapshot,
  programIdForPrice,
  upsertSubscription,
  type SubscriptionSnapshot,
  type SyncResult,
} from "./subscription.service";
import {
  lockContract,
  notifyQuietly,
  UNPAID,
  type ContractWithRelations,
  type Handled,
} from "./stripe-webhook-shared";

/**
 * Webhooks de la suscripción mensual (RF-08, RF-17, RF-18, RN-03, RN-14, SDD §7.5, §8.3, DECISIONS
 * A6, A19, A31).
 *
 * - `checkout.session.completed` (modo `subscription`): solo liga la suscripción con el contrato.
 * - `invoice.paid`: **única fuente de los pagos**. Crea el Payment y el ServicePeriod con el periodo
 *   de la factura y el programa del Price cobrado, y activa (primer pago), extiende (renovación) o
 *   reactiva (`payment_failed → active`) el contrato.
 * - `invoice.payment_failed`: registra el intento fallido y, en una renovación, suspende el servicio
 *   (`active → payment_failed`).
 * - `customer.subscription.*`: solo sincroniza la fila Subscription. Si Stripe la cancela (p. ej. al
 *   agotarse Smart Retries), el contrato pasa a `cancelled`.
 *
 * Todos los eventos vuelven a leer la suscripción en Stripe con el contrato bloqueado
 * (`subscription.service`), así que toleran entregas repetidas o fuera de orden.
 */

export type SubscriptionEventContext = {
  tx: Db;
  now: Date;
  /** Para leer la suscripción actual en Stripe. */
  stripe: Pick<Stripe, "subscriptions"> | null;
  event: Stripe.Event;
};

const idOf = (value: string | { id: string } | null | undefined): string | null =>
  value ? (typeof value === "string" ? value : value.id) : null;

const fromUnix = (seconds: number) => new Date(seconds * 1000);

/**
 * Contrato de una suscripción, bloqueado: el ya ligado en Subscription o, si es la primera vez, el
 * de `metadata.contractId` (el Checkout lo pone en la suscripción y Stripe lo copia a sus facturas).
 */
async function lockSubscriptionContract(
  tx: Db,
  stripeSubscriptionId: string,
  metadataContractId: string | null | undefined,
): Promise<ContractWithRelations | null> {
  const linked = await tx.subscription.findUnique({
    where: { stripeSubscriptionId },
    select: { contractId: true },
  });
  return lockContract(linked?.contractId ?? metadataContractId, tx);
}

function contractNotFound(kind: string, id: string): Handled {
  console.error(`[stripe.webhook] ${kind} ${id} no corresponde a ningún contrato.`);
  return { status: "failed", note: "contract_not_found" };
}

const auditFor = (contract: Pick<Contract, "id">) => ({
  actor: "stripe" as const,
  entityType: "Contract",
  entityId: contract.id,
});

/**
 * Efectos de un cambio de estado de la suscripción sobre el contrato. Solo la cancelación cambia el
 * contrato (los pagos y su suspensión los marcan las facturas): `active | payment_failed →
 * cancelled`, sin recortar el periodo pagado. Si el primer pago nunca se completó
 * (`incomplete_expired`), el contrato sigue pendiente y se suelta su sesión para poder reintentar.
 */
async function applySubscriptionStatus(
  contract: ContractWithRelations,
  snapshot: SubscriptionSnapshot,
  sync: SyncResult,
  context: SubscriptionEventContext,
): Promise<string | undefined> {
  if (sync.kind !== "synced" || snapshot.status !== "canceled") return undefined;
  const { tx, event } = context;
  if (contract.status === "active" || contract.status === "payment_failed") {
    await cancelContract(contract.id, tx);
    await recordAudit(
      {
        ...auditFor(contract),
        action: "subscription.cancelled",
        metadata: {
          reference: contract.reference,
          stripeEventId: event.id,
          stripeSubscriptionId: snapshot.stripeSubscriptionId,
          stripeStatus: snapshot.stripeStatus,
          from: contract.status,
        },
      },
      tx,
    );
    // Los correos Subscription Cancelled son de la Fase 7 (portal y cancelación).
    return "contract_cancelled";
  }
  if (UNPAID.includes(contract.status) && contract.stripeCheckoutSessionId) {
    await detachCheckoutSession(contract.id, contract.stripeCheckoutSessionId, tx);
    return "first_payment_never_completed";
  }
  return undefined;
}

async function syncFromStripe(
  contract: ContractWithRelations,
  stripeSubscriptionId: string,
  context: SubscriptionEventContext,
): Promise<{ snapshot: SubscriptionSnapshot; sync: SyncResult }> {
  const snapshot = await fetchSubscriptionSnapshot(context.stripe, stripeSubscriptionId);
  const sync = await upsertSubscription(contract, snapshot, context.tx, context.now);
  if (sync.kind === "duplicate") {
    await recordAudit(
      {
        ...auditFor(contract),
        action: "stripe.duplicate_subscription",
        metadata: {
          reference: contract.reference,
          stripeEventId: context.event.id,
          stripeSubscriptionId,
          linkedTo: sync.linkedTo,
        },
      },
      context.tx,
    );
  }
  return { snapshot, sync };
}

// ─── checkout.session.completed (modo subscription) ─────────────────────────

/** Solo liga la suscripción con el contrato; **no** crea el Payment (lo hace `invoice.paid`). */
export async function handleSubscriptionCheckoutCompleted(
  session: Stripe.Checkout.Session,
  context: SubscriptionEventContext,
): Promise<Handled> {
  const stripeSubscriptionId = idOf(session.subscription);
  if (!stripeSubscriptionId) return { status: "failed", note: "session_without_subscription" };
  const contract = await lockSubscriptionContract(
    context.tx,
    stripeSubscriptionId,
    session.metadata?.contractId ?? session.client_reference_id,
  );
  if (!contract) return contractNotFound("La sesión", session.id);
  const { snapshot, sync } = await syncFromStripe(contract, stripeSubscriptionId, context);
  const effect = await applySubscriptionStatus(contract, snapshot, sync, context);
  return {
    status: "processed",
    note: sync.kind === "duplicate" ? "duplicate_subscription" : (effect ?? "subscription_linked"),
  };
}

// ─── customer.subscription.created / updated / deleted ──────────────────────

/** Solo sincroniza Subscription (estado, periodo, `cancelAtPeriodEnd`, programa). */
export async function handleSubscriptionChanged(
  subscription: Stripe.Subscription,
  context: SubscriptionEventContext,
): Promise<Handled> {
  const contract = await lockSubscriptionContract(
    context.tx,
    subscription.id,
    subscription.metadata?.contractId,
  );
  if (!contract) return contractNotFound("La suscripción", subscription.id);
  const { snapshot, sync } = await syncFromStripe(contract, subscription.id, context);
  if (sync.kind === "duplicate") return { status: "processed", note: "duplicate_subscription" };
  const effect = await applySubscriptionStatus(contract, snapshot, sync, context);
  return { status: "processed", note: effect };
}

// ─── Facturas ───────────────────────────────────────────────────────────────

/** Suscripción de la factura, o `null` si no es de una suscripción. */
function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  return idOf(invoice.parent?.subscription_details?.subscription);
}

/** Concepto de la suscripción en la factura: su Price, su Product y el periodo que cubre. */
export function invoiceServiceLine(
  invoice: Stripe.Invoice,
): { priceId: string | null; productId: string | null; start: Date; end: Date } | null {
  const lines = invoice.lines?.data ?? [];
  const line =
    lines.find((l) => l.parent?.type === "subscription_item_details" && l.amount > 0) ??
    lines.find((l) => l.parent?.type === "subscription_item_details") ??
    lines[0];
  if (!line?.period || line.period.end <= line.period.start) return null;
  const details = line.pricing?.price_details;
  return {
    priceId: idOf(details?.price),
    productId: details?.product ?? null,
    start: fromUnix(line.period.start),
    end: fromUnix(line.period.end),
  };
}

function invoicePaymentIntentId(invoice: Stripe.Invoice): string | null {
  const payments = invoice.payments?.data ?? [];
  const paid = payments.find((p) => p.status === "paid") ?? payments[0];
  return idOf(paid?.payment?.payment_intent);
}

/**
 * `invoice.paid`: única fuente de los Payment de la suscripción (A6). Primer pago: Payment +
 * ServicePeriod + botón de entrega + contrato `active` (también un pago tardío de un contrato
 * vencido). Renovación: Payment + ServicePeriod nuevo, se extiende el contrato (o se reactiva si
 * estaba en `payment_failed`) y se avisa a Ferro (Renewal Successful) y al cliente.
 */
export async function handleInvoicePaid(
  invoice: Stripe.Invoice,
  context: SubscriptionEventContext,
): Promise<Handled> {
  const { tx, event, now } = context;
  const stripeSubscriptionId = invoiceSubscriptionId(invoice);
  if (!stripeSubscriptionId) return { status: "ignored", note: "not_a_subscription_invoice" };
  const contract = await lockSubscriptionContract(
    tx,
    stripeSubscriptionId,
    invoice.parent?.subscription_details?.metadata?.contractId,
  );
  if (!contract) return contractNotFound("La factura", invoice.id);

  const recorded = await tx.payment.findFirst({
    where: { stripeInvoiceId: invoice.id, status: "succeeded" },
    select: { id: true },
  });
  if (recorded) return { status: "processed", note: "already_recorded" };

  const { sync } = await syncFromStripe(contract, stripeSubscriptionId, context);
  const amount = fromMinorUnits(invoice.amount_paid);
  const currency = normalizeCurrency(invoice.currency);
  // Una factura de importe 0 no abre un mes (SDD §7.5).
  if (amount.isZero()) return { status: "processed", note: "zero_amount_invoice" };

  const line = invoiceServiceLine(invoice);
  if (!line) {
    console.error(
      `[stripe.webhook] La factura ${invoice.id} no trae el periodo de la suscripción.`,
    );
    return { status: "failed", note: "invoice_without_period" };
  }
  const paidAt = invoice.status_transitions?.paid_at
    ? fromUnix(invoice.status_transitions.paid_at)
    : fromUnix(event.created);
  const subscription = sync.kind === "synced" ? sync.subscription : null;
  const paymentInput = {
    contractId: contract.id,
    method: "stripe_subscription" as const,
    stripePaymentIntentId: invoicePaymentIntentId(invoice),
    stripeInvoiceId: invoice.id,
    subscriptionId: subscription?.id ?? null,
    amount,
    currency,
  };

  const renewable =
    UNPAID.includes(contract.status) ||
    contract.status === "active" ||
    contract.status === "payment_failed";
  if (sync.kind === "duplicate" || !renewable) {
    // Una suscripción duplicada, o un cobro para un contrato que ya no la tiene (p. ej. cancelado):
    // se registra el dinero sin abrir un mes y Ferro lo revisa en Stripe (DECISIONS A26, A31).
    const payment = await recordStripePayment(paymentInput, tx, paidAt);
    await recordAudit(
      {
        ...auditFor(contract),
        action: "stripe.extra_payment",
        metadata: {
          reference: contract.reference,
          paymentId: payment.id,
          stripeInvoiceId: invoice.id,
          stripeSubscriptionId,
          contractStatus: contract.status,
          amount: amount.toFixed(2),
        },
      },
      tx,
    );
    return {
      status: "processed",
      note: sync.kind === "duplicate" ? "duplicate_subscription" : "extra_payment",
      after: (db) =>
        notifyQuietly(db, contract, "extra_payment_alert", () =>
          sendExtraPaymentAlertEmail({
            reference: contract.reference,
            customerName: contract.customer.fullName,
            customerEmail: contract.customer.email,
            amount: formatPrice(amount.toFixed(2) as `${number}`, currency),
            stripePaymentIntentId: paymentInput.stripePaymentIntentId ?? invoice.id,
            duplicateSubscriptionId: sync.kind === "duplicate" ? stripeSubscriptionId : null,
          }),
        ),
    };
  }

  const programId =
    (await programIdForPrice(tx, line.priceId, line.productId)) ?? contract.programId;
  const program: Program =
    programId === contract.programId
      ? contract.program
      : await tx.program.findUniqueOrThrow({ where: { id: programId } });
  const period = { serviceStartDate: line.start, serviceEndDate: line.end };
  const firstPayment = UNPAID.includes(contract.status);

  let updated: Contract;
  if (firstPayment) {
    if (contract.paymentType !== "subscription") {
      // El cliente cambió el pendiente a otra modalidad mientras pagaba la suscripción: el pago
      // real manda (DECISIONS A20) y el contrato pasa a ser de suscripción.
      await tx.contract.update({
        where: { id: contract.id },
        data: {
          paymentType: "subscription",
          programId: program.id,
          amount: program.subscriptionPrice,
          currency: program.currency,
        },
      });
      await tx.transferApproval.updateMany({
        where: { contractId: contract.id, usedAt: null, invalidatedAt: null },
        data: { invalidatedAt: now },
      });
      await recordAudit(
        {
          ...auditFor(contract),
          action: "stripe.payment_type_changed",
          metadata: { reference: contract.reference, from: contract.paymentType },
        },
        tx,
      );
    }
    updated = await activateContract(contract.id, period, tx, { from: contract.status });
  } else if (contract.status === "payment_failed") {
    updated = await activateContract(contract.id, period, tx, { from: "payment_failed" });
  } else {
    updated = await extendSubscriptionContract(contract.id, period, tx);
  }

  const payment = await recordStripePayment(paymentInput, tx, paidAt);
  const servicePeriod = await createServicePeriod(
    { contract: updated, payment, paidAt, programId: program.id, ...period },
    tx,
  );
  const deliveryLink = await createPlanDeliveryLink(servicePeriod.id, tx, now);
  await recordAudit(
    {
      ...auditFor(contract),
      action: firstPayment ? "stripe.payment_succeeded" : "subscription.renewed",
      metadata: {
        reference: contract.reference,
        stripeEventId: event.id,
        stripeInvoiceId: invoice.id,
        stripeSubscriptionId,
        paymentId: payment.id,
        servicePeriodId: servicePeriod.id,
        sequence: servicePeriod.sequence,
        program: program.slug,
        amount: amount.toFixed(2),
        currency,
        from: contract.status,
        status: updated.status,
        serviceStartDate: line.start.toISOString(),
        serviceEndDate: line.end.toISOString(),
      },
    },
    tx,
  );
  if (!amount.equals(program.subscriptionPrice) || currency !== program.currency) {
    await recordAudit(
      {
        ...auditFor(contract),
        action: "stripe.amount_mismatch",
        metadata: {
          reference: contract.reference,
          stripeInvoiceId: invoice.id,
          charged: `${amount.toFixed(2)} ${currency}`,
          expected: `${program.subscriptionPrice.toFixed(2)} ${program.currency}`,
        },
      },
      tx,
    );
  }
  if (firstPayment && effectiveContractStatus(contract, paidAt) === "expired") {
    await recordAudit(
      {
        ...auditFor(contract),
        action: "contract.paid_after_expiry",
        metadata: { reference: contract.reference, method: "stripe_subscription" },
      },
      tx,
    );
  }

  const notification = {
    contract: updated,
    customer: contract.customer,
    program,
    servicePeriod,
    amount: amount.toFixed(2) as `${number}`,
    currency,
    deliveryUrl: deliveryLink.url,
  };
  return {
    status: "processed",
    note: firstPayment ? undefined : "renewal",
    after: (db) =>
      firstPayment
        ? sendPaidNotifications(
            {
              ...notification,
              method: "stripe_subscription",
              failureAuditAction: "payment.notification_failed",
            },
            db,
          )
        : sendRenewalNotifications(notification, db),
  };
}

/**
 * `invoice.payment_failed`: cada intento fallido es un Payment `failed` (RF-18). En una renovación
 * de un contrato activo, el servicio se suspende (`active → payment_failed`, RN-14) y se avisa al
 * cliente y a Ferro una sola vez; los reintentos siguientes de Smart Retries solo se registran. Si el
 * primer pago falla, el contrato sigue pendiente (como un pago asíncrono fallido, A26).
 */
export async function handleInvoicePaymentFailed(
  invoice: Stripe.Invoice,
  context: SubscriptionEventContext,
): Promise<Handled> {
  const { tx, event } = context;
  const stripeSubscriptionId = invoiceSubscriptionId(invoice);
  if (!stripeSubscriptionId) return { status: "ignored", note: "not_a_subscription_invoice" };
  const contract = await lockSubscriptionContract(
    tx,
    stripeSubscriptionId,
    invoice.parent?.subscription_details?.metadata?.contractId,
  );
  if (!contract) return contractNotFound("La factura", invoice.id);

  const { sync } = await syncFromStripe(contract, stripeSubscriptionId, context);
  const subscription: Subscription | null = sync.kind === "synced" ? sync.subscription : null;
  const amount = fromMinorUnits(invoice.amount_due);
  const currency = normalizeCurrency(invoice.currency);
  const payment = await recordFailedStripePayment(
    {
      contractId: contract.id,
      method: "stripe_subscription",
      stripePaymentIntentId: invoicePaymentIntentId(invoice),
      stripeInvoiceId: invoice.id,
      subscriptionId: subscription?.id ?? null,
      amount,
      currency,
    },
    tx,
    fromUnix(event.created),
  );
  // Un aviso de fallo que llega después de que la factura ya se pagó no suspende nada.
  const alreadyPaid = await tx.payment.findFirst({
    where: { stripeInvoiceId: invoice.id, status: "succeeded" },
    select: { id: true },
  });

  const suspend =
    sync.kind === "synced" &&
    contract.status === "active" &&
    contract.paymentType === "subscription" &&
    !alreadyPaid;
  if (suspend) await markContractPaymentFailed(contract.id, tx);

  const outcome = suspend
    ? "suspended"
    : contract.status === "payment_failed"
      ? "retry_failed"
      : UNPAID.includes(contract.status)
        ? "first_payment_failed"
        : "recorded";
  await recordAudit(
    {
      ...auditFor(contract),
      action: suspend ? "subscription.payment_failed" : "stripe.payment_attempt_failed",
      metadata: {
        reference: contract.reference,
        stripeEventId: event.id,
        stripeInvoiceId: invoice.id,
        stripeSubscriptionId,
        paymentId: payment.id,
        attempt: invoice.attempt_count,
        contractStatus: contract.status,
        outcome,
      },
    },
    tx,
  );
  if (!suspend) return { status: "processed", note: outcome };

  const formatted = formatPrice(amount.toFixed(2) as `${number}`, currency);
  const programName = contract.program.name;
  return {
    status: "processed",
    note: outcome,
    after: async (db) => {
      await notifyQuietly(db, contract, "payment_failed", () =>
        sendPaymentFailedEmail({
          to: contract.customer.email,
          customerName: contract.customer.fullName,
          reference: contract.reference,
          programName,
          amount: formatted,
          payUrl: invoice.hosted_invoice_url ?? null,
        }),
      );
      await notifyQuietly(db, contract, "payment_failed_alert", () =>
        sendPaymentFailedAlertEmail({
          reference: contract.reference,
          customerName: contract.customer.fullName,
          customerEmail: contract.customer.email,
          customerWhatsapp: contract.customer.whatsapp,
          programName,
          amount: formatted,
          attempt: invoice.attempt_count,
        }),
      );
    },
  };
}
