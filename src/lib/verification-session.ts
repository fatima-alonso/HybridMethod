import { deriveKey, hmacSha256, safeEqual } from "@/lib/crypto";
import { getConfig } from "@/lib/config";

/**
 * Sesión de verificación de correo (SDD §7.1, §9.4, DECISIONS A4).
 *
 * Después de confirmar el código OTP, el servidor emite una cookie firmada (HMAC-SHA256 con una
 * clave derivada de `OTP_SESSION_SECRET`) que contiene el correo verificado y dura 30 minutos.
 * Es `httpOnly`, `SameSite=Lax` y `Secure` en producción. Ningún endpoint que cree contratos
 * funciona sin ella (RN-12); el correo se toma de la sesión, nunca del body.
 *
 * Formato: `v1.<payload base64url>.<firma base64url>`.
 */

export const VERIFICATION_SESSION_TTL_MS = 30 * 60 * 1000;

/** En producción se usa el prefijo `__Host-` (exige `Secure`, `Path=/` y ningún `Domain`). */
export function verificationCookieName(isProduction = getConfig().isProduction): string {
  return isProduction ? "__Host-hm_verification" : "hm_verification";
}

export type VerificationSession = {
  email: string;
  /** Momento de la verificación (ms). Sirve para no duplicar contratos en la misma sesión. */
  issuedAt: number;
  expiresAt: number;
};

const VERSION = "v1";

function sign(payload: string, key: Buffer): string {
  return hmacSha256(key, `${VERSION}.${payload}`).toString("base64url");
}

export function createVerificationSessionToken(
  email: string,
  now: Date = new Date(),
  key: Buffer = deriveKey("verification-session"),
): { token: string; session: VerificationSession } {
  const session: VerificationSession = {
    email,
    issuedAt: now.getTime(),
    expiresAt: now.getTime() + VERIFICATION_SESSION_TTL_MS,
  };
  const payload = Buffer.from(
    JSON.stringify({ e: session.email, i: session.issuedAt, x: session.expiresAt }),
  ).toString("base64url");
  return { token: `${VERSION}.${payload}.${sign(payload, key)}`, session };
}

/** Devuelve la sesión si la firma es válida y no ha expirado; si no, `null`. */
export function readVerificationSessionToken(
  token: string | undefined,
  now: Date = new Date(),
  key: Buffer = deriveKey("verification-session"),
): VerificationSession | null {
  if (!token || token.length > 1024) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION) return null;
  const [, payload, signature] = parts as [string, string, string];
  if (!safeEqual(signature, sign(payload, key))) return null;

  let data: unknown;
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const { e, i, x } = data as Record<string, unknown>;
  if (typeof e !== "string" || typeof i !== "number" || typeof x !== "number") return null;
  if (x <= now.getTime()) return null;
  return { email: e, issuedAt: i, expiresAt: x };
}

export type CookieOptions = {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  maxAge: number;
};

export function verificationCookieOptions(isProduction = getConfig().isProduction): CookieOptions {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(VERIFICATION_SESSION_TTL_MS / 1000),
  };
}
