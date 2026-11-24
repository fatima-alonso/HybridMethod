import type { Contract, Customer, Program } from "@/generated/prisma/client";
import { getConfig } from "@/lib/config";
import { generateToken, hashToken } from "@/lib/crypto";
import { getPrisma, type Db } from "@/lib/prisma";
import type { CustomerDataInput } from "@/lib/validations";
import { formatPrice } from "@/utils/format";
import { BUSINESS_TIME_ZONE } from "@/utils/reference";

import { recordAudit } from "./audit.service";
import { createContract } from "./contract.service";
import { upsertVerifiedCustomer } from "./customer.service";
import { sendTransferPendingEmail } from "./email.service";

/**
 * Transferencias bancarias (RF-09, SDD §7.6, §8.4).
 *
 * Fase 3: crear la contratación por transferencia (cliente + contrato `pending_payment` +
 * referencia + enlace privado para Ferro) y avisarle por correo. La pantalla del enlace, la
 * confirmación con PIN y la regeneración del enlace son de la Fase 4.
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
  /** Momento de la verificación: dentro de la misma sesión no se duplica la contratación. */
  verifiedAt: Date;
  fullName: string;
  /** WhatsApp ya en E.164. */
  whatsapp: string;
  programSlug: string;
};

export type RequestContext = { ip?: string | null; userAgent?: string | null };

export type TransferRequestResult = {
  contract: Contract;
  program: Program;
  customer: Customer;
  /** `false` si ya existía la misma contratación en esta sesión (doble envío). */
  created: boolean;
};

/**
 * Crea la contratación por transferencia (RF-09):
 * 1. En una transacción: crea o actualiza el cliente (DECISIONS A4), crea el contrato
 *    `pending_payment` con el importe del programa en la BD, el enlace de aprobación y la auditoría.
 * 2. Después, envía Transfer Pending a Ferro con el enlace. Si el correo falla, la contratación se
 *    conserva, se registra el fallo y Ferro puede regenerar el enlace (Fase 4).
 *
 * Si en la misma sesión de verificación ya se creó un contrato pendiente por transferencia para el
 * mismo cliente y programa (p. ej. un doble clic), se devuelve ese contrato sin crear otro ni
 * reenviar el correo (DECISIONS A16).
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

  const outcome = await db.$transaction(async (tx) => {
    const customer = await upsertVerifiedCustomer(customerData, tx);
    // Serializa las solicitudes del mismo cliente para que un doble envío no cree dos contratos.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${customer.id}, 0))`;

    const existing = await tx.contract.findFirst({
      where: {
        customerId: customer.id,
        paymentType: "transfer",
        status: "pending_payment",
        program: { slug: input.programSlug },
        createdAt: { gte: input.verifiedAt },
      },
      include: { program: true },
      orderBy: { createdAt: "desc" },
    });
    if (existing) {
      const { program, ...contract } = existing;
      return { customer, contract, program, approval: null };
    }

    const contract = await createContract(
      { customerId: customer.id, programSlug: input.programSlug, paymentType: "transfer" },
      tx,
      now,
    );
    const program = await tx.program.findUniqueOrThrow({ where: { id: contract.programId } });
    const approval = await createTransferApproval(contract.id, tx, now);
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
    return { customer, contract, program, approval };
  });

  const { customer, contract, program, approval } = outcome;
  if (approval) {
    await notifyFerro(customer, contract, program, approval, db);
  }
  return { customer, contract, program, created: approval !== null };
}

const expiryFormatter = new Intl.DateTimeFormat("es-MX", {
  timeZone: BUSINESS_TIME_ZONE,
  dateStyle: "long",
  timeStyle: "short",
});

async function notifyFerro(
  customer: Customer,
  contract: Contract,
  program: Program,
  approval: { token: string; expiresAt: Date },
  db: Db,
): Promise<void> {
  try {
    await sendTransferPendingEmail({
      reference: contract.reference,
      customerName: customer.fullName,
      customerEmail: customer.email,
      customerWhatsapp: customer.whatsapp,
      programName: program.name,
      amount: formatPrice(contract.amount.toFixed(2) as `${number}`, contract.currency),
      confirmUrl: transferConfirmUrl(approval.token),
      expiresAt: `${expiryFormatter.format(approval.expiresAt)} (hora del centro de México)`,
    });
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
