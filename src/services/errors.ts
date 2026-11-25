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

// ─── Reglas de contratación (DECISIONS A20) ─────────────────────────────────

/** Resumen de un contrato pendiente que se le muestra a su dueño (correo verificado, RF-15). */
export type PendingContractSummary = {
  reference: string;
  programSlug: string;
  programName: string;
  paymentType: string;
  /** Decimal en texto, p. ej. "1200.00". */
  amount: string;
  currency: string;
};

export class PendingContractExistsError extends ServiceError {
  constructor(public readonly pending: PendingContractSummary) {
    super(
      `El cliente ya tiene un contrato pendiente (${pending.reference}).`,
      "pending_contract_exists",
    );
  }
}

export class SubscriptionActiveError extends ServiceError {
  constructor() {
    super("El cliente tiene una suscripción activa.", "subscription_active");
  }
}

export class PrepaidLimitError extends ServiceError {
  constructor() {
    super("El cliente ya pagó su siguiente mes por adelantado.", "prepaid_limit");
  }
}

/** El cliente retomó un pendiente de pago con tarjeta desde el flujo de transferencia. */
export class PendingNotTransferError extends ServiceError {
  constructor(public readonly reference: string) {
    super(`El pendiente ${reference} no es por transferencia.`, "pending_not_transfer");
  }
}

/** El cliente retomó, desde el pago con tarjeta, un pendiente de otra modalidad. */
export class PendingNotCardError extends ServiceError {
  constructor(
    public readonly reference: string,
    public readonly paymentType: string,
  ) {
    super(`El pendiente ${reference} no es de pago único con tarjeta.`, "pending_not_card");
  }
}

// ─── Stripe (Fase 5) ────────────────────────────────────────────────────────

export type PaymentsUnavailableReason =
  /** Falta `STRIPE_SECRET_KEY` (solo desarrollo). */
  | "not_configured"
  /** El programa no tiene Price de Stripe (`npm run stripe:sync`). */
  | "price_missing"
  /** El Price de Stripe no coincide con el precio de la BD (SDD §5.3, §10). */
  | "price_mismatch"
  /** Stripe no respondió o rechazó la solicitud. */
  | "stripe_error";

/** No se puede cobrar con tarjeta ahora: el cliente puede pagar por transferencia. */
export class PaymentsUnavailableError extends ServiceError {
  constructor(
    public readonly reason: PaymentsUnavailableReason,
    detail?: string,
  ) {
    super(
      `El pago con tarjeta no está disponible (${reason})${detail ? `: ${detail}` : ""}.`,
      "payments_unavailable",
    );
  }
}

// ─── Entrega del plan (DECISIONS A19) ───────────────────────────────────────

export class DeliveryLinkUnavailableError extends ServiceError {
  constructor(public readonly reason: "not_found" | "expired") {
    super(`El botón de entrega no se puede usar (${reason}).`, "delivery_link_unavailable");
  }
}

export class InvalidDeliveryDateError extends ServiceError {
  constructor(public readonly reason: "future" | "before_payment") {
    super(`Fecha de entrega inválida (${reason}).`, "invalid_delivery_date");
  }
}

/**
 * La sesión de Checkout del pendiente ya se pagó (o el pago asíncrono sigue en proceso) y Stripe
 * todavía no avisa: no se abre otra para no cobrar dos veces.
 */
export class CheckoutInProgressError extends ServiceError {
  constructor(public readonly reference: string) {
    super(`El pago de ${reference} ya está en proceso.`, "payment_in_progress");
  }
}
