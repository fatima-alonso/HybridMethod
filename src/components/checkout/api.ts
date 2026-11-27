/**
 * Llamadas del navegador a la API (Fases 3 y 5). Solo envían lo que pide cada endpoint: el importe
 * y el Price nunca salen del navegador (SDD §9.2) y el correo verificado viaja en la cookie.
 */

export type ApiSuccess<T> = { ok: true; status: number; data: T };
export type ApiFailure = {
  ok: false;
  /** 0 si no hubo respuesta (sin red). */
  status: number;
  error: string;
  message: string;
  remainingAttempts?: number;
  retryAfterSeconds?: number;
  /** Cuerpo completo de la respuesta (p. ej. `pending` en un 409 pending_contract_exists). */
  body?: Record<string, unknown>;
};
export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

export async function postJson<T>(url: string, body: unknown): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, error: "network", message: "" };
  }
  let data: Record<string, unknown> = {};
  try {
    data = (await response.json()) as Record<string, unknown>;
  } catch {
    // Respuesta sin JSON (p. ej. un error del proxy): se trata como error genérico.
  }
  if (response.ok && data.success === true) {
    return { ok: true, status: response.status, data: data as T };
  }
  return {
    ok: false,
    status: response.status,
    error: typeof data.error === "string" ? data.error : "unknown",
    message: typeof data.message === "string" ? data.message : "",
    remainingAttempts:
      typeof data.remainingAttempts === "number" ? data.remainingAttempts : undefined,
    retryAfterSeconds:
      typeof data.retryAfterSeconds === "number" ? data.retryAfterSeconds : undefined,
    body: data,
  };
}

/** Resumen del pendiente del cliente (409 pending_contract_exists, DECISIONS A20). */
export type PendingSummary = {
  reference: string;
  programSlug: string;
  programName: string;
  paymentType: string;
  amount: `${number}`;
  currency: string;
};

export function isPendingSummary(value: unknown): value is PendingSummary {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return ["reference", "programSlug", "programName", "paymentType", "amount", "currency"].every(
    (key) => typeof v[key] === "string",
  );
}

export type TransferCreated = {
  reference: string;
  status: string;
  program: { slug: string; name: string };
  amount: `${number}`;
  currency: string;
  whatsappUrl: string | null;
};

/** Respuesta de `POST /api/checkout`: lo necesario para montar Embedded Checkout (DECISIONS A27). */
export type CheckoutCreated = {
  clientSecret: string;
  publishableKey: string;
  /** Página de "¡Gracias!" a la que lleva el formulario al terminar de pagar. */
  returnUrl: string;
  /** `payment` (pago único) o `subscription` (suscripción mensual). */
  mode: "payment" | "subscription";
  reference: string;
  status: string;
  outcome: string;
  program: { slug: string; name: string };
  amount: `${number}`;
  currency: string;
};

/** `POST /api/portal` (SDD §7.7): URL del Stripe Customer Portal del correo verificado. */
export type PortalCreated = { url: string };

export function openPortalSession(): Promise<ApiResult<PortalCreated>> {
  return postJson<PortalCreated>("/api/portal", {});
}
