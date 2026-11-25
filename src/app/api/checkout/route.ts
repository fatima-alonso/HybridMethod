import type { NextRequest } from "next/server";

import { CHECKOUT_MESSAGES, CONTRACT_RULE_MESSAGES } from "@/content/checkout";
import {
  getClientIp,
  getUserAgent,
  getVerificationSession,
  jsonError,
  jsonOk,
  parseJsonBody,
  rateLimited,
  unexpectedError,
} from "@/lib/http";
import { consumeRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { checkoutRequestSchema } from "@/lib/validations";
import { requestCheckout } from "@/services/checkout.service";
import {
  CheckoutInProgressError,
  PaymentsUnavailableError,
  PendingContractExistsError,
  PendingNotCardError,
  PrepaidLimitError,
  ProgramUnavailableError,
  SubscriptionActiveError,
} from "@/services/errors";

/**
 * `POST /api/checkout` (RF-07, SDD §7.4, DECISIONS A26). Exige la sesión de verificación (RN-12):
 * el correo sale de la cookie firmada. El Price y el importe salen de la BD y se comprueban contra
 * Stripe (SDD §9.2): el navegador solo elige el programa y la modalidad.
 *
 * Responde 201 al crear el contrato y 200 al reutilizar, retomar o cambiar el pendiente, con el
 * `client_secret` de la sesión de Embedded Checkout y la clave publicable (DECISIONS A27). Esta ruta nunca confirma un pago: eso lo hace solo el webhook.
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
    const ipLimit = await consumeRateLimit(RATE_LIMITS.checkoutCreateIp, ip);
    if (!ipLimit.allowed) return rateLimited(ipLimit.retryAfterSeconds);

    const body = await parseJsonBody(request, checkoutRequestSchema);
    if (!body.ok) return body.response;

    const { contract, program, outcome, clientSecret, publishableKey } = await requestCheckout(
      {
        verifiedEmail: session.email,
        fullName: body.data.fullName,
        whatsapp: body.data.whatsapp,
        programSlug: body.data.program,
        pendingAction: body.data.pendingAction,
      },
      { ip, userAgent: getUserAgent(request) },
    );

    return jsonOk(
      {
        clientSecret,
        publishableKey,
        reference: contract.reference,
        status: contract.status,
        outcome,
        program: { slug: program.slug, name: program.name },
        amount: contract.amount.toFixed(2),
        currency: contract.currency,
      },
      outcome === "created" ? 201 : 200,
    );
  } catch (error) {
    if (error instanceof PaymentsUnavailableError) {
      return jsonError(503, "payments_unavailable", CHECKOUT_MESSAGES.unavailable);
    }
    if (error instanceof CheckoutInProgressError) {
      return jsonError(409, "payment_in_progress", CHECKOUT_MESSAGES.inProgress);
    }
    if (error instanceof ProgramUnavailableError) {
      return jsonError(422, "program_unavailable", "Ese programa no está disponible por ahora.");
    }
    if (error instanceof PendingContractExistsError) {
      return jsonError(409, "pending_contract_exists", CONTRACT_RULE_MESSAGES.pendingExists, {
        pending: error.pending,
      });
    }
    if (error instanceof SubscriptionActiveError) {
      return jsonError(409, "subscription_active", CONTRACT_RULE_MESSAGES.subscriptionActive);
    }
    if (error instanceof PrepaidLimitError) {
      return jsonError(409, "prepaid_limit", CONTRACT_RULE_MESSAGES.prepaidLimit);
    }
    if (error instanceof PendingNotCardError) {
      return jsonError(409, "pending_contract_exists", CONTRACT_RULE_MESSAGES.pendingNotCard);
    }
    return unexpectedError("checkout.create", error);
  }
}
