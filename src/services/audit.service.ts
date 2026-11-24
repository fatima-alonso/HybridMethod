import type { AuditLog, Prisma } from "@/generated/prisma/client";
import { getPrisma, type Db } from "@/lib/prisma";

/**
 * Auditoría de operaciones sensibles (SRS §10, SDD §5.3). Se escribe en la misma transacción que
 * el cambio que registra (SDD §5.4).
 *
 * Nunca se guardan códigos OTP, tokens ni PIN (SDD §9.6): las claves de `metadata` con esos
 * nombres se rechazan.
 */

export type AuditActor = "ferro" | "system" | "stripe" | `customer:${string}`;

export type AuditEntry = {
  action: string;
  actor: AuditActor;
  entityType: string;
  entityId: string;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Prisma.InputJsonObject;
};

const FORBIDDEN_METADATA_KEY = /(token|pin|otp|code|secret|password|hash)/i;

function findForbiddenKey(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findForbiddenKey(item);
      if (found) return found;
    }
  } else if (value !== null && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      if (FORBIDDEN_METADATA_KEY.test(key)) return key;
      const found = findForbiddenKey(nested);
      if (found) return found;
    }
  }
  return undefined;
}

/** Límite de longitud para el user-agent (viene del cliente y no se controla su tamaño). */
const MAX_USER_AGENT = 512;

export async function recordAudit(entry: AuditEntry, db: Db = getPrisma()): Promise<AuditLog> {
  const forbidden = findForbiddenKey(entry.metadata);
  if (forbidden) {
    throw new Error(`La auditoría no puede incluir datos sensibles (clave "${forbidden}").`);
  }
  return db.auditLog.create({
    data: {
      action: entry.action,
      actor: entry.actor,
      entityType: entry.entityType,
      entityId: entry.entityId,
      ip: entry.ip ?? null,
      userAgent: entry.userAgent?.slice(0, MAX_USER_AGENT) ?? null,
      metadata: entry.metadata,
    },
  });
}
