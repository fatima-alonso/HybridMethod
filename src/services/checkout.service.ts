import type Stripe from "stripe";

import type { Contract, Customer, Program } from "@/generated/prisma/client";
import { getConfig } from "@/lib/config";
import { getPrisma, type Db } from "@/lib/prisma";
import { getStripe, isLiveKey } from "@/lib/stripe";
import type { CustomerDataInput } from "@/lib/validations";

import { recordAudit } from "./audit.service";
import { attachCheckoutSession, detachCheckoutSession } from "./contract.service";
import {
  resolveContractRequest,
  type ContractRequestOutcome,
  type PendingAction,
} from "./contract-request.service";
import { ensureStripeCustomer, upsertVerifiedCustomer } from "./customer.service";
import {
  CheckoutInProgressError,
  PaymentsUnavailableError,
  PendingNotCardError,
  ProgramUnavailableError,
} from "./errors";
import { verifyProgramPrice } from "./stripe-catalog.service";
import type { RequestContext } from "./transfer.service";

/**
 * Pago único con Stripe Checkout (RF-07, SDD §7.4, §8.2, DECISIONS A26).
 *
 * `requestCheckout` resuelve la contratación con las mismas reglas que la transferencia (SDD §7.3)
 * y devuelve el `client_secret` de una sesión de Embedded Checkout en modo `payment`. El Price sale del programa en la
 * BD y se comprueba contra Stripe antes de cobrar (SDD §6.1, §9.2). Aquí **no** se confirma ningún
 * pago: eso solo lo hace el webhook (`stripe-webhook.service`).
 */

/**
 * Página a la que Stripe regresa al terminar el pago en el formulario incrustado. Solo informa
 * (SDD §7.5): no lee la sesión ni confirma nada.
 */
export const CHECKOUT_RETURN_PATH = "/pago/exito";

export type CheckoutRequestInput = {
  /** Correo verificado, tomado de la sesión de verificación (nunca del body). */
  verifiedEmail: string;
  fullName: string;
  /** WhatsApp ya en E.164. */
  whatsapp: string;
  programSlug: string;
  pendingAction?: PendingAction;
};

export type CheckoutRequestResult = {
  contract: Contract;
  program: Program;
  customer: Customer;
  outcome: ContractRequestOutcome;
  /** `client_secret` de la sesión de Embedded Checkout (DECISIONS A27). */
  clientSecret: string;
  /** Clave publicable para montar el formulario en el navegador (misma cuenta y modo). */
  publishableKey: string;
};

/** Expira una sesión de Checkout que ya no corresponde. Si falla (ya expiró o se pagó), solo se registra. */
export async function expireCheckoutSessionQuietly(
  stripe: Pick<Stripe, "checkout">,
  sessionId: string,
  reference: string,
): Promise<void> {
  try {
    await stripe.checkout.sessions.expire(sessionId);
  } catch (error) {
    console.warn(
      `[checkout] No se pudo expirar la sesión anterior de ${reference}:`,
      error instanceof Error ? error.name : "error desconocido",
    );
  }
}

/**
 * Clave publicable de Stripe para el formulario incrustado. Debe ser del mismo modo (test o live)
 * que la clave secreta: si no, el formulario no podría abrir la sesión.
 */
function checkoutPublishableKey(): string {
  const { NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: publishable, STRIPE_SECRET_KEY: secret } =
    getConfig();
  if (!publishable) throw new PaymentsUnavailableError("not_configured", "sin clave publicable");
  if (secret && isLiveKey(secret) !== publishable.startsWith("pk_live_")) {
    console.error("[checkout] STRIPE_SECRET_KEY y la clave publicable son de modos distintos.");
    throw new PaymentsUnavailableError("not_configured", "claves de modos distintos");
  }
  return publishable;
}

/**
 * Pago único con tarjeta (SDD §7.4):
 * 1. Comprueba que el programa pedido esté activo y que su Price de Stripe valga `monthlyPrice`.
 * 2. En una transacción con el candado del cliente: crea o actualiza el cliente y resuelve la
 *    contratación (nuevo, reutilizado, retomado o cambiado; SDD §7.3). Si el pendiente cambió de
 *    una transferencia, invalida su enlace; si tenía otra sesión de Checkout, la suelta.
 * 3. Reutiliza la sesión abierta del contrato o crea una nueva y la guarda en el contrato.
 *
 * Lanza `PaymentsUnavailableError` (sin Stripe o con un Price que no coincide),
 * `CheckoutInProgressError`, `PendingNotCardError` y los errores de las reglas de contratación.
 */
export async function requestCheckout(
  input: CheckoutRequestInput,
  context: RequestContext = {},
  db = getPrisma(),
  now: Date = new Date(),
  stripe: Stripe | null = getStripe(),
): Promise<CheckoutRequestResult> {
  if (!stripe) throw new PaymentsUnavailableError("not_configured");
  const publishableKey = checkoutPublishableKey();

  const requested = await db.program.findUnique({ where: { slug: input.programSlug } });
  if (!requested || !requested.active) throw new ProgramUnavailableError(input.programSlug);
  const verifiedPrices = new Map<string, string>([
    [requested.id, await verifyProgramPrice(stripe, requested, "one_time")],
  ]);

  const customerData: CustomerDataInput = {
    fullName: input.fullName,
    email: input.verifiedEmail,
    whatsapp: input.whatsapp,
  };

  const resolved = await db.$transaction(async (tx) => {
    const customer = await upsertVerifiedCustomer(customerData, tx);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${customer.id}, 0))`;

    const result = await resolveContractRequest(
      {
        customerId: customer.id,
        programSlug: input.programSlug,
        paymentType: "one_time",
        pendingAction: input.pendingAction,
      },
      tx,
      now,
      context,
    );
    let { contract } = result;
    if (contract.paymentType !== "one_time") {
      // Retomó un pendiente de transferencia (o de suscripción): se le pide elegir "cambiar".
      throw new PendingNotCardError(contract.reference, contract.paymentType);
    }

    let staleSessionId: string | null = null;
    if (result.outcome === "changed") {
      if (result.previousPaymentType === "transfer") {
        // El enlace de confirmación de Ferro ya no corresponde (DECISIONS A20).
        await tx.transferApproval.updateMany({
          where: { contractId: contract.id, usedAt: null, invalidatedAt: null },
          data: { invalidatedAt: now },
        });
      }
      if (contract.stripeCheckoutSessionId) {
        // La sesión anterior cobraba otro programa: se expira en Stripe después de la transacción.
        staleSessionId = contract.stripeCheckoutSessionId;
        await detachCheckoutSession(contract.id, staleSessionId, tx);
        contract = { ...contract, stripeCheckoutSessionId: null };
      }
    }
    if (result.outcome === "created") {
      await recordAudit(
        {
          action: "checkout.requested",
          actor: `customer:${customer.id}`,
          entityType: "Contract",
          entityId: contract.id,
          ip: context.ip,
          userAgent: context.userAgent,
          metadata: { reference: contract.reference, program: result.program.slug },
        },
        tx,
      );
    }
    return { ...result, contract, customer, staleSessionId };
  });

  const { customer, program, outcome, staleSessionId } = resolved;
  let { contract } = resolved;
  if (staleSessionId) {
    await expireCheckoutSessionQuietly(stripe, staleSessionId, contract.reference);
  }

  // Si retomó un pendiente de otro programa, también se comprueba ese Price.
  const priceId =
    verifiedPrices.get(program.id) ?? (await verifyProgramPrice(stripe, program, "one_time"));

  try {
    const clientSecret = await openCheckoutSession(
      stripe,
      { contract, customer, program, priceId },
      db,
      now,
    );
    contract = await db.contract.findUniqueOrThrow({ where: { id: contract.id } });
    return { contract, program, customer, outcome, clientSecret, publishableKey };
  } catch (error) {
    if (error instanceof CheckoutInProgressError || error instanceof PaymentsUnavailableError) {
      throw error;
    }
    console.error(
      `[checkout] Stripe no pudo crear la sesión de ${contract.reference}:`,
      error instanceof Error ? error.name : "error desconocido",
    );
    throw new PaymentsUnavailableError("stripe_error", contract.reference);
  }
}

/**
 * Devuelve el `client_secret` de la sesión abierta del contrato, o crea una nueva. Si la sesión guardada ya se
 * completó (Stripe todavía no confirma el pago), no abre otra para no cobrar dos veces.
 */
async function openCheckoutSession(
  stripe: Stripe,
  input: { contract: Contract; customer: Customer; program: Program; priceId: string },
  db: Db,
  now: Date,
): Promise<string> {
  const { contract, customer, program, priceId } = input;
  const previous = contract.stripeCheckoutSessionId;

  if (previous) {
    const session = await stripe.checkout.sessions.retrieve(previous);
    if (session.status === "complete") throw new CheckoutInProgressError(contract.reference);
    const samePrice = await sessionUsesPrice(stripe, session, priceId);
    if (session.status === "open" && session.client_secret && samePrice) {
      return session.client_secret;
    }
    if (session.status === "open") {
      await expireCheckoutSessionQuietly(stripe, session.id, contract.reference);
    }
  }

  const stripeCustomerId = await ensureStripeCustomer(customer, stripe, db);
  const appUrl = getConfig().APP_URL;
  const metadata = { contractId: contract.id, reference: contract.reference };
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [{ price: priceId, quantity: 1 }],
    customer: stripeCustomerId,
    client_reference_id: contract.id,
    metadata,
    payment_intent_data: {
      metadata,
      description: `${program.name} · ${contract.reference}`,
    },
    locale: "es-419",
    // Formulario de Stripe incrustado en la landing (DECISIONS A27).
    ui_mode: "embedded_page",
    return_url: `${appUrl}${CHECKOUT_RETURN_PATH}`,
  });
  if (!session.client_secret) throw new Error("Stripe no devolvió el client_secret de Checkout.");

  if (await attachCheckoutSession(contract.id, session.id, previous, db, now)) {
    return session.client_secret;
  }

  // Otra solicitud simultánea guardó otra sesión (o el contrato dejó de estar pendiente): se usa
  // esa y la nuestra se expira.
  await expireCheckoutSessionQuietly(stripe, session.id, contract.reference);
  const current = await db.contract.findUniqueOrThrow({ where: { id: contract.id } });
  if (current.status !== "pending_payment" || !current.stripeCheckoutSessionId) {
    throw new CheckoutInProgressError(contract.reference);
  }
  const winner = await stripe.checkout.sessions.retrieve(current.stripeCheckoutSessionId);
  if (winner.status !== "open" || !winner.client_secret)
    throw new CheckoutInProgressError(contract.reference);
  return winner.client_secret;
}

async function sessionUsesPrice(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
  priceId: string,
): Promise<boolean> {
  const items = await stripe.checkout.sessions.listLineItems(session.id, { limit: 2 });
  return items.data.length === 1 && items.data[0]?.price?.id === priceId;
}
