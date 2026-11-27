import type Stripe from "stripe";

import type { Contract, Subscription, SubscriptionStatus } from "@/generated/prisma/client";
import type { Db } from "@/lib/prisma";

/**
 * Copia local de las suscripciones de Stripe (SDD §5.3 Subscription, §7.5, DECISIONS A6, A31).
 *
 * Stripe es la fuente del estado de facturación. Cada evento de suscripción (y cada factura) vuelve
 * a leer la suscripción en Stripe con el contrato bloqueado y copia su estado actual: así una entrega
 * repetida o fuera de orden (p. ej. `created` con `incomplete` después de `updated` con `active`) nunca
 * deja un estado viejo. Aquí solo se sincroniza la fila Subscription; los cambios del contrato los
 * hace el webhook con `contract.service`.
 */

/** Estado de Stripe → enum local (SDD §5.3: incomplete, active, past_due, canceled, unpaid). */
export function mapSubscriptionStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
  switch (status) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
      return "past_due";
    case "unpaid":
    case "paused":
      // Sin cobro al corriente: el servicio no se presta.
      return "unpaid";
    case "canceled":
    case "incomplete_expired":
      // El primer pago nunca se completó y Stripe la dio por terminada.
      return "canceled";
    case "incomplete":
      return "incomplete";
    default:
      console.warn(`[subscription] Estado de Stripe desconocido: ${status}.`);
      return "incomplete";
  }
}

export type SubscriptionSnapshot = {
  stripeSubscriptionId: string;
  status: SubscriptionStatus;
  /** Estado tal como lo da Stripe (p. ej. `incomplete_expired`). */
  stripeStatus: string;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  /** Cancelación programada al final del periodo (`cancel_at_period_end` o `cancel_at`). */
  cancelAtPeriodEnd: boolean;
  /** Price del primer concepto (el programa que se cobrará en la siguiente renovación). */
  priceId: string | null;
  /** `metadata.contractId` que el Checkout puso en la suscripción. */
  contractId: string | null;
  stripeCustomerId: string | null;
};

const fromUnix = (seconds: number | null | undefined) =>
  typeof seconds === "number" ? new Date(seconds * 1000) : null;

export function subscriptionSnapshot(subscription: Stripe.Subscription): SubscriptionSnapshot {
  const item = subscription.items?.data?.[0];
  const price = item?.price;
  const customer = subscription.customer;
  return {
    stripeSubscriptionId: subscription.id,
    status: mapSubscriptionStatus(subscription.status),
    stripeStatus: subscription.status,
    currentPeriodStart: fromUnix(item?.current_period_start),
    currentPeriodEnd: fromUnix(item?.current_period_end),
    cancelAtPeriodEnd: subscription.cancel_at_period_end || subscription.cancel_at !== null,
    priceId: price ? (typeof price === "string" ? price : price.id) : null,
    contractId: subscription.metadata?.contractId ?? null,
    stripeCustomerId: customer ? (typeof customer === "string" ? customer : customer.id) : null,
  };
}

/** Lee la suscripción en Stripe (estado actual, no el del evento). Sin Stripe no se puede sincronizar. */
export async function fetchSubscriptionSnapshot(
  stripe: Pick<Stripe, "subscriptions"> | null,
  stripeSubscriptionId: string,
): Promise<SubscriptionSnapshot> {
  if (!stripe) throw new Error("Stripe no está configurado: no se puede leer la suscripción.");
  return subscriptionSnapshot(await stripe.subscriptions.retrieve(stripeSubscriptionId));
}

/** Programa del Price recurrente (también un Price archivado: su Product tiene el slug como id). */
export async function programIdForPrice(
  db: Db,
  priceId: string | null,
  productId?: string | null,
): Promise<string | null> {
  if (priceId) {
    const byPrice = await db.program.findUnique({
      where: { stripePriceIdRecurring: priceId },
      select: { id: true },
    });
    if (byPrice) return byPrice.id;
  }
  if (productId) {
    const bySlug = await db.program.findUnique({
      where: { slug: productId },
      select: { id: true },
    });
    if (bySlug) return bySlug.id;
  }
  return null;
}

export type SyncResult =
  | { kind: "synced"; subscription: Subscription; previousStatus: SubscriptionStatus | null }
  /**
   * El contrato ya está ligado a otra suscripción (p. ej. dos pestañas de Checkout pagadas): esta
   * es un duplicado y no se guarda. Ferro la cancela en Stripe.
   */
  | { kind: "duplicate"; linkedTo: string };

/**
 * Crea o actualiza la fila Subscription del contrato con el estado actual de Stripe. Quien llama
 * ya bloqueó el contrato (`FOR UPDATE`), así que dos eventos de la misma suscripción se serializan.
 */
export async function upsertSubscription(
  contract: Pick<Contract, "id" | "customerId" | "programId">,
  snapshot: SubscriptionSnapshot,
  db: Db,
  now: Date = new Date(),
): Promise<SyncResult> {
  const existing = await db.subscription.findUnique({ where: { contractId: contract.id } });
  if (existing && existing.stripeSubscriptionId !== snapshot.stripeSubscriptionId) {
    return { kind: "duplicate", linkedTo: existing.stripeSubscriptionId };
  }
  const programId =
    (await programIdForPrice(db, snapshot.priceId)) ?? existing?.programId ?? contract.programId;
  const data = {
    status: snapshot.status,
    currentPeriodStart: snapshot.currentPeriodStart,
    currentPeriodEnd: snapshot.currentPeriodEnd,
    cancelAtPeriodEnd: snapshot.cancelAtPeriodEnd,
    programId,
  };
  if (existing) {
    const subscription = await db.subscription.update({ where: { id: existing.id }, data });
    return { kind: "synced", subscription, previousStatus: existing.status };
  }
  const subscription = await db.subscription.create({
    data: {
      ...data,
      customerId: contract.customerId,
      contractId: contract.id,
      stripeSubscriptionId: snapshot.stripeSubscriptionId,
      createdAt: now,
    },
  });
  return { kind: "synced", subscription, previousStatus: null };
}
