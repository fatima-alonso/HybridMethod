import type { NextRequest } from "next/server";

import {
  getClientIp,
  jsonError,
  jsonOk,
  parseJsonBody,
  rateLimited,
  unexpectedError,
} from "@/lib/http";
import { consumeRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { verificationRequestSchema } from "@/lib/validations";
import { VERIFICATION_REQUESTED_MESSAGE } from "@/content/checkout";
import { EmailDeliveryError } from "@/services/email.service";
import { requestVerificationCode } from "@/services/verification.service";

/**
 * `POST /api/verification/request` (SDD §7.1, DECISIONS A4).
 * La respuesta es la misma exista o no el correo (RF-15).
 */
export async function POST(request: NextRequest) {
  try {
    const ipLimit = await consumeRateLimit(RATE_LIMITS.otpRequestIp, getClientIp(request));
    if (!ipLimit.allowed) return rateLimited(ipLimit.retryAfterSeconds);

    const body = await parseJsonBody(request, verificationRequestSchema);
    if (!body.ok) return body.response;

    const result = await requestVerificationCode(body.data.email);
    if (result.status === "rate_limited") return rateLimited(result.retryAfterSeconds);

    return jsonOk({ message: VERIFICATION_REQUESTED_MESSAGE });
  } catch (error) {
    if (error instanceof EmailDeliveryError) {
      console.error("[verification] No se pudo enviar el código:", error.message);
      return jsonError(
        502,
        "email_failed",
        "No pudimos enviar el código. Espera un minuto y vuelve a intentarlo.",
      );
    }
    return unexpectedError("verification.request", error);
  }
}
