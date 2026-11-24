import type { NextRequest } from "next/server";

import { getConfig } from "@/lib/config";
import {
  getClientIp,
  jsonError,
  jsonOk,
  parseJsonBody,
  rateLimited,
  unexpectedError,
} from "@/lib/http";
import { consumeRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { verificationConfirmSchema } from "@/lib/validations";
import {
  createVerificationSessionToken,
  verificationCookieName,
  verificationCookieOptions,
} from "@/lib/verification-session";
import { confirmVerificationCode } from "@/services/verification.service";

/**
 * `POST /api/verification/confirm` (SDD §7.1, §9.4). Si el código es correcto, emite la sesión de
 * verificación (cookie firmada de 30 minutos) que autoriza crear el contrato.
 */
export async function POST(request: NextRequest) {
  try {
    const ipLimit = await consumeRateLimit(RATE_LIMITS.otpConfirmIp, getClientIp(request));
    if (!ipLimit.allowed) return rateLimited(ipLimit.retryAfterSeconds);

    const body = await parseJsonBody(request, verificationConfirmSchema);
    if (!body.ok) return body.response;
    const { email, code } = body.data;

    const emailLimit = await consumeRateLimit(RATE_LIMITS.otpConfirmEmail, email);
    if (!emailLimit.allowed) return rateLimited(emailLimit.retryAfterSeconds);

    const result = await confirmVerificationCode(email, code);
    switch (result.status) {
      case "invalid":
        return jsonError(
          400,
          "invalid_code",
          result.remainingAttempts === 1
            ? "El código no es correcto. Te queda 1 intento."
            : `El código no es correcto. Te quedan ${result.remainingAttempts} intentos.`,
          { remainingAttempts: result.remainingAttempts },
        );
      case "expired":
        return jsonError(
          400,
          "code_expired",
          "El código venció o ya no es válido. Pide uno nuevo.",
        );
      case "too_many_attempts":
        return jsonError(
          400,
          "too_many_attempts",
          "Demasiados intentos con este código. Pide uno nuevo.",
        );
      case "verified": {
        const { isProduction } = getConfig();
        const { token, session } = createVerificationSessionToken(result.email);
        const response = jsonOk({ expiresAt: new Date(session.expiresAt).toISOString() });
        response.cookies.set(
          verificationCookieName(isProduction),
          token,
          verificationCookieOptions(isProduction),
        );
        return response;
      }
    }
  } catch (error) {
    return unexpectedError("verification.confirm", error);
  }
}
