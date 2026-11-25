import bcrypt from "bcryptjs";

import { getConfig } from "@/lib/config";
import { PIN_MAX_LENGTH, PIN_MIN_LENGTH, PIN_PATTERN } from "@/lib/validations";

/**
 * PIN de aprobación de Ferro (DECISIONS A7, SDD §9.3). Solo para código de servidor.
 *
 * - El PIN nunca se guarda: solo su hash bcrypt en `FERRO_APPROVAL_PIN_HASH`, generado con
 *   `npm run hash-pin`.
 * - La comparación la hace `bcrypt.compare`, en tiempo constante respecto al PIN.
 */

/** Costo de bcrypt para `npm run hash-pin` (≈ 0.2–0.3 s por verificación). */
export const PIN_BCRYPT_COST = 12;

export class ApprovalPinNotConfiguredError extends Error {
  constructor() {
    super("FERRO_APPROVAL_PIN_HASH no está configurada. Genera el hash con `npm run hash-pin`.");
    this.name = "ApprovalPinNotConfiguredError";
  }
}

/**
 * Motivo por el que un PIN no se acepta al generarlo. Además del formato, rechaza los PIN más
 * fáciles de adivinar (un solo dígito repetido o una secuencia como 123456).
 */
export function weakPinReason(pin: string): string | null {
  if (!PIN_PATTERN.test(pin)) {
    return `El PIN debe tener de ${PIN_MIN_LENGTH} a ${PIN_MAX_LENGTH} dígitos, solo números.`;
  }
  if (/^(\d)\1+$/.test(pin)) return "El PIN no puede ser un mismo dígito repetido.";
  const digits = [...pin].map(Number);
  const steps = new Set(digits.slice(1).map((d, i) => (d - digits[i]! + 10) % 10));
  if (steps.size === 1 && (steps.has(1) || steps.has(9))) {
    return "El PIN no puede ser una secuencia (p. ej. 123456 o 654321).";
  }
  return null;
}

export function hashApprovalPin(pin: string, cost: number = PIN_BCRYPT_COST): Promise<string> {
  return bcrypt.hash(pin, cost);
}

/**
 * Verifica el PIN contra `FERRO_APPROVAL_PIN_HASH`. Sin el hash configurado (solo puede pasar en
 * desarrollo: en producción es obligatorio) lanza `ApprovalPinNotConfiguredError`: no existe un
 * PIN por defecto.
 */
export async function verifyApprovalPin(
  pin: string,
  hash: string | undefined = getConfig().FERRO_APPROVAL_PIN_HASH,
): Promise<boolean> {
  if (!hash) throw new ApprovalPinNotConfiguredError();
  if (!PIN_PATTERN.test(pin)) return false;
  return bcrypt.compare(pin, hash);
}
