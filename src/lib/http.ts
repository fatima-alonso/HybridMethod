import { NextResponse, type NextRequest } from "next/server";
import type { z } from "zod";

import { DatabaseNotConfiguredError } from "@/lib/prisma";
import {
  readVerificationSessionToken,
  verificationCookieName,
  type VerificationSession,
} from "@/lib/verification-session";

/**
 * Utilidades de los Route Handlers (SDD §7, §10). Las respuestas de la API nunca se guardan en
 * caché y los errores no exponen detalles internos.
 */

export type ApiErrorCode =
  | "invalid_input"
  | "unsupported_media_type"
  | "rate_limited"
  | "verification_required"
  | "invalid_code"
  | "code_expired"
  | "too_many_attempts"
  | "program_unavailable"
  | "email_failed"
  | "invalid_pin"
  | "link_unavailable"
  | "contract_not_pending"
  | "not_found"
  | "pending_contract_exists"
  | "subscription_active"
  | "prepaid_limit"
  | "invalid_date"
  | "service_unavailable"
  | "internal_error";

const NO_STORE = { "Cache-Control": "no-store" };

export function jsonOk<T extends Record<string, unknown>>(body: T, status = 200): NextResponse {
  return NextResponse.json({ success: true, ...body }, { status, headers: NO_STORE });
}

export function jsonError(
  status: number,
  error: ApiErrorCode,
  message: string,
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): NextResponse {
  return NextResponse.json(
    { success: false, error, message, ...extra },
    { status, headers: { ...NO_STORE, ...headers } },
  );
}

export function rateLimited(retryAfterSeconds: number): NextResponse {
  return jsonError(
    429,
    "rate_limited",
    "Demasiados intentos. Espera un momento y vuelve a intentarlo.",
    { retryAfterSeconds },
    { "Retry-After": String(retryAfterSeconds) },
  );
}

/** IP del cliente según el proxy de Vercel (primer valor de `x-forwarded-for`). */
export function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}

export function getUserAgent(request: NextRequest): string | null {
  return request.headers.get("user-agent");
}

type ParsedBody<T> = { ok: true; data: T } | { ok: false; response: NextResponse };

/**
 * Lee y valida un body JSON con Zod. Exigir `application/json` también evita que un formulario
 * HTML de otro sitio pueda enviar la solicitud sin una verificación previa CORS.
 */
export async function parseJsonBody<S extends z.ZodType>(
  request: NextRequest,
  schema: S,
): Promise<ParsedBody<z.output<S>>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return {
      ok: false,
      response: jsonError(415, "unsupported_media_type", "Se esperaba JSON."),
    };
  }
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { ok: false, response: jsonError(400, "invalid_input", "El cuerpo no es JSON válido.") };
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const fields: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.map(String).join(".") || "_";
      fields[key] ??= issue.message;
    }
    return {
      ok: false,
      response: jsonError(400, "invalid_input", "Revisa los datos enviados.", { fields }),
    };
  }
  return { ok: true, data: result.data };
}

/** Sesión de verificación de la cookie, o `null` si falta, es inválida o expiró. */
export function getVerificationSession(request: NextRequest): VerificationSession | null {
  return readVerificationSessionToken(request.cookies.get(verificationCookieName())?.value);
}

/** Respuesta para errores no esperados: se registra el tipo, nunca el detalle al cliente. */
export function unexpectedError(scope: string, error: unknown): NextResponse {
  if (error instanceof DatabaseNotConfiguredError) {
    return jsonError(503, "service_unavailable", "El servicio no está disponible por ahora.");
  }
  console.error(`[${scope}] Error inesperado:`, error instanceof Error ? error.name : error);
  return jsonError(500, "internal_error", "Ocurrió un error. Intenta de nuevo en unos minutos.");
}
