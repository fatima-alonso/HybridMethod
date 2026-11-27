import type Stripe from "stripe";

import type { Prisma } from "@/generated/prisma/client";
import { fromMinorUnits } from "@/lib/stripe";

/**
 * Cupones de descuento de Stripe (Fase 7B, DECISIONS A34). Ferro crea los cupones y los códigos en
 * el Dashboard; el cliente escribe el código en el formulario de pago y Stripe calcula el descuento.
 * La app solo lee lo que Stripe aplicó: el importe nunca sale del navegador (SDD §9.2).
 */

export type AppliedDiscount = {
  /** Monto descontado en este cobro. */
  amount: Prisma.Decimal;
  /** Código que escribió el cliente (p. ej. `VERANO20`), o `null` si Stripe no lo informó. */
  promotionCode: string | null;
};

/** Cliente de Stripe mínimo para leer el texto de un código promocional. */
export type PromotionCodeReader = Pick<Stripe, "promotionCodes"> | null;

/**
 * Texto del código promocional (`promo_…` → `VERANO20`). Es solo para mostrarlo: si Stripe no
 * responde, se registra el descuento sin el código en lugar de fallar el pago.
 */
export async function resolvePromotionCode(
  stripe: PromotionCodeReader,
  ref: string | Stripe.PromotionCode | null | undefined,
): Promise<string | null> {
  if (!ref) return null;
  if (typeof ref !== "string") return ref.code ?? null;
  if (!stripe) return null;
  try {
    return (await stripe.promotionCodes.retrieve(ref)).code ?? null;
  } catch (error) {
    console.warn(
      `[stripe.discount] No se pudo leer el código ${ref}:`,
      error instanceof Error ? error.name : "error desconocido",
    );
    return null;
  }
}

/** Descuento de una sesión de Checkout en modo `payment`, o `null` si no lleva cupón. */
export async function checkoutSessionDiscount(
  session: Stripe.Checkout.Session,
  stripe: PromotionCodeReader,
): Promise<AppliedDiscount | null> {
  const minor = session.total_details?.amount_discount ?? 0;
  if (minor <= 0) return null;
  const discount = session.discounts?.find((d) => d.promotion_code) ?? session.discounts?.[0];
  return {
    amount: fromMinorUnits(minor),
    promotionCode: await resolvePromotionCode(stripe, discount?.promotion_code),
  };
}

/**
 * Descuento de una factura de la suscripción, o `null`. `fallbackCode` es el código del cupón
 * vigente de la suscripción, para cuando la factura solo trae los IDs de sus descuentos.
 */
export async function invoiceDiscount(
  invoice: Stripe.Invoice,
  stripe: PromotionCodeReader,
  fallbackCode: string | null,
): Promise<AppliedDiscount | null> {
  const minor = (invoice.total_discount_amounts ?? []).reduce((sum, d) => sum + d.amount, 0);
  if (minor <= 0) return null;
  const expanded = (invoice.discounts ?? []).find(
    (d): d is Stripe.Discount => typeof d !== "string" && !("deleted" in d && d.deleted),
  );
  const code = expanded ? await resolvePromotionCode(stripe, expanded.promotion_code) : null;
  return { amount: fromMinorUnits(minor), promotionCode: code ?? fallbackCode };
}

/** ID del código promocional del primer descuento de la suscripción (para leer su texto). */
export function subscriptionPromotionCodeRef(
  subscription: Stripe.Subscription,
): string | Stripe.PromotionCode | null {
  for (const discount of subscription.discounts ?? []) {
    if (typeof discount === "string") continue;
    if (discount.promotion_code) return discount.promotion_code;
  }
  return null;
}
