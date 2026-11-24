import type { Contract, Payment, PaymentMethod } from "@/generated/prisma/client";
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
