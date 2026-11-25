import type { Contract, ContractStatus, PaymentType, Prisma } from "@/generated/prisma/client";
import { getPrisma, type Db } from "@/lib/prisma";
import { businessYear, formatContractReference } from "@/utils/reference";

import {
  InvalidContractTransitionError,
  InvalidServicePeriodError,
  NotFoundError,
  ProgramUnavailableError,
} from "./errors";

/**
 * Contratos (SDD §5.3, DECISIONS A2, A3). Único lugar donde cambia `Contract.status`.
 *
 * Máquina de estados:
 *   pending_payment ──> active
 *   active          ──> completed | payment_failed | cancelled
 *   payment_failed  ──> active | cancelled
 *   completed, cancelled: finales.
 *
 * Cada transición es un "compare-and-set" (`UPDATE … WHERE id = ? AND status IN (…)`): si dos
 * procesos intentan la misma transición a la vez (p. ej. un webhook duplicado), solo uno gana y el
 * otro recibe `InvalidContractTransitionError`. Todas las funciones aceptan un cliente de
 * transacción para combinarse con Payment, TransferApproval y AuditLog (SDD §5.4).
 */

export const CONTRACT_TRANSITIONS: Readonly<Record<ContractStatus, readonly ContractStatus[]>> = {
  pending_payment: ["active"],
  active: ["completed", "payment_failed", "cancelled"],
  payment_failed: ["active", "cancelled"],
  completed: [],
  cancelled: [],
};

export function canTransition(from: ContractStatus, to: ContractStatus): boolean {
  return CONTRACT_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: ContractStatus, to: ContractStatus): void {
  if (!canTransition(from, to)) throw new InvalidContractTransitionError(from, to);
}

/** Estados desde los que se puede llegar a `to`. */
export function allowedSources(to: ContractStatus): ContractStatus[] {
  return (Object.keys(CONTRACT_TRANSITIONS) as ContractStatus[]).filter((from) =>
    canTransition(from, to),
  );
}

/** Modalidades cuyo periodo no se renueva solo: al vencer pasan a `completed` (DECISIONS A3). */
const NON_RENEWING: readonly PaymentType[] = ["transfer", "one_time"];

/**
 * Estado efectivo al leer el contrato: un contrato `active` de pago único o transferencia cuyo
 * periodo ya terminó se considera `completed`, aunque el cron todavía no lo haya actualizado.
 */
export function effectiveContractStatus(
  contract: Pick<Contract, "status" | "paymentType" | "serviceEndDate">,
  now: Date = new Date(),
): ContractStatus {
  if (
    contract.status === "active" &&
    NON_RENEWING.includes(contract.paymentType) &&
    contract.serviceEndDate !== null &&
    contract.serviceEndDate.getTime() <= now.getTime()
  ) {
    return "completed";
  }
  return contract.status;
}

// ─── Referencias ────────────────────────────────────────────────────────────

/**
 * Siguiente referencia `HM-AAAA-NNNNNN`. El consecutivo sale de la secuencia de PostgreSQL
 * `contract_reference_seq` (`nextval` es atómico), así que es seguro ante concurrencia.
 */
export async function nextContractReference(
  db: Db = getPrisma(),
  now: Date = new Date(),
): Promise<string> {
  const rows = await db.$queryRaw<
    Array<{ value: bigint }>
  >`SELECT nextval('contract_reference_seq') AS value`;
  const value = rows[0]?.value;
  if (value === undefined) throw new Error("La secuencia de referencias no devolvió un valor.");
  return formatContractReference(businessYear(now), value);
}

// ─── Creación ───────────────────────────────────────────────────────────────

export type CreateContractInput = {
  customerId: string;
  programSlug: string;
  paymentType: PaymentType;
};

/**
 * Crea un contrato `pending_payment`. El importe y la moneda se copian del programa en la BD:
 * nunca vienen del navegador (SDD §6.1, §9.2). El programa debe existir y estar activo.
 *
 * Quien llama es responsable de exigir la verificación OTP vigente (RN-12, Fase 3).
 */
export async function createContract(
  input: CreateContractInput,
  db: Db = getPrisma(),
  now: Date = new Date(),
): Promise<Contract> {
  const program = await db.program.findUnique({ where: { slug: input.programSlug } });
  if (!program || !program.active) throw new ProgramUnavailableError(input.programSlug);

  const reference = await nextContractReference(db, now);
  return db.contract.create({
    data: {
      reference,
      customerId: input.customerId,
      programId: program.id,
      paymentType: input.paymentType,
      status: "pending_payment",
      amount: program.monthlyPrice,
      currency: program.currency,
    },
  });
}

// ─── Transiciones ───────────────────────────────────────────────────────────

async function transition(
  db: Db,
  contractId: string,
  to: ContractStatus,
  data: Prisma.ContractUpdateManyMutationInput = {},
  extraWhere: Prisma.ContractWhereInput = {},
): Promise<Contract> {
  const { count } = await db.contract.updateMany({
    where: { id: contractId, status: { in: allowedSources(to) }, ...extraWhere },
    data: { ...data, status: to },
  });
  const contract = await db.contract.findUnique({ where: { id: contractId } });
  if (!contract) throw new NotFoundError("Contrato", contractId);
  if (count === 0) {
    // El contrato existe pero su estado (o la condición extra) no permite la transición.
    if (canTransition(contract.status, to)) {
      throw new InvalidServicePeriodError(
        `El contrato ${contract.reference} no cumple las condiciones para pasar a ${to}.`,
      );
    }
    throw new InvalidContractTransitionError(contract.status, to);
  }
  return contract;
}

export type ServicePeriod = { serviceStartDate: Date; serviceEndDate: Date };

function assertPeriod(period: ServicePeriod): void {
  if (period.serviceEndDate.getTime() <= period.serviceStartDate.getTime()) {
    throw new InvalidServicePeriodError("El fin del servicio debe ser posterior a su inicio.");
  }
}

/**
 * Activa el servicio tras un pago confirmado (RN-05): `pending_payment → active`, o
 * `payment_failed → active` cuando se paga el reintento. Las fechas del periodo las decide quien
 * confirma el pago: el periodo de Stripe, o `oneMonthServicePeriod` para pago único y
 * transferencia (DECISIONS A23).
 *
 * `options.from` restringe el estado de origen (p. ej. una transferencia solo se activa desde
 * `pending_payment`).
 */
export async function activateContract(
  contractId: string,
  period: ServicePeriod,
  db: Db = getPrisma(),
  options: { from?: ContractStatus } = {},
): Promise<Contract> {
  assertPeriod(period);
  if (options.from) assertTransition(options.from, "active");
  return transition(db, contractId, "active", period, options.from ? { status: options.from } : {});
}

/** `active → payment_failed` (suscripción `past_due`/`unpaid` o pago asíncrono fallido). */
export async function markContractPaymentFailed(
  contractId: string,
  db: Db = getPrisma(),
): Promise<Contract> {
  return transition(db, contractId, "payment_failed");
}

/** `active | payment_failed → cancelled`. Nunca recorta el periodo ya pagado. */
export async function cancelContract(contractId: string, db: Db = getPrisma()): Promise<Contract> {
  return transition(db, contractId, "cancelled");
}

/**
 * `active → completed` para un contrato de pago único o transferencia cuyo periodo terminó.
 * Falla si el periodo sigue vigente o si es una suscripción (esas se cancelan, no se completan).
 */
export async function completeContract(
  contractId: string,
  db: Db = getPrisma(),
  now: Date = new Date(),
): Promise<Contract> {
  return transition(
    db,
    contractId,
    "completed",
    {},
    { paymentType: { in: [...NON_RENEWING] }, serviceEndDate: { lte: now } },
  );
}

/**
 * Marca como `completed` todos los contratos de pago único o transferencia vencidos. Pensado
 * para el cron diario de Vercel (SDD §11.2). Devuelve cuántos contratos cambiaron.
 */
export async function completeExpiredContracts(
  db: Db = getPrisma(),
  now: Date = new Date(),
): Promise<number> {
  const { count } = await db.contract.updateMany({
    where: {
      status: "active",
      paymentType: { in: [...NON_RENEWING] },
      serviceEndDate: { lte: now },
    },
    data: { status: "completed" },
  });
  return count;
}
