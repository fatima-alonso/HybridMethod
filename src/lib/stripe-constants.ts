/**
 * Constantes de Stripe sin dependencias (las usa también `scripts/stripe-listen.ts`, que no debe
 * cargar Prisma ni la configuración del servidor).
 */

/** `true` si la clave es de modo live (`sk_live_…` o `rk_live_…`). */
export function isLiveKey(key: string): boolean {
  return /^(sk|rk)_live_/.test(key);
}

/**
 * Intentos de cobro de una renovación de la suscripción (DECISIONS A32): el día de la renovación y
 * un reintento cada día siguiente, 3 días seguidos. Si ninguno pasa, la suscripción se cancela. Los
 * reintentos los programa Stripe (Dashboard → Billing → Revenue recovery, ver README); este número
 * solo se usa en los textos.
 */
export const SUBSCRIPTION_PAYMENT_ATTEMPTS = 3;

/**
 * Eventos de Stripe que escucha `POST /api/webhooks/stripe` (DECISIONS A6). Es la lista que se
 * configura en el endpoint del Dashboard y la que usa `npm run stripe:listen`.
 */
export const STRIPE_WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  // Suscripción (Fase 6): `invoice.paid` es la única fuente de sus pagos.
  "invoice.paid",
  "invoice.payment_failed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
] as const;
