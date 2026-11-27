import type Stripe from "stripe";

import type { Contract, Customer, Program } from "@/generated/prisma/client";
import { getConfig } from "@/lib/config";
import { getPrisma, type Db } from "@/lib/prisma";
import { getStripe, isLiveKey } from "@/lib/stripe";
import type { CheckoutMode, CustomerDataInput } from "@/lib/validations";

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
 * Pago con tarjeta con Stripe Checkout: pago único (RF-07, SDD §8.2, DECISIONS A26) y suscripción
 * mensual (RF-08, SDD §8.3, DECISIONS A31).
 *
 * `requestCheckout` resuelve la contratación con las mismas reglas que la transferencia (SDD §7.3)
 * y devuelve el `client_secret` de una sesión de Checkout con formulario incrustado (`ui_mode: form`,
 * DECISIONS A29) en modo `payment` (Price `one_time`, `monthlyPrice`) o `subscription` (Price
 * `recurring`, `subscriptionPrice`). El Price sale del programa en la BD y se comprueba contra Stripe
 * antes de cobrar (SDD §6.1, §9.2). Aquí **no** se confirma ningún pago: eso solo lo hace el webhook
 * (`stripe-webhook.service`).
 */

/** Modalidad del contrato y tipo de Price de cada modo de Checkout. */
export const CHECKOUT_MODES = {
  payment: { paymentType: "one_time", priceKind: "one_time" },
  subscription: { paymentType: "subscription", priceKind: "recurring" },
} as const satisfies Record<CheckoutMode, { paymentType: string; priceKind: string }>;

/**
 * Página a la que el formulario incrustado lleva al cliente al terminar el pago. Solo informa
 * (SDD §7.5): no lee la sesión ni confirma nada.
 */
export const CHECKOUT_RETURN_PATH = "/pago/exito";

/** Identificador de la configuración hecha en Checkout Studio (DECISIONS A29). */
export const CHECKOUT_INTEGRATION_IDENTIFIER = "custom_embedded_web_0002";

export type CheckoutRequestInput = {
  /** Correo verificado, tomado de la sesión de verificación (nunca del body). */
  verifiedEmail: string;
  fullName: string;
  /** WhatsApp ya en E.164. */
  whatsapp: string;
  programSlug: string;
  /** `payment` (pago único) o `subscription` (suscripción mensual). Por defecto, `payment`. */
  mode?: CheckoutMode;
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
  /** Página a la que el formulario lleva al cliente al terminar de pagar (solo informa). */
  returnUrl: string;
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
 * Pago con tarjeta (SDD §7.4):
 * 1. Comprueba que el programa pedido esté activo y que su Price de Stripe valga `monthlyPrice`
 *    (pago único) o `subscriptionPrice` (suscripción).
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
  const mode = input.mode ?? "payment";
  const { paymentType, priceKind } = CHECKOUT_MODES[mode];

  const requested = await db.program.findUnique({ where: { slug: input.programSlug } });
  if (!requested || !requested.active) throw new ProgramUnavailableError(input.programSlug);
  const verifiedPrices = new Map<string, string>([
    [requested.id, await verifyProgramPrice(stripe, requested, priceKind)],
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
        paymentType,
        pendingAction: input.pendingAction,
      },
      tx,
      now,
      context,
    );
    let { contract } = result;
    if (contract.paymentType !== paymentType) {
      // Retomó un pendiente de otra modalidad: se le pide elegir "cambiar".
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
          metadata: { reference: contract.reference, program: result.program.slug, mode },
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
    verifiedPrices.get(program.id) ?? (await verifyProgramPrice(stripe, program, priceKind));

  try {
    const clientSecret = await openCheckoutSession(
      stripe,
      { contract, customer, program, priceId, mode },
      db,
      now,
    );
    contract = await db.contract.findUniqueOrThrow({ where: { id: contract.id } });
    const returnUrl = `${getConfig().APP_URL}${CHECKOUT_RETURN_PATH}`;
    return { contract, program, customer, outcome, clientSecret, publishableKey, returnUrl };
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
  input: {
    contract: Contract;
    customer: Customer;
    program: Program;
    priceId: string;
    mode: CheckoutMode;
  },
  db: Db,
  now: Date,
): Promise<string> {
  const { contract, customer, program, priceId, mode } = input;
  const previous = contract.stripeCheckoutSessionId;

  if (previous) {
    const session = await stripe.checkout.sessions.retrieve(previous);
    if (session.status === "complete") throw new CheckoutInProgressError(contract.reference);
    const samePrice = await sessionUsesPrice(stripe, session, priceId);
    // Una sesión abierta se reutiliza si cobra el mismo Price y es del formulario actual (una de
    // `embedded_page`, de antes de A29, no se puede montar con el formulario nuevo).
    if (
      session.status === "open" &&
      session.client_secret &&
      samePrice &&
      session.mode === mode &&
      session.ui_mode === "form"
    ) {
      return session.client_secret;
    }
    if (session.status === "open") {
      await expireCheckoutSessionQuietly(stripe, session.id, contract.reference);
    }
  }

  const stripeCustomerId = await ensureStripeCustomer(customer, stripe, db);
  const metadata = { contractId: contract.id, reference: contract.reference };
  const description = `${program.name} · ${contract.reference}`;
  const modeParams: Partial<Stripe.Checkout.SessionCreateParams> =
    mode === "subscription"
      ? {
          // La suscripción lleva el contrato en su metadata y Stripe la copia a cada factura: así
          // `invoice.paid` encuentra el contrato aunque llegue antes que `checkout.session.completed`.
          // La tarjeta queda guardada en la suscripción para las renovaciones (en Stripe, nunca aquí).
          subscription_data: { metadata, description },
          // Siempre se pide la tarjeta, también con un cupón del 100 % (cortesía): así un cupón de
          // "primer mes gratis" cobra el segundo mes (DECISIONS A34).
          payment_method_collection: "always",
        }
      : {
          payment_intent_data: { metadata, description },
          // El cliente puede guardar su tarjeta en Stripe para el siguiente mes (nunca llega a la app).
          saved_payment_method_options: { payment_method_save: "enabled" },
        };
  const session = await stripe.checkout.sessions.create({
    mode,
    line_items: [{ price: priceId, quantity: 1 }],
    customer: stripeCustomerId,
    client_reference_id: contract.id,
    metadata,
    ...modeParams,
    // Códigos de descuento que Ferro crea en Stripe (Fase 7B, DECISIONS A34): el formulario muestra el
    // campo y Stripe calcula el descuento; el importe nunca sale del navegador.
    allow_promotion_codes: true,
    locale: "es-419",
    // Formulario de pago de Stripe incrustado en la landing, configurado en Checkout Studio
    // (DECISIONS A27, A29). El nombre no se pide: ya está en el registro.
    ui_mode: "form",
    integration_identifier: CHECKOUT_INTEGRATION_IDENTIFIER,
    billing_address_collection: "auto",
    phone_number_collection: { enabled: false },
    automatic_tax: { enabled: false },
    submit_type: "auto",
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
