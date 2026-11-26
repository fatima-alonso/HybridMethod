import type { Contract, Payment, PaymentMethod, Prisma } from "@/generated/prisma/client";
import { getPrisma, type Db } from "@/lib/prisma";

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
  /** Importe que cobró Stripe (no el del navegador), ya convertido a `Decimal`. */
  amount: Prisma.Decimal;
  currency: string;
};

/**
 * Registra un pago exitoso de Stripe. `stripePaymentIntentId` y `stripeInvoiceId` son UNIQUE: una
 * segunda barrera contra duplicados además de WebhookEvent (SDD §5.3).
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
      amount: input.amount,
      currency: input.currency,
      status: "succeeded",
      paidAt,
      createdAt: paidAt,
    },
  });
}

/** Registra un pago de Stripe que no se completó (p. ej. un pago asíncrono fallido). */
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
      amount: input.amount,
      currency: input.currency,
      status: "failed",
      paidAt: null,
      createdAt: failedAt,
    },
  });
}
