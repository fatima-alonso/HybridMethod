import Stripe from "stripe";

import { Prisma } from "@/generated/prisma/client";
import { getConfig } from "@/lib/config";

/**
 * Cliente de Stripe (SDD §6.1, §9.2). Solo para código de servidor.
 *
 * - `getStripe()` devuelve `null` si no hay `STRIPE_SECRET_KEY` (solo desarrollo y pruebas: en
 *   producción es obligatoria, DECISIONS A9). Sin clave, el pago con tarjeta responde
 *   `503 payments_unavailable` y la transferencia sigue funcionando.
 * - La firma de los webhooks se verifica con `Stripe.webhooks`, que no necesita la clave secreta,
 *   solo `STRIPE_WEBHOOK_SECRET`.
 *
 * La versión de la API es la del SDK instalado (`Stripe.API_VERSION`): fijar el paquete en
 * `package.json` fija también la API. El endpoint del webhook en Stripe debe usar la misma versión.
 */

let client: Stripe | null = null;
let clientKey: string | undefined;

export function getStripe(): Stripe | null {
  const key = getConfig().STRIPE_SECRET_KEY;
  if (!key) return null;
  if (!client || clientKey !== key) {
    client = new Stripe(key, {
      maxNetworkRetries: 2,
      timeout: 20_000,
      appInfo: { name: "the-hybrid-method" },
    });
    clientKey = key;
  }
  return client;
}

/** Verificación de firmas de webhooks (no necesita la clave secreta). */
export const stripeWebhooks = Stripe.webhooks;

/** `true` si la clave es de modo live (`sk_live_…` o `rk_live_…`). */
export function isLiveKey(key: string): boolean {
  return /^(sk|rk)_live_/.test(key);
}

/**
 * Importe decimal → unidades mínimas de Stripe (centavos). Exacto: `Decimal`, nunca `float`.
 * Lanza si el importe tiene más de dos decimales (no se puede cobrar exacto).
 */
export function toMinorUnits(amount: Prisma.Decimal | string): number {
  const cents = new Prisma.Decimal(amount).mul(100);
  if (!cents.isInteger())
    throw new Error(`El importe ${amount.toString()} tiene más de 2 decimales.`);
  return cents.toNumber();
}

/** Unidades mínimas de Stripe (centavos) → `Decimal` con dos decimales. */
export function fromMinorUnits(minor: number): Prisma.Decimal {
  if (!Number.isSafeInteger(minor)) throw new Error("Importe de Stripe inválido.");
  return new Prisma.Decimal(minor).div(100).toDecimalPlaces(2);
}

/** Moneda de Stripe (minúsculas) → ISO en mayúsculas, como en la BD. */
export function normalizeCurrency(currency: string): string {
  return currency.toUpperCase();
}
