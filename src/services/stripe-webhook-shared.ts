import type {
  Contract,
  ContractStatus,
  Customer,
  Program,
  WebhookEventStatus,
} from "@/generated/prisma/client";
import type { Db } from "@/lib/prisma";

import { recordAudit } from "./audit.service";

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
