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
