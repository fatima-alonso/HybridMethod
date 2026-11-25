import type { NextRequest } from "next/server";

import { API_MESSAGES } from "@/content/transfer-approval";
import {
  getClientIp,
  getUserAgent,
  jsonError,
  jsonOk,
  parseJsonBody,
  rateLimited,
} from "@/lib/http";
import { consumeRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { transferRegenerateSchema } from "@/lib/validations";
import { regenerateTransferLink } from "@/services/transfer-approval.service";

import { transferApprovalErrorResponse } from "../_lib/approval-errors";

/**
 * `POST /api/transfers/regenerate` con `{ reference, pin }` (RF-20, SDD §7.6). Genera un enlace
 * nuevo para un contrato que sigue pendiente y lo envía solo al correo de Ferro: el token nunca
 * viaja en la respuesta.
 *
 * Aquí no hay un enlace que cuente los PIN incorrectos, así que el límite es por IP y además
 * global (DECISIONS A23).
 */
export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request);
    const ipLimit = await consumeRateLimit(RATE_LIMITS.transferRegenerateIp, ip);
    if (!ipLimit.allowed) return rateLimited(ipLimit.retryAfterSeconds);
    const globalLimit = await consumeRateLimit(RATE_LIMITS.transferRegenerateGlobal, "global");
    if (!globalLimit.allowed) return rateLimited(globalLimit.retryAfterSeconds);

    const body = await parseJsonBody(request, transferRegenerateSchema);
    if (!body.ok) return body.response;

    const result = await regenerateTransferLink(body.data, {
      ip,
      userAgent: getUserAgent(request),
    });
    if (!result.emailed) {
      return jsonError(502, "email_failed", API_MESSAGES.regeneratedEmailFailed);
    }
    return jsonOk({ reference: result.reference, message: API_MESSAGES.regenerated });
  } catch (error) {
    return transferApprovalErrorResponse(error, "transfers.regenerate");
  }
}
