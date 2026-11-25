import type {
  Contract,
  ContractStatus,
  Customer,
  Payment,
  Program,
  TransferApproval,
} from "@/generated/prisma/client";
import { ApprovalPinNotConfiguredError, verifyApprovalPin } from "@/lib/approval-pin";
import { getConfig, getWhatsAppNumber } from "@/lib/config";
import { hashToken } from "@/lib/crypto";
import { getPrisma, type Db } from "@/lib/prisma";
import { formatBusinessDateTime } from "@/utils/format";
import { oneMonthServicePeriod } from "@/utils/service-period";
import { buildWhatsAppLink } from "@/utils/whatsapp";

import { recordAudit } from "./audit.service";
import { activateContract, effectiveContractStatus } from "./contract.service";
import {
  sendPaymentReceivedEmail,
  sendTransferConfirmedEmail,
  sendWelcomeEmail,
} from "./email.service";
import {
  ContractNotPendingError,
  InvalidApprovalPinError,
  NotFoundError,
  ServiceError,
  TransferLinkUnavailableError,
  type TransferLinkProblem,
} from "./errors";
import { recordSucceededPayment } from "./payment.service";
import {
  createTransferApproval,
  formatContractAmount,
  sendTransferPendingNotification,
  TRANSFER_APPROVAL_MAX_PIN_ATTEMPTS,
  type RequestContext,
} from "./transfer.service";

/**
 * Confirmación manual de transferencias (RF-11, RF-12, RF-20, RN-04, RN-05, DECISIONS A5, A7).
 *
 * - `getTransferApprovalView`: lo que muestra `GET /transfer/confirm/[token]`. Solo lectura: no
 *   toca el token ni el contrato (un escáner de correo que abra el enlace no cambia nada).
 * - `confirmTransfer`: `POST /api/transfers/confirm` con `{ token, pin }`. Es la única acción: no
 *   existe `reject`.
 * - `regenerateTransferLink`: `POST /api/transfers/regenerate` con `{ reference, pin }`.
 *
 * Cada intento de PIN sobre un enlace se cuenta con un compare-and-set ANTES de comparar el PIN
 * (como los OTP, DECISIONS A16): con solicitudes simultáneas nunca se prueban más de 5 PIN por
 * enlace. Si el PIN es correcto, ese intento se descuenta al aprobar, así que `pinAttempts` sigue
 * siendo el número de PIN incorrectos.
 */

/** Formato de los tokens que genera `generateToken()` (32 bytes en base64url). */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function isWellFormedToken(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}

export const TRANSFER_METHOD_LABEL = "Transferencia bancaria";

type ApprovalWithContract = TransferApproval & {
  contract: Contract & { customer: Customer; program: Program };
};

/** Estado del enlace según SDD §5.3: válido solo sin usar, sin invalidar, vigente y con < 5 fallos. */
export function approvalLinkState(
  approval: Pick<TransferApproval, "usedAt" | "invalidatedAt" | "expiresAt" | "pinAttempts">,
  now: Date = new Date(),
): "valid" | Exclude<TransferLinkProblem, "not_found"> {
  if (approval.usedAt) return "used";
  if (approval.invalidatedAt || approval.pinAttempts >= TRANSFER_APPROVAL_MAX_PIN_ATTEMPTS) {
    return "invalidated";
  }
  if (approval.expiresAt.getTime() <= now.getTime()) return "expired";
  return "valid";
}

async function findApproval(token: string, db: Db): Promise<ApprovalWithContract | null> {
  if (!isWellFormedToken(token)) return null;
  return db.transferApproval.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { contract: { include: { customer: true, program: true } } },
  });
}

// ─── Vista del enlace (solo lectura) ────────────────────────────────────────

export type TransferApprovalDetails = {
  reference: string;
  customerName: string;
  customerEmail: string;
  programName: string;
  /** Importe ya formateado (p. ej. "$1,200 MXN"). */
  amount: string;
  method: string;
  status: ContractStatus;
  createdAt: Date;
};

export type TransferApprovalView =
  | { state: "not_found" }
  | {
      state: "valid";
      details: TransferApprovalDetails;
      expiresAt: Date;
      remainingAttempts: number;
    }
  | {
      state: "used";
      reference: string;
      usedAt: Date;
      serviceStartDate: Date | null;
      serviceEndDate: Date | null;
    }
  /** El enlace expiró o se invalidó. `canRegenerate` si el contrato sigue pendiente (RF-20). */
  | { state: "expired" | "invalidated"; reference: string; canRegenerate: boolean }
  /** El enlace sería válido, pero el contrato ya no está pendiente (no debería ocurrir). */
  | { state: "contract_not_pending"; reference: string; status: ContractStatus };

/**
 * Lo que ve Ferro al abrir el enlace. Solo lee: no modifica el token ni el contrato. Los datos del
 * cliente solo se muestran con un enlace válido; con uno expirado, usado o invalidado solo se
 * muestra la referencia.
 */
export async function getTransferApprovalView(
  token: string,
  db: Db = getPrisma(),
  now: Date = new Date(),
): Promise<TransferApprovalView> {
  const approval = await findApproval(token, db);
  if (!approval) return { state: "not_found" };
  const { contract } = approval;
  const state = approvalLinkState(approval, now);

  if (state === "used") {
    return {
      state,
      reference: contract.reference,
      usedAt: approval.usedAt!,
      serviceStartDate: contract.serviceStartDate,
      serviceEndDate: contract.serviceEndDate,
    };
  }
  if (state !== "valid") {
    return {
      state,
      reference: contract.reference,
      canRegenerate: contract.status === "pending_payment",
    };
  }
  if (contract.status !== "pending_payment") {
    return {
      state: "contract_not_pending",
      reference: contract.reference,
      status: effectiveContractStatus(contract, now),
    };
  }
  return {
    state: "valid",
    details: {
      reference: contract.reference,
      customerName: contract.customer.fullName,
      customerEmail: contract.customer.email,
      programName: contract.program.name,
      amount: formatContractAmount(contract),
      method: TRANSFER_METHOD_LABEL,
      status: contract.status,
      createdAt: contract.createdAt,
    },
    expiresAt: approval.expiresAt,
    remainingAttempts: TRANSFER_APPROVAL_MAX_PIN_ATTEMPTS - approval.pinAttempts,
  };
}

// ─── Confirmación ───────────────────────────────────────────────────────────

export type ConfirmTransferInput = { token: string; pin: string };

export type ConfirmTransferResult = {
  contract: Contract;
  payment: Payment;
  customer: Customer;
  program: Program;
};

function pinHashOrThrow(pinHash: string | undefined): string {
  if (!pinHash) throw new ApprovalPinNotConfiguredError();
  return pinHash;
}

/** Vuelve a leer el enlace para explicar por qué una operación atómica no lo pudo usar. */
async function unavailableError(
  approvalId: string,
  db: Db,
  now: Date,
): Promise<TransferLinkUnavailableError | ContractNotPendingError> {
  const fresh = await db.transferApproval.findUnique({
    where: { id: approvalId },
    include: { contract: true },
  });
  if (!fresh) return new TransferLinkUnavailableError("not_found");
  const state = approvalLinkState(fresh, now);
  if (state === "valid") {
    return new ContractNotPendingError(fresh.contract.reference, fresh.contract.status);
  }
  return new TransferLinkUnavailableError(state, fresh.contract.reference);
}

/**
 * Cuenta un intento de PIN sobre el enlace si sigue válido. Devuelve el nuevo número de intentos,
 * o `null` si el enlace ya no se puede usar.
 */
async function reservePinAttempt(approvalId: string, db: Db, now: Date): Promise<number | null> {
  const rows = await db.$queryRaw<Array<{ pinAttempts: number }>>`
    UPDATE "transfer_approvals" SET "pinAttempts" = "pinAttempts" + 1
    WHERE "id" = ${approvalId}::uuid AND "usedAt" IS NULL AND "invalidatedAt" IS NULL
      AND "expiresAt" > ${now} AND "pinAttempts" < ${TRANSFER_APPROVAL_MAX_PIN_ATTEMPTS}
    RETURNING "pinAttempts"`;
  return rows[0]?.pinAttempts ?? null;
}

/**
 * Confirma una transferencia (RF-12, SDD §7.6):
 * 1. Valida el token (hash, sin usar, sin invalidar, vigente) y que el contrato siga pendiente.
 * 2. Cuenta el intento y verifica el PIN. Si es incorrecto, lo registra en la auditoría; al quinto
 *    error invalida el enlace. El contrato sigue en `pending_payment` (RF-20).
 * 3. En una sola transacción: marca el enlace como usado (`approvedBy = "ferro"`), crea el Payment,
 *    activa el contrato con su periodo (DECISIONS A23) y escribe la auditoría con IP y user-agent.
 * 4. Después envía Transfer Confirmed y Welcome al cliente y Payment Received a Ferro. Un fallo de
 *    correo se registra y nunca revierte el pago (SDD §6.2).
 */
export async function confirmTransfer(
  input: ConfirmTransferInput,
  context: RequestContext = {},
  db = getPrisma(),
  now: Date = new Date(),
  pinHash: string | undefined = getConfig().FERRO_APPROVAL_PIN_HASH,
): Promise<ConfirmTransferResult> {
  const hash = pinHashOrThrow(pinHash);

  const approval = await findApproval(input.token, db);
  if (!approval) throw new TransferLinkUnavailableError("not_found");
  const { contract } = approval;
  const state = approvalLinkState(approval, now);
  if (state !== "valid") throw new TransferLinkUnavailableError(state, contract.reference);
  if (contract.status !== "pending_payment") {
    throw new ContractNotPendingError(contract.reference, contract.status);
  }

  const attempts = await reservePinAttempt(approval.id, db, now);
  if (attempts === null) throw await unavailableError(approval.id, db, now);

  if (!(await verifyApprovalPin(input.pin, hash))) {
    const remaining = TRANSFER_APPROVAL_MAX_PIN_ATTEMPTS - attempts;
    await db.$transaction(async (tx) => {
      if (remaining <= 0) {
        await tx.transferApproval.updateMany({
          where: { id: approval.id, usedAt: null, invalidatedAt: null },
          data: { invalidatedAt: now },
        });
      }
      await recordAudit(
        {
          action: "transfer.pin_failed",
          actor: "system",
          entityType: "TransferApproval",
          entityId: approval.id,
          ip: context.ip,
          userAgent: context.userAgent,
          metadata: {
            reference: contract.reference,
            failedAttempts: attempts,
            linkInvalidated: remaining <= 0,
          },
        },
        tx,
      );
    });
    throw new InvalidApprovalPinError(Math.max(0, remaining));
  }

  const result = await db.$transaction(async (tx) => {
    // Mismo orden de bloqueo que la regeneración (contrato → enlace) para no provocar un deadlock.
    await tx.$queryRaw`SELECT 1 FROM "contracts" WHERE "id" = ${contract.id}::uuid FOR UPDATE`;
    const { count } = await tx.transferApproval.updateMany({
      where: { id: approval.id, usedAt: null, invalidatedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now, approvedBy: "ferro", pinAttempts: { decrement: 1 } },
    });
    if (count === 0) throw await unavailableError(approval.id, tx, now);

    let activated: Contract;
    try {
      activated = await activateContract(contract.id, oneMonthServicePeriod(now), tx, {
        from: "pending_payment",
      });
    } catch (error) {
      if (error instanceof ServiceError && !(error instanceof NotFoundError)) {
        const current = await tx.contract.findUniqueOrThrow({ where: { id: contract.id } });
        throw new ContractNotPendingError(current.reference, current.status);
      }
      throw error;
    }
    const payment = await recordSucceededPayment(activated, "transfer", tx, now);
    await recordAudit(
      {
        action: "transfer.approved",
        actor: "ferro",
        entityType: "Contract",
        entityId: contract.id,
        ip: context.ip,
        userAgent: context.userAgent,
        metadata: {
          reference: contract.reference,
          approvalId: approval.id,
          paymentId: payment.id,
          amount: payment.amount.toFixed(2),
          currency: payment.currency,
          serviceStartDate: activated.serviceStartDate!.toISOString(),
          serviceEndDate: activated.serviceEndDate!.toISOString(),
        },
      },
      tx,
    );
    return { contract: activated, payment };
  });

  const confirmed: ConfirmTransferResult = {
    ...result,
    customer: contract.customer,
    program: contract.program,
  };
  await sendConfirmationEmails(confirmed, db);
  return confirmed;
}

async function sendConfirmationEmails(result: ConfirmTransferResult, db: Db): Promise<void> {
  const { contract, customer, program } = result;
  const serviceStart = formatBusinessDateTime(contract.serviceStartDate!);
  const serviceEnd = formatBusinessDateTime(contract.serviceEndDate!);
  const amount = formatContractAmount(contract);
  const whatsappNumber = getWhatsAppNumber();

  const emails: Array<[string, () => Promise<unknown>]> = [
    [
      "transfer_confirmed",
      () =>
        sendTransferConfirmedEmail({
          to: customer.email,
          customerName: customer.fullName,
          reference: contract.reference,
          programName: program.name,
          amount,
          serviceStart,
          serviceEnd,
        }),
    ],
    [
      "welcome",
      () =>
        sendWelcomeEmail({
          to: customer.email,
          customerName: customer.fullName,
          programName: program.name,
          serviceStart,
          serviceEnd,
          whatsappUrl: whatsappNumber
            ? buildWhatsAppLink(
                whatsappNumber,
                `Hola Ferro, soy ${customer.fullName}. Ya está activo mi plan de ${program.name} (${contract.reference}).`,
              )
            : null,
        }),
    ],
    [
      "payment_received",
      () =>
        sendPaymentReceivedEmail({
          reference: contract.reference,
          customerName: customer.fullName,
          customerEmail: customer.email,
          customerWhatsapp: customer.whatsapp,
          programName: program.name,
          amount,
          method: `${TRANSFER_METHOD_LABEL} (confirmada por ti)`,
          serviceStart,
          serviceEnd,
        }),
    ],
  ];

  for (const [name, send] of emails) {
    try {
      await send();
    } catch (error) {
      console.error(
        `[transfer] No se pudo enviar ${name} para ${contract.reference}:`,
        error instanceof Error ? error.name : "error desconocido",
      );
      await recordAudit(
        {
          action: "transfer.notification_failed",
          actor: "system",
          entityType: "Contract",
          entityId: contract.id,
          metadata: { reference: contract.reference, email: name },
        },
        db,
      ).catch(() => undefined);
    }
  }
}

// ─── Regeneración del enlace ────────────────────────────────────────────────

export type RegenerateTransferLinkInput = { reference: string; pin: string };

export type RegenerateTransferLinkResult = {
  reference: string;
  expiresAt: Date;
  /** `false` si el enlace se generó pero el correo a Ferro falló (se puede volver a intentar). */
  emailed: boolean;
};

/**
 * Genera un enlace nuevo para un contrato por transferencia que sigue en `pending_payment`
 * (RF-20, SDD §7.6). Exige el PIN de Ferro. Invalida los enlaces anteriores y envía el nuevo
 * solo al correo de Ferro: el token nunca aparece en la respuesta.
 *
 * Con un PIN incorrecto la respuesta es la misma exista o no la referencia.
 */
export async function regenerateTransferLink(
  input: RegenerateTransferLinkInput,
  context: RequestContext = {},
  db = getPrisma(),
  now: Date = new Date(),
  pinHash: string | undefined = getConfig().FERRO_APPROVAL_PIN_HASH,
): Promise<RegenerateTransferLinkResult> {
  const hash = pinHashOrThrow(pinHash);
  const contract = await db.contract.findUnique({
    where: { reference: input.reference },
    include: { customer: true, program: true },
  });

  if (!(await verifyApprovalPin(input.pin, hash))) {
    await recordAudit(
      {
        action: "transfer.pin_failed",
        actor: "system",
        entityType: "Contract",
        entityId: contract?.id ?? "unknown",
        ip: context.ip,
        userAgent: context.userAgent,
        metadata: { reference: input.reference, operation: "regenerate" },
      },
      db,
    );
    throw new InvalidApprovalPinError(null);
  }

  if (!contract || contract.paymentType !== "transfer") {
    throw new NotFoundError("Contrato por transferencia", input.reference);
  }
  if (contract.status !== "pending_payment") {
    throw new ContractNotPendingError(contract.reference, contract.status);
  }

  const approval = await db.$transaction(async (tx) => {
    // Serializa con una confirmación simultánea: el contrato debe seguir pendiente al regenerar.
    const locked = await tx.$queryRaw<Array<{ status: ContractStatus }>>`
      SELECT "status" FROM "contracts" WHERE "id" = ${contract.id}::uuid FOR UPDATE`;
    if (locked[0]?.status !== "pending_payment") {
      throw new ContractNotPendingError(contract.reference, locked[0]?.status ?? "unknown");
    }
    const created = await createTransferApproval(contract.id, tx, now);
    await recordAudit(
      {
        action: "transfer.link_regenerated",
        actor: "ferro",
        entityType: "Contract",
        entityId: contract.id,
        ip: context.ip,
        userAgent: context.userAgent,
        metadata: { reference: contract.reference, expiresAt: created.expiresAt.toISOString() },
      },
      tx,
    );
    return created;
  });

  let emailed = true;
  try {
    await sendTransferPendingNotification(contract.customer, contract, contract.program, approval);
  } catch (error) {
    emailed = false;
    console.error(
      `[transfer] No se pudo enviar el enlace regenerado de ${contract.reference}:`,
      error instanceof Error ? error.name : "error desconocido",
    );
    await recordAudit(
      {
        action: "transfer.notification_failed",
        actor: "system",
        entityType: "Contract",
        entityId: contract.id,
        metadata: { reference: contract.reference, email: "transfer_pending_regenerated" },
      },
      db,
    ).catch(() => undefined);
  }
  return { reference: contract.reference, expiresAt: approval.expiresAt, emailed };
}
