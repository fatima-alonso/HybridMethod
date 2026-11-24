import type { NextRequest } from "next/server";

import { getClientIp, getUserAgent, jsonOk, parseJsonBody, rateLimited } from "@/lib/http";
import { consumeRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { transferConfirmSchema } from "@/lib/validations";
import { confirmTransfer } from "@/services/transfer-approval.service";

import { transferApprovalErrorResponse } from "../_lib/approval-errors";

/**
 * `POST /api/transfers/confirm` con `{ token, pin }` (RF-11, RF-12, SDD §7.6). Es la única acción
 * sobre una transferencia: aprobar. No existe `reject` (DECISIONS A5).
 */
export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request);
    const limit = await consumeRateLimit(RATE_LIMITS.transferConfirmIp, ip);
    if (!limit.allowed) return rateLimited(limit.retryAfterSeconds);

    const body = await parseJsonBody(request, transferConfirmSchema);
    if (!body.ok) return body.response;

    const { contract } = await confirmTransfer(body.data, { ip, userAgent: getUserAgent(request) });
    return jsonOk({
      reference: contract.reference,
      status: contract.status,
      serviceStartDate: contract.serviceStartDate!.toISOString(),
      serviceEndDate: contract.serviceEndDate!.toISOString(),
    });
  } catch (error) {
    return transferApprovalErrorResponse(error, "transfers.confirm");
  }
}
