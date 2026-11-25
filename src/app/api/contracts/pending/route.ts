import { connection, type NextRequest } from "next/server";

import { getVerificationSession, jsonError, jsonOk, unexpectedError } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";
import { findPendingContractSummary } from "@/services/contract-request.service";

/**
 * `GET /api/contracts/pending` (SDD §7.3): el contrato pendiente del cliente de la sesión de
 * verificación, si existe. Nunca recibe un correo ni una referencia como parámetro (RF-15).
 */
export async function GET(request: NextRequest) {
  // Siempre en tiempo de ejecución: nunca se prerenderiza en `next build`.
  await connection();
  try {
    const session = getVerificationSession(request);
    if (!session) {
      return jsonError(
        401,
        "verification_required",
        "Tu verificación de correo venció. Vuelve a verificar tu correo para continuar.",
      );
    }
    const pending = await findPendingContractSummary(session.email, getPrisma());
    return jsonOk({ pending });
  } catch (error) {
    return unexpectedError("contracts.pending", error);
  }
}
