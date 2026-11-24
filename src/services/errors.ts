/**
 * Errores de negocio de `services/`. Los Route Handlers los traducen a respuestas HTTP
 * (SDD §10) sin exponer detalles internos.
 */
export class ServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFoundError extends ServiceError {
  constructor(entity: string, id: string) {
    super(`${entity} no encontrado: ${id}`, "not_found");
  }
}

export class InvalidContractTransitionError extends ServiceError {
  constructor(
    public readonly from: string,
    public readonly to: string,
  ) {
    super(`Transición de contrato no permitida: ${from} → ${to}`, "invalid_transition");
  }
}

export class ProgramUnavailableError extends ServiceError {
  constructor(slug: string) {
    super(`El programa no existe o no está activo: ${slug}`, "program_unavailable");
  }
}

export class InvalidServicePeriodError extends ServiceError {
  constructor(message: string) {
    super(message, "invalid_service_period");
  }
}

// ─── Confirmación de transferencias (Fase 4) ────────────────────────────────

/** Por qué un enlace de aprobación no se puede usar (SDD §10). */
export type TransferLinkProblem = "not_found" | "expired" | "used" | "invalidated";

export class TransferLinkUnavailableError extends ServiceError {
  constructor(
    public readonly reason: TransferLinkProblem,
    /** Referencia del contrato, si el token existe (para ofrecer regenerar el enlace). */
    public readonly reference: string | null = null,
  ) {
    super(`El enlace de aprobación no se puede usar (${reason}).`, "transfer_link_unavailable");
  }
}

export class InvalidApprovalPinError extends ServiceError {
  constructor(
    /** Intentos que le quedan al enlace; `null` si la operación no va ligada a un enlace. */
    public readonly remainingAttempts: number | null,
  ) {
    super("PIN de aprobación incorrecto.", "invalid_pin");
  }
}

export class ContractNotPendingError extends ServiceError {
  constructor(
    public readonly reference: string,
    public readonly status: string,
  ) {
    super(
      `El contrato ${reference} ya no está pendiente de pago (${status}).`,
      "contract_not_pending",
    );
  }
}
