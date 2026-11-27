import type {
  Prisma,
  Contract,
  ContractStatus,
  Customer,
  Program,
  WebhookEventStatus,
} from "@/generated/prisma/client";
import type { Db } from "@/lib/prisma";

import { recordAudit } from "./audit.service";
import type { AppliedDiscount } from "./discount.service";

/**
 * Piezas comunes de los webhooks de Stripe (pago único y suscripción, SDD §7.5). Solo las usan
 * `stripe-webhook.service` y `stripe-subscription-webhook.service`.
 */

/** Resultado de aplicar un evento dentro de la transacción. */
export type Handled = {
  status: Exclude<WebhookEventStatus, "received">;
  note?: string;
  /** Correos que se envían después de confirmar la transacción. */
  after?: (db: Db) => Promise<void>;
};

export type ContractWithRelations = Contract & { customer: Customer; program: Program };

/** Estados en que un contrato todavía se puede pagar (pago tardío incluido, DECISIONS A20). */
export const UNPAID: readonly ContractStatus[] = ["pending_payment", "expired"];

const UUID = /^[0-9a-f-]{36}$/i;

/** Bloquea el contrato (`FOR UPDATE`) y lo devuelve con su cliente y programa, o `null`. */
export async function lockContract(
  contractId: string | null | undefined,
  tx: Db,
): Promise<ContractWithRelations | null> {
  if (!contractId || !UUID.test(contractId)) return null;
  const locked = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "contracts" WHERE "id" = ${contractId}::uuid FOR UPDATE`;
  if (locked.length === 0) return null;
  return tx.contract.findUnique({
    where: { id: contractId },
    include: { customer: true, program: true },
  });
}

/** Envía un correo después de la transacción; si falla, lo registra sin revertir nada (SDD §6.2). */
export async function notifyQuietly(
  db: Db,
  contract: Pick<Contract, "id" | "reference">,
  name: string,
  send: () => Promise<unknown>,
): Promise<void> {
  try {
    await send();
  } catch (error) {
    console.error(
      `[stripe.webhook] No se pudo enviar ${name} para ${contract.reference}:`,
      error instanceof Error ? error.name : "error desconocido",
    );
    await recordAudit(
      {
        action: "payment.notification_failed",
        actor: "system",
        entityType: "Contract",
        entityId: contract.id,
        metadata: { reference: contract.reference, email: name },
      },
      db,
    ).catch(() => undefined);
  }
}

type Money = { amount: Prisma.Decimal; currency: string };

/**
 * Audita lo que cobró Stripe frente a lo esperado (SDD §7.5). Con un cupón (Fase 7B, DECISIONS A34)
 * se audita `stripe.discount_applied` y se compara el precio antes del descuento: un cobro menor por
 * un cupón no es un error. Si aun así no coincide, `stripe.amount_mismatch` (el cobro se respeta).
 */
export async function auditChargedAmount(
  input: {
    contract: Pick<Contract, "id" | "reference">;
    paymentId: string;
    charged: Money;
    expected: Money;
    discount: AppliedDiscount | null;
  },
  tx: Db,
): Promise<void> {
  const { contract, charged, expected, discount } = input;
  const base = { actor: "stripe" as const, entityType: "Contract", entityId: contract.id };
  if (discount) {
    await recordAudit(
      {
        ...base,
        action: "stripe.discount_applied",
        metadata: {
          reference: contract.reference,
          paymentId: input.paymentId,
          // "coupon" y no "promotionCode": la auditoría rechaza claves con "code" (OTP).
          coupon: discount.promotionCode,
          discount: discount.amount.toFixed(2),
          charged: `${charged.amount.toFixed(2)} ${charged.currency}`,
        },
      },
      tx,
    );
  }
  const beforeDiscount = discount ? charged.amount.plus(discount.amount) : charged.amount;
  if (!beforeDiscount.equals(expected.amount) || charged.currency !== expected.currency) {
    await recordAudit(
      {
        ...base,
        action: "stripe.amount_mismatch",
        metadata: {
          reference: contract.reference,
          charged: `${charged.amount.toFixed(2)} ${charged.currency}`,
          expected: `${expected.amount.toFixed(2)} ${expected.currency}`,
          ...(discount ? { discount: discount.amount.toFixed(2) } : {}),
        },
      },
      tx,
    );
  }
}
