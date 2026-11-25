import type { Contract, PaymentType, Program } from "@/generated/prisma/client";
import type { Db } from "@/lib/prisma";

import { recordAudit, type AuditActor } from "./audit.service";
import {
  amountForPaymentType,
  createContract,
  expireStalePendingContracts,
} from "./contract.service";
import {
  PendingContractExistsError,
  PrepaidLimitError,
  ProgramUnavailableError,
  SubscriptionActiveError,
  type PendingContractSummary,
} from "./errors";

/**
 * Reglas antes de crear cualquier contrato (SDD §7.3, DECISIONS A20). Las usan `POST /api/transfers`
 * y, en la Fase 5, `POST /api/checkout`.
 *
 * Quien llama debe estar dentro de una transacción con el `pg_advisory_xact_lock` del cliente y
 * haber validado la sesión de verificación (RN-12).
 */

export type PendingAction = "continue" | "change";

export type ContractRequest = {
  customerId: string;
  programSlug: string;
  paymentType: PaymentType;
  /** Respuesta del cliente a "¿continuar con el pendiente o cambiarlo?". */
  pendingAction?: PendingAction;
};

export type ContractRequestOutcome =
  /** No había pendiente: se creó un contrato nuevo. */
  | "created"
  /** Había un pendiente del mismo programa y modalidad: se reutiliza. */
  | "reused"
  /** Había otro pendiente y el cliente eligió continuar con él tal cual. */
  | "continued"
  /** Había otro pendiente y el cliente eligió cambiarlo a lo que pidió ahora. */
  | "changed";

export type ContractRequestResult = {
  outcome: ContractRequestOutcome;
  contract: Contract;
  program: Program;
  /** Modalidad que tenía el pendiente antes de cambiarlo (solo con `changed`). */
  previousPaymentType?: PaymentType;
};

/** Suscripciones que impiden otra contratación: el cliente cambia de plan en el portal (A21). */
const BLOCKING_SUBSCRIPTION_STATUSES = ["incomplete", "active", "past_due", "unpaid"] as const;

export function summarizeContract(contract: Contract, program: Program): PendingContractSummary {
  return {
    reference: contract.reference,
    programSlug: program.slug,
    programName: program.name,
    paymentType: contract.paymentType,
    amount: contract.amount.toFixed(2),
    currency: contract.currency,
  };
}

export async function resolveContractRequest(
  input: ContractRequest,
  tx: Db,
  now: Date = new Date(),
  context: { ip?: string | null; userAgent?: string | null } = {},
): Promise<ContractRequestResult> {
  const { customerId } = input;
  const actor: AuditActor = `customer:${customerId}`;

  // 1. Vencer los pendientes del cliente con 7 días sin actividad.
  await expireStalePendingContracts(tx, now, { customerId });

  // 2. Con una suscripción activa no se crea otra contratación (la página ofrece el portal).
  const subscription = await tx.subscription.findFirst({
    where: { customerId, status: { in: [...BLOCKING_SUBSCRIPTION_STATUSES] } },
    select: { id: true },
  });
  if (subscription) throw new SubscriptionActiveError();

  // 3. Un solo pendiente por cliente.
  const pending = await tx.contract.findFirst({
    where: { customerId, status: "pending_payment" },
    include: { program: true },
  });
  if (pending) {
    const { program: pendingProgram, ...pendingContract } = pending;
    const same =
      pendingProgram.slug === input.programSlug && pending.paymentType === input.paymentType;
    if (same || input.pendingAction === "continue") {
      const contract = await tx.contract.update({
        where: { id: pending.id },
        data: { lastActivityAt: now },
      });
      return { outcome: same ? "reused" : "continued", contract, program: pendingProgram };
    }
    if (input.pendingAction !== "change") {
      throw new PendingContractExistsError(summarizeContract(pendingContract, pendingProgram));
    }

    const program = await tx.program.findUnique({ where: { slug: input.programSlug } });
    if (!program || !program.active) throw new ProgramUnavailableError(input.programSlug);
    const contract = await tx.contract.update({
      where: { id: pending.id, status: "pending_payment" },
      data: {
        programId: program.id,
        paymentType: input.paymentType,
        amount: amountForPaymentType(program, input.paymentType),
        currency: program.currency,
        lastActivityAt: now,
      },
    });
    await recordAudit(
      {
        action: "contract.pending_changed",
        actor,
        entityType: "Contract",
        entityId: contract.id,
        ip: context.ip,
        userAgent: context.userAgent,
        metadata: {
          reference: contract.reference,
          from: { program: pendingProgram.slug, paymentType: pending.paymentType },
          to: { program: program.slug, paymentType: input.paymentType },
        },
      },
      tx,
    );
    return { outcome: "changed", contract, program, previousPaymentType: pending.paymentType };
  }

  // 4. Un solo mes por adelantado: si ya hay uno pagado que todavía no empieza, no se permite otro.
  const prepaid = await tx.contract.findFirst({
    where: { customerId, status: "scheduled", serviceStartDate: { gt: now } },
    select: { id: true },
  });
  if (prepaid) throw new PrepaidLimitError();

  const contract = await createContract(
    { customerId, programSlug: input.programSlug, paymentType: input.paymentType },
    tx,
    now,
  );
  const program = await tx.program.findUniqueOrThrow({ where: { id: contract.programId } });
  return { outcome: "created", contract, program };
}

/**
 * Resumen del contrato pendiente del cliente con ese correo, o `null` (`GET /api/contracts/pending`).
 * Solo para el dueño del correo verificado (RF-15): quien llama toma el correo de la sesión.
 * Antes de buscar, vence los pendientes sin actividad.
 */
export async function findPendingContractSummary(
  verifiedEmail: string,
  db: Db,
  now: Date = new Date(),
): Promise<PendingContractSummary | null> {
  const customer = await db.customer.findUnique({
    where: { email: verifiedEmail },
    select: { id: true },
  });
  if (!customer) return null;
  await expireStalePendingContracts(db, now, { customerId: customer.id });
  const pending = await db.contract.findFirst({
    where: { customerId: customer.id, status: "pending_payment" },
    include: { program: true },
  });
  if (!pending) return null;
  const { program, ...contract } = pending;
  return summarizeContract(contract, program);
}
