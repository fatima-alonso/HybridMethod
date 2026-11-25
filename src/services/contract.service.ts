import type {
  Contract,
  ContractStatus,
  PaymentType,
  Prisma,
  Program,
} from "@/generated/prisma/client";
import { getConfig } from "@/lib/config";
import { getPrisma, type Db } from "@/lib/prisma";
import { businessYear, formatContractReference } from "@/utils/reference";

import {
  InvalidContractTransitionError,
  InvalidServicePeriodError,
  NotFoundError,
  ProgramUnavailableError,
} from "./errors";

/**
 * Contratos (SDD §5.3, DECISIONS A2, A3, A20). Único lugar donde cambia `Contract.status`.
 *
 * Máquina de estados:
 *   pending_payment ──> active | scheduled | expired
 *   expired         ──> active | scheduled   (pago tardío: se respeta, A20)
 *   scheduled       ──> active               (llega la fecha de inicio)
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
  pending_payment: ["active", "scheduled", "expired"],
  expired: ["active", "scheduled"],
  scheduled: ["active"],
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
export const NON_RENEWING: readonly PaymentType[] = ["transfer", "one_time"];

/** Estados que significan "pagado": el mes está por empezar, en curso o ya terminó. */
export const PAID_STATUSES: readonly ContractStatus[] = [
  "scheduled",
  "active",
  "completed",
  "payment_failed",
  "cancelled",
];

const DAY_MS = 24 * 60 * 60 * 1000;

/** Momento en que vence un contrato pendiente sin actividad (DECISIONS A20). */
export function pendingExpiresAt(
  lastActivityAt: Date,
  ttlDays: number = getConfig().PENDING_CONTRACT_TTL_DAYS,
): Date {
  return new Date(lastActivityAt.getTime() + ttlDays * DAY_MS);
}

type StatusFields = Pick<Contract, "status" | "paymentType" | "serviceEndDate"> &
  Partial<Pick<Contract, "serviceStartDate" | "lastActivityAt">>;

/**
 * Estado efectivo al leer el contrato, aunque el cron diario todavía no lo haya guardado
 * (SDD §5.3):
 * - `pending_payment` con 7 días sin actividad → `expired`.
 * - `scheduled` cuya fecha de inicio ya llegó → `active` (y `completed` si también terminó).
 * - `active` de pago único o transferencia cuyo periodo terminó → `completed`.
 */
export function effectiveContractStatus(
  contract: StatusFields,
  now: Date = new Date(),
  pendingTtlDays?: number,
): ContractStatus {
  const t = now.getTime();
  if (contract.status === "pending_payment") {
    if (
      contract.lastActivityAt &&
      pendingExpiresAt(contract.lastActivityAt, pendingTtlDays).getTime() <= t
    ) {
      return "expired";
    }
    return "pending_payment";
  }
  let status = contract.status;
  if (
    status === "scheduled" &&
    contract.serviceStartDate &&
    contract.serviceStartDate.getTime() <= t
  ) {
    status = "active";
  }
  if (
    status === "active" &&
    NON_RENEWING.includes(contract.paymentType) &&
    contract.serviceEndDate !== null &&
    contract.serviceEndDate.getTime() <= t
  ) {
    return "completed";
  }
  return status;
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

/** Importe de la modalidad (DECISIONS A18): la suscripción tiene 10 % de descuento. */
export function amountForPaymentType(
  program: Pick<Program, "monthlyPrice" | "subscriptionPrice">,
  paymentType: PaymentType,
): Prisma.Decimal {
  return paymentType === "subscription" ? program.subscriptionPrice : program.monthlyPrice;
}

/**
 * Crea un contrato `pending_payment`. El importe y la moneda se copian del programa en la BD según
 * la modalidad: nunca vienen del navegador (SDD §6.1, §9.2). El programa debe existir y estar activo.
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
      amount: amountForPaymentType(program, input.paymentType),
      currency: program.currency,
      lastActivityAt: now,
      createdAt: now,
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
 * confirma el pago: el periodo de Stripe, o `oneMonthServicePeriod` (DECISIONS A19).
 *
 * `options.from` restringe el estado de origen.
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

/**
 * Marca como pagado un contrato pendiente o vencido (pago tardío, DECISIONS A20): pasa a `active`
 * si su mes ya empezó o a `scheduled` si es un pago por adelantado que empieza después.
 */
export async function markContractPaid(
  contractId: string,
  period: ServicePeriod,
  db: Db = getPrisma(),
  now: Date = new Date(),
  options: { from: "pending_payment" | "expired" },
): Promise<Contract> {
  assertPeriod(period);
  const to: ContractStatus =
    period.serviceStartDate.getTime() > now.getTime() ? "scheduled" : "active";
  assertTransition(options.from, to);
  return transition(db, contractId, to, period, { status: options.from });
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
 * para el cron diario (SDD §7.8). Devuelve cuántos contratos cambiaron.
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

/** `scheduled → active` para los meses pagados por adelantado que ya empezaron (cron diario). */
export async function activateDueScheduledContracts(
  db: Db = getPrisma(),
  now: Date = new Date(),
): Promise<number> {
  const { count } = await db.contract.updateMany({
    where: { status: "scheduled", serviceStartDate: { lte: now } },
    data: { status: "active" },
  });
  return count;
}

/**
 * `pending_payment → expired` para los pendientes con 7 días sin actividad (DECISIONS A20). Con
 * `customerId`, solo los de ese cliente (antes de buscar su pendiente). Devuelve cuántos vencieron.
 */
export async function expireStalePendingContracts(
  db: Db = getPrisma(),
  now: Date = new Date(),
  options: { customerId?: string; ttlDays?: number } = {},
): Promise<number> {
  const ttlDays = options.ttlDays ?? getConfig().PENDING_CONTRACT_TTL_DAYS;
  const { count } = await db.contract.updateMany({
    where: {
      status: "pending_payment",
      lastActivityAt: { lte: new Date(now.getTime() - ttlDays * DAY_MS) },
      ...(options.customerId ? { customerId: options.customerId } : {}),
    },
    data: { status: "expired" },
  });
  return count;
}
