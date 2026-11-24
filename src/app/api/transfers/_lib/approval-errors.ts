import { API_MESSAGES, LINK_PROBLEM_MESSAGES } from "@/content/transfer-approval";
import { ApprovalPinNotConfiguredError } from "@/lib/approval-pin";
import { jsonError, unexpectedError } from "@/lib/http";
import {
  ContractNotPendingError,
  InvalidApprovalPinError,
  NotFoundError,
  TransferLinkUnavailableError,
} from "@/services/errors";

/** Traduce los errores de la confirmación y la regeneración a respuestas HTTP (SDD §10). */
export function transferApprovalErrorResponse(error: unknown, scope: string) {
  if (error instanceof InvalidApprovalPinError) {
    if (error.remainingAttempts === null) {
      return jsonError(403, "invalid_pin", API_MESSAGES.invalidPinNoLink);
    }
    if (error.remainingAttempts === 0) {
      return jsonError(410, "link_unavailable", API_MESSAGES.tooManyPinAttempts, {
        reason: "invalidated",
        remainingAttempts: 0,
      });
    }
    return jsonError(403, "invalid_pin", API_MESSAGES.invalidPin(error.remainingAttempts), {
      remainingAttempts: error.remainingAttempts,
    });
  }
  if (error instanceof TransferLinkUnavailableError) {
    return jsonError(
      error.reason === "not_found" ? 404 : 410,
      "link_unavailable",
      LINK_PROBLEM_MESSAGES[error.reason],
      { reason: error.reason, ...(error.reference ? { reference: error.reference } : {}) },
    );
  }
  if (error instanceof ContractNotPendingError) {
    return jsonError(409, "contract_not_pending", API_MESSAGES.contractNotPending);
  }
  if (error instanceof NotFoundError) {
    return jsonError(404, "not_found", API_MESSAGES.contractNotFound);
  }
  if (error instanceof ApprovalPinNotConfiguredError) {
    console.error(`[${scope}] ${error.message}`);
    return jsonError(503, "service_unavailable", API_MESSAGES.pinNotConfigured);
  }
  return unexpectedError(scope, error);
}
