import type { NextRequest } from "next/server";

import { PORTAL_MESSAGES } from "@/content/subscription";
import {
  getClientIp,
  getUserAgent,
  getVerificationSession,
  jsonError,
  jsonOk,
  rateLimited,
  unexpectedError,
} from "@/lib/http";
import { consumeRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { PortalUnavailableError, SubscriptionNotFoundError } from "@/services/errors";
import { createPortalSession } from "@/services/portal.service";

/**
 * `POST /api/portal` (RF-19, SDD §7.7, DECISIONS A21, A33): URL de una sesión del Stripe Customer
 * Portal para el cliente de la sesión de verificación. No recibe body: el correo sale de la cookie
 * firmada, nunca del navegador (RF-15).
 *
 * Respuestas: 200 `{ url }`; 401 sin sesión; 404 `subscription_not_found` (igual exista o no el
 * correo); 429; 503 `portal_unavailable`.
 */
export async function POST(request: NextRequest) {
  try {
    const session = getVerificationSession(request);
    if (!session) {
      return jsonError(
        401,
        "verification_required",
        "Tu verificación de correo venció. Vuelve a verificar tu correo para continuar.",
      );
    }

    const ip = getClientIp(request);
    const ipLimit = await consumeRateLimit(RATE_LIMITS.portalIp, ip);
    if (!ipLimit.allowed) return rateLimited(ipLimit.retryAfterSeconds);

    const { url } = await createPortalSession(session.email, {
      ip,
      userAgent: getUserAgent(request),
    });
    return jsonOk({ url });
  } catch (error) {
    if (error instanceof SubscriptionNotFoundError) {
      return jsonError(404, "subscription_not_found", PORTAL_MESSAGES.notFound);
    }
    if (error instanceof PortalUnavailableError) {
      return jsonError(503, "portal_unavailable", PORTAL_MESSAGES.unavailable);
    }
    return unexpectedError("portal.create", error);
  }
}
