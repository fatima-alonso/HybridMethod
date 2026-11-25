import type { NextRequest } from "next/server";

import { DELIVERY_API_MESSAGES } from "@/content/plan-delivery";
import {
  getClientIp,
  getUserAgent,
  jsonError,
  jsonOk,
  parseJsonBody,
  rateLimited,
  unexpectedError,
} from "@/lib/http";
import { consumeRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { planDeliveryConfirmSchema } from "@/lib/validations";
import { confirmDelivery } from "@/services/delivery.service";
import { DeliveryLinkUnavailableError, InvalidDeliveryDateError } from "@/services/errors";

/**
 * `POST /api/plan-delivery/confirm` con `{ token, deliveredOn }` (SDD §7.8, DECISIONS A19).
 * Guarda la fecha de entrega del plan como dato de referencia. Sin PIN: no mueve dinero ni estados.
 */
export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request);
    const limit = await consumeRateLimit(RATE_LIMITS.planDeliveryIp, ip);
    if (!limit.allowed) return rateLimited(limit.retryAfterSeconds);

    const body = await parseJsonBody(request, planDeliveryConfirmSchema);
    if (!body.ok) return body.response;

    const result = await confirmDelivery(body.data, { ip, userAgent: getUserAgent(request) });
    return jsonOk({ ...result });
  } catch (error) {
    if (error instanceof DeliveryLinkUnavailableError) {
      return error.reason === "not_found"
        ? jsonError(404, "link_unavailable", DELIVERY_API_MESSAGES.linkNotFound, {
            reason: "not_found",
          })
        : jsonError(410, "link_unavailable", DELIVERY_API_MESSAGES.linkExpired, {
            reason: "expired",
          });
    }
    if (error instanceof InvalidDeliveryDateError) {
      return jsonError(
        422,
        "invalid_date",
        error.reason === "future"
          ? DELIVERY_API_MESSAGES.future
          : DELIVERY_API_MESSAGES.beforePayment,
      );
    }
    return unexpectedError("plan-delivery.confirm", error);
  }
}
