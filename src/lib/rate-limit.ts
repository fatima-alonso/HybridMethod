import { deriveKey, hmacSha256 } from "@/lib/crypto";
import { getPrisma, type Db } from "@/lib/prisma";

/**
 * Rate limit de ventana fija guardado en PostgreSQL (SDD §9.4, DECISIONS A16).
 *
 * En Vercel cada instancia tiene su propia memoria, así que un contador en memoria no limitaría
 * nada. El contador vive en `rate_limit_buckets` y se actualiza con un solo
 * `INSERT … ON CONFLICT DO UPDATE` (atómico ante solicitudes simultáneas).
 *
 * El identificador (IP o correo) nunca se guarda en claro: la clave es un HMAC con una clave del
 * servidor.
 */

export type RateLimitRule = {
  /** Alcance del límite, p. ej. `otp-request:ip`. */
  scope: string;
  limit: number;
  windowMs: number;
};

export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export function rateLimitKey(scope: string, identifier: string): string {
  const digest = hmacSha256(deriveKey("rate-limit"), identifier).toString("hex");
  return `${scope}:${digest}`;
}

/**
 * Cuenta un intento. Si la ventana anterior ya terminó, empieza una nueva con `count = 1`.
 * Devuelve si el intento está dentro del límite y, si no, cuántos segundos faltan.
 */
export async function consumeRateLimit(
  rule: RateLimitRule,
  identifier: string,
  db: Db = getPrisma(),
  now: Date = new Date(),
): Promise<RateLimitResult> {
  const key = rateLimitKey(rule.scope, identifier);
  const windowStartedBefore = new Date(now.getTime() - rule.windowMs);
  const rows = await db.$queryRaw<Array<{ count: number; windowStart: Date }>>`
    INSERT INTO "rate_limit_buckets" ("key", "count", "windowStart")
    VALUES (${key}, 1, ${now})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "rate_limit_buckets"."windowStart" <= ${windowStartedBefore}
                     THEN 1 ELSE "rate_limit_buckets"."count" + 1 END,
      "windowStart" = CASE WHEN "rate_limit_buckets"."windowStart" <= ${windowStartedBefore}
                     THEN ${now} ELSE "rate_limit_buckets"."windowStart" END
    RETURNING "count", "windowStart"`;
  const row = rows[0];
  if (!row) throw new Error("El rate limit no devolvió el contador.");
  if (row.count <= rule.limit) return { allowed: true };
  const resetAt = row.windowStart.getTime() + rule.windowMs;
  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now.getTime()) / 1000)),
  };
}

/** Borra los contadores cuya ventana más larga ya terminó (para el cron diario, Fase 8). */
export async function purgeRateLimitBuckets(
  olderThanMs: number = 24 * 60 * 60 * 1000,
  db: Db = getPrisma(),
  now: Date = new Date(),
): Promise<number> {
  const { count } = await db.rateLimitBucket.deleteMany({
    where: { windowStart: { lt: new Date(now.getTime() - olderThanMs) } },
  });
  return count;
}

/** Límites de la Fase 3 (DECISIONS A16). */
export const RATE_LIMITS = {
  /** Pedir código: por IP. */
  otpRequestIp: { scope: "otp-request:ip", limit: 20, windowMs: 60 * 60 * 1000 },
  /** Reenvío: un código por correo cada 60 s (SDD §7.1). */
  otpRequestEmailCooldown: { scope: "otp-request:email-60s", limit: 1, windowMs: 60 * 1000 },
  /** Códigos por correo por hora. */
  otpRequestEmailHourly: { scope: "otp-request:email-1h", limit: 5, windowMs: 60 * 60 * 1000 },
  /** Confirmar código: por IP y por correo (además de los 5 intentos por código). */
  otpConfirmIp: { scope: "otp-confirm:ip", limit: 30, windowMs: 15 * 60 * 1000 },
  otpConfirmEmail: { scope: "otp-confirm:email", limit: 15, windowMs: 15 * 60 * 1000 },
  /** Crear transferencias: por IP. */
  transferCreateIp: { scope: "transfer-create:ip", limit: 10, windowMs: 60 * 60 * 1000 },
} as const satisfies Record<string, RateLimitRule>;
