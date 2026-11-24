import { generateOtpCode, hashOtpCode, safeEqual } from "@/lib/crypto";
import { getPrisma, type Db } from "@/lib/prisma";
import { consumeRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { normalizeEmail } from "@/lib/validations";

import { findCustomerIdByEmail } from "./customer.service";
import { sendVerificationCodeEmail } from "./email.service";

/**
 * Verificación de correo con OTP (RF-15, SDD §7.1, §9.4, DECISIONS A4).
 *
 * - Siempre se envía un código, exista o no el correo; la respuesta pública es la misma.
 * - Código de 6 dígitos; solo se guarda su HMAC; vence en 10 minutos; 5 intentos; un solo uso.
 * - Solo vale el código más reciente de cada correo: pedir uno nuevo deja sin efecto el anterior.
 * - Un código por correo cada 60 s y 5 por hora (además del límite por IP en la ruta).
 */

export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;

export type RequestCodeResult =
  { status: "sent" } | { status: "rate_limited"; retryAfterSeconds: number };

/**
 * Genera y envía un código. Lanza `EmailDeliveryError` si el correo no se pudo enviar (el
 * código guardado queda sin efecto en cuanto se pida otro).
 */
export async function requestVerificationCode(
  rawEmail: string,
  db: Db = getPrisma(),
  now: Date = new Date(),
): Promise<RequestCodeResult> {
  const email = normalizeEmail(rawEmail);

  const cooldown = await consumeRateLimit(RATE_LIMITS.otpRequestEmailCooldown, email, db, now);
  if (!cooldown.allowed) {
    return { status: "rate_limited", retryAfterSeconds: cooldown.retryAfterSeconds };
  }
  const hourly = await consumeRateLimit(RATE_LIMITS.otpRequestEmailHourly, email, db, now);
  if (!hourly.allowed) {
    return { status: "rate_limited", retryAfterSeconds: hourly.retryAfterSeconds };
  }

  const code = generateOtpCode();
  // Uso interno: asocia el código al cliente si ya existe. Nunca se refleja en la respuesta.
  const customerId = await findCustomerIdByEmail(email, db);
  await db.oTPVerification.create({
    data: {
      email,
      customerId,
      codeHash: hashOtpCode(email, code),
      expiresAt: new Date(now.getTime() + OTP_TTL_MS),
      createdAt: now,
    },
  });

  await sendVerificationCodeEmail({
    to: email,
    code,
    expiresInMinutes: Math.round(OTP_TTL_MS / 60_000),
  });
  return { status: "sent" };
}

export type ConfirmCodeResult =
  | { status: "verified"; email: string }
  | { status: "invalid"; remainingAttempts: number }
  /** No hay código vigente: venció, ya se usó o nunca se pidió. */
  | { status: "expired" }
  | { status: "too_many_attempts" };

/**
 * Valida un código. Cada intento cuenta (también el correcto) y se registra antes de comparar,
 * con un compare-and-set, para que intentos simultáneos no superen el máximo.
 */
export async function confirmVerificationCode(
  rawEmail: string,
  code: string,
  db: Db = getPrisma(),
  now: Date = new Date(),
): Promise<ConfirmCodeResult> {
  const email = normalizeEmail(rawEmail);
  const otp = await db.oTPVerification.findFirst({
    where: { email },
    orderBy: { createdAt: "desc" },
  });
  if (!otp || otp.verifiedAt || otp.expiresAt.getTime() <= now.getTime()) {
    return { status: "expired" };
  }
  if (otp.attempts >= OTP_MAX_ATTEMPTS) return { status: "too_many_attempts" };

  const counted = await db.oTPVerification.updateMany({
    where: { id: otp.id, verifiedAt: null, attempts: { lt: OTP_MAX_ATTEMPTS } },
    data: { attempts: { increment: 1 } },
  });
  if (counted.count === 0) return { status: "too_many_attempts" };
  const attempts = otp.attempts + 1;

  if (!safeEqual(otp.codeHash, hashOtpCode(email, code))) {
    const remainingAttempts = OTP_MAX_ATTEMPTS - attempts;
    return remainingAttempts > 0
      ? { status: "invalid", remainingAttempts }
      : { status: "too_many_attempts" };
  }

  // Un solo uso: solo una solicitud puede marcarlo como verificado.
  const used = await db.oTPVerification.updateMany({
    where: { id: otp.id, verifiedAt: null },
    data: { verifiedAt: now },
  });
  if (used.count === 0) return { status: "expired" };
  return { status: "verified", email };
}
