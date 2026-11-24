import { getConfig } from "@/lib/config";
import { getResendClient, RESEND_DEV_FROM } from "@/lib/resend";

import {
  paymentReceivedEmail,
  transferConfirmedEmail,
  transferPendingEmail,
  verificationCodeEmail,
  welcomeEmail,
  type EmailContent,
  type PaymentReceivedEmailInput,
  type TransferConfirmedEmailInput,
  type TransferPendingEmailInput,
  type WelcomeEmailInput,
} from "./email/templates";

/**
 * Envío de correos (SDD §6.2).
 *
 * - Con `RESEND_API_KEY`, se envía con Resend.
 * - Sin ella (solo desarrollo y pruebas: en producción es obligatoria), el correo se registra en la
 *   consola para poder probar los flujos sin claves reales (CLAUDE.md).
 *
 * Un fallo al enviar lanza `EmailDeliveryError`; quien llama decide si eso detiene la operación
 * (un código OTP que no llegó) o solo se registra (nunca revierte un pago confirmado).
 */

export class EmailDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailDeliveryError";
  }
}

export type EmailMessage = EmailContent & { to: string };
export type EmailResult = { mode: "resend"; id: string } | { mode: "console" };

export async function sendEmail(message: EmailMessage): Promise<EmailResult> {
  const config = getConfig();
  const resend = getResendClient();

  if (!resend) {
    if (config.environment !== "test") {
      console.info(
        `[email:dev] Para: ${message.to}\n[email:dev] Asunto: ${message.subject}\n${message.text}\n[email:dev] ──`,
      );
    }
    return { mode: "console" };
  }

  const { data, error } = await resend.emails.send({
    from: config.RESEND_FROM_EMAIL ?? RESEND_DEV_FROM,
    to: message.to,
    subject: message.subject,
    html: message.html,
    text: message.text,
  });
  if (error || !data) {
    // Solo el tipo de error: el mensaje de Resend podría incluir datos del destinatario.
    throw new EmailDeliveryError(`Resend no aceptó el correo (${error?.name ?? "sin respuesta"}).`);
  }
  return { mode: "resend", id: data.id };
}

/**
 * Correo de Ferro para notificaciones. En desarrollo, si falta `FERRO_NOTIFICATION_EMAIL`, se usa
 * una dirección de ejemplo y el correo se registra en consola (no hay `RESEND_API_KEY`) o falla.
 */
function ferroEmail(): string {
  return getConfig().FERRO_NOTIFICATION_EMAIL ?? "ferro@example.com";
}

/** Verification Code (cliente). */
export function sendVerificationCodeEmail(input: {
  to: string;
  code: string;
  expiresInMinutes: number;
}): Promise<EmailResult> {
  return sendEmail({ to: input.to, ...verificationCodeEmail(input) });
}

/** Transfer Pending (Ferro), con el enlace privado de confirmación (RF-09, RF-13). */
export function sendTransferPendingEmail(input: TransferPendingEmailInput): Promise<EmailResult> {
  return sendEmail({ to: ferroEmail(), ...transferPendingEmail(input) });
}

/** Transfer Confirmed (cliente): Ferro confirmó la transferencia (RF-12). */
export function sendTransferConfirmedEmail(
  input: TransferConfirmedEmailInput & { to: string },
): Promise<EmailResult> {
  return sendEmail({ to: input.to, ...transferConfirmedEmail(input) });
}

/** Welcome (cliente): el servicio se activó (RF-12, RF-14). */
export function sendWelcomeEmail(input: WelcomeEmailInput & { to: string }): Promise<EmailResult> {
  return sendEmail({ to: input.to, ...welcomeEmail(input) });
}

/** Payment Received (Ferro): pago registrado, incluida una transferencia confirmada (RF-13). */
export function sendPaymentReceivedEmail(input: PaymentReceivedEmailInput): Promise<EmailResult> {
  return sendEmail({ to: ferroEmail(), ...paymentReceivedEmail(input) });
}
