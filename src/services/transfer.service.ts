import type { Contract, Customer, Program } from "@/generated/prisma/client";
import { getConfig } from "@/lib/config";
import { generateToken, hashToken } from "@/lib/crypto";
import { getPrisma, type Db } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import type { CustomerDataInput } from "@/lib/validations";
import { formatBusinessDateTime, formatPrice } from "@/utils/format";

import { recordAudit } from "./audit.service";
import {
  resolveContractRequest,
  type ContractRequestOutcome,
  type PendingAction,
} from "./contract-request.service";
import { expireCheckoutSessionQuietly } from "./checkout.service";
import { detachCheckoutSession } from "./contract.service";
import { upsertVerifiedCustomer } from "./customer.service";
import { sendTransferPendingEmail } from "./email.service";
import { PendingNotTransferError } from "./errors";

/**
 * Transferencias bancarias (RF-09, SDD §7.6, §8.4).
 *
 * Crear la contratación por transferencia (cliente + contrato `pending_payment` + referencia +
 * enlace privado para Ferro) y avisarle por correo. La revisión del enlace, la confirmación con
 * PIN y la regeneración del enlace están en `transfer-approval.service.ts` (Fase 4).
 */

export const TRANSFER_APPROVAL_MAX_PIN_ATTEMPTS = 5;

/** Ruta del enlace privado de confirmación (SDD §7.6). */
export function transferConfirmUrl(token: string, appUrl: string = getConfig().APP_URL): string {
  return `${appUrl}/transfer/confirm/${token}`;
}

/**
 * Crea un enlace de aprobación para el contrato: 32 bytes aleatorios, solo se guarda el SHA-256,
 * vence en `TRANSFER_LINK_TTL_DAYS` (7 por defecto) y deja sin efecto los enlaces anteriores
 * (SDD §5.3, §9.3). Devuelve el token en claro, que solo viaja en el correo de Ferro.
 */
export async function createTransferApproval(
  contractId: string,
  db: Db = getPrisma(),
  now: Date = new Date(),
  ttlDays: number = getConfig().TRANSFER_LINK_TTL_DAYS,
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateToken();
  const expiresAt = new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000);
  await db.transferApproval.updateMany({
    where: { contractId, usedAt: null, invalidatedAt: null },
    data: { invalidatedAt: now },
  });
  await db.transferApproval.create({
    data: { contractId, tokenHash: hashToken(token), expiresAt, createdAt: now },
  });
  return { token, expiresAt };
}

export type TransferRequestInput = {
  /** Correo verificado, tomado de la sesión de verificación (nunca del body). */
  verifiedEmail: string;
  fullName: string;
  /** WhatsApp ya en E.164. */
  whatsapp: string;
  programSlug: string;
  /** Respuesta a "¿continuar con tu registro pendiente o cambiarlo?" (DECISIONS A20). */
  pendingAction?: PendingAction;
};

export type RequestContext = { ip?: string | null; userAgent?: string | null };

export type TransferRequestResult = {
  contract: Contract;
  program: Program;
  customer: Customer;
  outcome: ContractRequestOutcome;
  /** `true` si se creó un contrato nuevo. */
  created: boolean;
};

/** ¿El contrato tiene un enlace de aprobación que todavía sirve? */
async function hasUsableApproval(contractId: string, db: Db, now: Date): Promise<boolean> {
  const approval = await db.transferApproval.findFirst({
    where: {
      contractId,
      usedAt: null,
      invalidatedAt: null,
      expiresAt: { gt: now },
      pinAttempts: { lt: TRANSFER_APPROVAL_MAX_PIN_ATTEMPTS },
    },
    select: { id: true },
  });
  return approval !== null;
}

/**
 * Contratación por transferencia (RF-09, SDD §7.6), con las reglas de SDD §7.3 (DECISIONS A20):
 * 1. En una transacción con el candado del cliente: crea o actualiza el cliente (A4) y resuelve
 *    la contratación (`resolveContractRequest`): contrato nuevo, pendiente reutilizado, retomado o
 *    cambiado. Si hace falta, crea el enlace de aprobación y escribe la auditoría.
 * 2. Después, si se generó un enlace, envía Transfer Pending a Ferro. Si el correo falla, la
 *    contratación se conserva, se registra el fallo y Ferro puede regenerar el enlace.
 *
 * Un pendiente reutilizado que todavía tiene un enlace vigente no genera otro ni reenvía el correo
 * (así un doble envío no duplica nada, A16). Lanza `PendingContractExistsError`,
 * `SubscriptionActiveError` o `ActivePeriodError` según las reglas.
 *
 * Quien llama debe haber validado la sesión de verificación (RN-12).
 */
export async function requestTransfer(
  input: TransferRequestInput,
  context: RequestContext = {},
  db = getPrisma(),
  now: Date = new Date(),
): Promise<TransferRequestResult> {
  const customerData: CustomerDataInput = {
    fullName: input.fullName,
    email: input.verifiedEmail,
    whatsapp: input.whatsapp,
  };

  const result = await db.$transaction(async (tx) => {
    const customer = await upsertVerifiedCustomer(customerData, tx);
    // Serializa las solicitudes del mismo cliente (un solo pendiente, sin duplicados).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${customer.id}, 0))`;

    const resolved = await resolveContractRequest(
      {
        customerId: customer.id,
        programSlug: input.programSlug,
        paymentType: "transfer",
        pendingAction: input.pendingAction,
      },
      tx,
      now,
      context,
    );
    const { contract, program, outcome } = resolved;
    if (contract.paymentType !== "transfer") {
      // Retomó un pendiente de pago con tarjeta: no se puede pagar por transferencia (Fase 5).
      throw new PendingNotTransferError(contract.reference);
    }

    // Si el pendiente era de pago con tarjeta, su sesión de Checkout ya no corresponde (A20).
    let staleSessionId: string | null = null;
    if (outcome === "changed" && contract.stripeCheckoutSessionId) {
      staleSessionId = contract.stripeCheckoutSessionId;
      await detachCheckoutSession(contract.id, staleSessionId, tx);
    }

    let approval: { token: string; expiresAt: Date } | null = null;
    if (
      outcome === "created" ||
      outcome === "changed" ||
      !(await hasUsableApproval(contract.id, tx, now))
    ) {
      approval = await createTransferApproval(contract.id, tx, now);
    }
    if (outcome === "created") {
      await recordAudit(
        {
          action: "transfer.requested",
          actor: `customer:${customer.id}`,
          entityType: "Contract",
          entityId: contract.id,
          ip: context.ip,
          userAgent: context.userAgent,
          metadata: { reference: contract.reference, program: program.slug },
        },
        tx,
      );
    } else if (approval) {
      await recordAudit(
        {
          action: "transfer.link_regenerated",
          actor: `customer:${customer.id}`,
          entityType: "Contract",
          entityId: contract.id,
          ip: context.ip,
          userAgent: context.userAgent,
          metadata: { reference: contract.reference, reason: outcome },
        },
        tx,
      );
    }
    return { customer, contract, program, outcome, approval, staleSessionId };
  });

  const { customer, contract, program, outcome, approval, staleSessionId } = result;
  const stripe = staleSessionId ? getStripe() : null;
  if (stripe && staleSessionId) {
    await expireCheckoutSessionQuietly(stripe, staleSessionId, contract.reference);
  }
  if (approval) {
    await notifyFerro(customer, contract, program, approval, db);
  }
  return { customer, contract, program, outcome, created: outcome === "created" };
}

/** Importe del contrato formateado, sin pasar por `float`. */
export function formatContractAmount(contract: Pick<Contract, "amount" | "currency">): string {
  return formatPrice(contract.amount.toFixed(2) as `${number}`, contract.currency);
}

/**
 * Envía Transfer Pending a Ferro con el enlace privado. Lanza si el correo falla: quien llama
 * decide si eso se registra (al crear la transferencia) o se informa (al regenerar el enlace).
 */
export async function sendTransferPendingNotification(
  customer: Customer,
  contract: Contract,
  program: Program,
  approval: { token: string; expiresAt: Date },
): Promise<void> {
  await sendTransferPendingEmail({
    reference: contract.reference,
    customerName: customer.fullName,
    customerEmail: customer.email,
    customerWhatsapp: customer.whatsapp,
    programName: program.name,
    amount: formatContractAmount(contract),
    confirmUrl: transferConfirmUrl(approval.token),
    expiresAt: `${formatBusinessDateTime(approval.expiresAt)} (hora del centro de México)`,
  });
}

async function notifyFerro(
  customer: Customer,
  contract: Contract,
  program: Program,
  approval: { token: string; expiresAt: Date },
  db: Db,
): Promise<void> {
  try {
    await sendTransferPendingNotification(customer, contract, program, approval);
  } catch (error) {
    console.error(
      `[transfer] No se pudo enviar Transfer Pending para ${contract.reference}:`,
      error instanceof Error ? error.name : "error desconocido",
    );
    await recordAudit(
      {
        action: "transfer.notification_failed",
        actor: "system",
        entityType: "Contract",
        entityId: contract.id,
        metadata: { reference: contract.reference, email: "transfer_pending" },
      },
      db,
    ).catch(() => undefined);
  }
}
