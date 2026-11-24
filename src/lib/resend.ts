import { Resend } from "resend";

import { getConfig } from "@/lib/config";

/**
 * Cliente de Resend (SDD §6.2). Solo para código de servidor.
 * Devuelve `undefined` si no hay `RESEND_API_KEY` (desarrollo): el servicio de correo registra los
 * mensajes en la consola en ese caso. En producción la clave es obligatoria (DECISIONS A9).
 */
let client: Resend | undefined;
let clientKey: string | undefined;

export function getResendClient(): Resend | undefined {
  const key = getConfig().RESEND_API_KEY;
  if (!key) return undefined;
  if (!client || clientKey !== key) {
    client = new Resend(key);
    clientKey = key;
  }
  return client;
}

/** Remitente de prueba de Resend, solo para desarrollo con clave pero sin remitente propio. */
export const RESEND_DEV_FROM = "THE HYBRID METHOD <onboarding@resend.dev>";
