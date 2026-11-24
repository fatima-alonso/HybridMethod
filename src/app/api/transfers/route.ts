import type { NextRequest } from "next/server";

import { getWhatsAppNumber } from "@/lib/config";
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
import { transferRequestSchema } from "@/lib/validations";
import { ProgramUnavailableError } from "@/services/errors";
import { requestTransfer } from "@/services/transfer.service";
import { transferWhatsAppMessage } from "@/content/checkout";
import { buildWhatsAppLink } from "@/utils/whatsapp";

/**
 * `POST /api/transfers` (RF-09, RF-10, SDD §7.6). Exige la sesión de verificación (RN-12): el
 * correo se toma de la cookie firmada, nunca del body. El importe sale de la BD.
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
    const ipLimit = await consumeRateLimit(RATE_LIMITS.transferCreateIp, ip);
    if (!ipLimit.allowed) return rateLimited(ipLimit.retryAfterSeconds);

    const body = await parseJsonBody(request, transferRequestSchema);
    if (!body.ok) return body.response;

    const { contract, program } = await requestTransfer(
      {
        verifiedEmail: session.email,
        verifiedAt: new Date(session.issuedAt),
        fullName: body.data.fullName,
        whatsapp: body.data.whatsapp,
        programSlug: body.data.program,
      },
      { ip, userAgent: getUserAgent(request) },
    );

    const whatsappNumber = getWhatsAppNumber();
    return jsonOk(
      {
        reference: contract.reference,
        status: contract.status,
        program: { slug: program.slug, name: program.name },
        amount: contract.amount.toFixed(2),
        currency: contract.currency,
        whatsappUrl: whatsappNumber
          ? buildWhatsAppLink(
              whatsappNumber,
              transferWhatsAppMessage(program.name, contract.reference),
            )
          : null,
      },
      201,
    );
  } catch (error) {
    if (error instanceof ProgramUnavailableError) {
      return jsonError(422, "program_unavailable", "Ese programa no está disponible por ahora.");
    }
    return unexpectedError("transfers.create", error);
  }
}
