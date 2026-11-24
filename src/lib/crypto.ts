import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

import { getConfig } from "@/lib/config";

/**
 * Criptografía del servidor (SDD §9.3, §9.4). Solo para código de servidor.
 *
 * - Códigos OTP y tokens: aleatorios criptográficamente seguros (`node:crypto`).
 * - Solo se guarda su hash. Los OTP tienen solo un millón de valores posibles, así que su hash es
 *   un HMAC con una clave del servidor (si se filtrara la BD, no se podrían probar todos offline);
 *   los tokens de 32 bytes usan SHA-256, como pide el SDD §5.3.
 * - Las comparaciones son en tiempo constante.
 */

/** Código OTP de 6 dígitos (000000–999999). */
export function generateOtpCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

/** Token aleatorio para enlaces privados: 32 bytes en base64url (43 caracteres). */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Compara dos cadenas en tiempo constante (respecto a su contenido). */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

// ─── Secreto del servidor ───────────────────────────────────────────────────

let devSecret: string | undefined;

/**
 * Secreto del servidor: `OTP_SESSION_SECRET`. En producción es obligatorio (DECISIONS A9). En
 * desarrollo y pruebas, si falta, se usa uno aleatorio por proceso: las sesiones y los códigos
 * pendientes dejan de valer al reiniciar el servidor, lo cual es aceptable sin claves reales.
 */
export function getServerSecret(): string {
  const config = getConfig();
  if (config.OTP_SESSION_SECRET) return config.OTP_SESSION_SECRET;
  if (config.isProduction) throw new Error("OTP_SESSION_SECRET es obligatoria en producción.");
  devSecret ??= randomBytes(32).toString("base64url");
  return devSecret;
}

export type KeyPurpose = "verification-session" | "otp-code" | "rate-limit";

/** Clave derivada para un uso concreto, para no reutilizar el mismo secreto en todo. */
export function deriveKey(purpose: KeyPurpose, secret: string = getServerSecret()): Buffer {
  return createHmac("sha256", secret).update(`hybrid-method:${purpose}`).digest();
}

export function hmacSha256(key: Buffer, value: string): Buffer {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

/** Hash de un código OTP, ligado al correo para el que se emitió. */
export function hashOtpCode(email: string, code: string): string {
  return hmacSha256(deriveKey("otp-code"), `${email}\n${code}`).toString("hex");
}

/** Hash de un token de enlace privado (SHA-256, SDD §9.3). */
export function hashToken(token: string): string {
  return sha256Hex(token);
}
