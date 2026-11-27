import type Stripe from "stripe";

import type { SubscriptionStatus } from "@/generated/prisma/client";
import { getConfig } from "@/lib/config";
import { getPrisma, type Db } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";

import { recordAudit } from "./audit.service";
import { PortalUnavailableError, SubscriptionNotFoundError } from "./errors";

/**
 * Acceso al Stripe Customer Portal (RF-19, SDD §7.7, DECISIONS A21, A33). Ahí el cliente cancela al
 * final del periodo, cambia de programa (aplica en la siguiente renovación) o actualiza su tarjeta.
 * La app se entera de los cambios por los webhooks `customer.subscription.*`.
 */

/**
 * Suscripciones que se pueden administrar en el portal: vigentes (también con la cancelación
 * programada, para deshacerla) o con un cobro pendiente (para actualizar la tarjeta). Una
 * `incomplete` nunca se pagó y una `canceled` ya terminó.
 */
const MANAGEABLE: readonly SubscriptionStatus[] = ["active", "past_due", "unpaid"];

export type PortalRequestContext = { ip?: string | null; userAgent?: string | null };

/**
 * Crea una sesión del portal para el cliente del correo verificado y devuelve su URL. Quien llama
 * ya validó la sesión de verificación: el correo sale de ella, nunca del body (RF-15).
 *
 * Lanza `SubscriptionNotFoundError` igual si el correo no existe, si no tiene suscripción o si no
 * tiene cliente de Stripe (no revela qué correos están registrados), y `PortalUnavailableError` si
 * Stripe no está configurado o falla.
 */
export async function createPortalSession(
  verifiedEmail: string,
  context: PortalRequestContext = {},
  db: Db = getPrisma(),
  stripe: Pick<Stripe, "billingPortal"> | null = getStripe(),
): Promise<{ url: string }> {
  const customer = await db.customer.findUnique({
    where: { email: verifiedEmail },
    select: { id: true, stripeCustomerId: true },
  });
  const subscription = customer
    ? await db.subscription.findFirst({
        where: { customerId: customer.id, status: { in: [...MANAGEABLE] } },
        orderBy: { createdAt: "desc" },
        select: { id: true, contractId: true },
      })
    : null;
  if (!customer?.stripeCustomerId || !subscription) throw new SubscriptionNotFoundError();
  if (!stripe) throw new PortalUnavailableError("not_configured");

  let session: Stripe.BillingPortal.Session;
  try {
    session = await stripe.billingPortal.sessions.create({
      customer: customer.stripeCustomerId,
      return_url: `${getConfig().APP_URL}/`,
      locale: "es-419",
    });
  } catch (error) {
    console.error(
      "[portal] Stripe no pudo crear la sesión del portal:",
      error instanceof Error ? error.name : "error desconocido",
    );
    throw new PortalUnavailableError("stripe_error");
  }

  await recordAudit(
    {
      action: "portal.session_created",
      actor: `customer:${customer.id}`,
      entityType: "Subscription",
      entityId: subscription.id,
      ip: context.ip,
      userAgent: context.userAgent,
      metadata: { contractId: subscription.contractId },
    },
    db,
  );
  return { url: session.url };
}
