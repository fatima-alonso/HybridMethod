import type { Contract, Payment, PaymentMethod, Prisma } from "@/generated/prisma/client";
import { getPrisma, type Db } from "@/lib/prisma";

import type { AppliedDiscount } from "./discount.service";

/**
 * Pagos (SDD §5.3). Un Payment nunca se sobrescribe: cada pago confirmado es un registro nuevo
 * (SDD §5.4). Se llama dentro de la misma transacción que activa el contrato.
 */

/**
 * Registra un pago exitoso por el importe del contrato (que a su vez salió del programa en la BD:
 * nunca del navegador). Para transferencias, `paidAt` es el momento en que Ferro confirma.
 */
export function recordSucceededPayment(
  contract: Pick<Contract, "id" | "amount" | "currency">,
  method: PaymentMethod,
  db: Db = getPrisma(),
  paidAt: Date = new Date(),
): Promise<Payment> {
  return db.payment.create({
    data: {
      contractId: contract.id,
      method,
      amount: contract.amount,
      currency: contract.currency,
      status: "succeeded",
      paidAt,
      createdAt: paidAt,
    },
  });
}

export type StripePaymentInput = {
  contractId: string;
  method: Extract<PaymentMethod, "stripe_one_time" | "stripe_subscription">;
  stripePaymentIntentId: string | null;
  stripeInvoiceId?: string | null;
  /** Suscripción local (Fase 6). */
  subscriptionId?: string | null;
  /** Importe que cobró Stripe (no el del navegador), ya convertido a `Decimal`. */
  amount: Prisma.Decimal;
  currency: string;
  /** Cupón aplicado por Stripe (Fase 7B, DECISIONS A34). */
  discount?: AppliedDiscount | null;
};

/**
 * Registra un pago exitoso de Stripe. `stripePaymentIntentId` y `stripeInvoiceId` son UNIQUE entre los
 * pagos exitosos: una segunda barrera contra duplicados además de WebhookEvent (SDD §5.3, A31).
 */
export function recordStripePayment(
  input: StripePaymentInput,
  db: Db = getPrisma(),
  paidAt: Date = new Date(),
): Promise<Payment> {
  return db.payment.create({
    data: {
      contractId: input.contractId,
      method: input.method,
      stripePaymentIntentId: input.stripePaymentIntentId,
      stripeInvoiceId: input.stripeInvoiceId ?? null,
      subscriptionId: input.subscriptionId ?? null,
      amount: input.amount,
      currency: input.currency,
      discountAmount: input.discount?.amount ?? null,
      promotionCode: input.discount?.promotionCode ?? null,
      status: "succeeded",
      paidAt,
      createdAt: paidAt,
    },
  });
}

/**
 * Registra un pago de Stripe que no se completó (un pago asíncrono fallido o un intento de cobro de
 * una factura de suscripción). Cada intento es un registro nuevo (RF-18).
 */
export function recordFailedStripePayment(
  input: StripePaymentInput,
  db: Db = getPrisma(),
  failedAt: Date = new Date(),
): Promise<Payment> {
  return db.payment.create({
    data: {
      contractId: input.contractId,
      method: input.method,
      stripePaymentIntentId: input.stripePaymentIntentId,
      stripeInvoiceId: input.stripeInvoiceId ?? null,
      subscriptionId: input.subscriptionId ?? null,
      amount: input.amount,
      currency: input.currency,
      status: "failed",
      paidAt: null,
      createdAt: failedAt,
    },
  });
}
