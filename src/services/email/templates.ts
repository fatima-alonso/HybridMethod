/**
 * Plantillas de correo (SDD §6.2). Cada una devuelve asunto, HTML y texto plano.
 *
 * HTML simple con tablas y estilos en línea (compatibles con los clientes de correo) y la
 * paleta de la marca. Todo valor que viene del usuario se escapa.
 */

export type EmailContent = { subject: string; html: string; text: string };

const COLORS = { ink: "#111111", bone: "#F5F3EE", volt: "#FF6A00", muted: "#5C5A55" };

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Estructura común. `body` ya debe venir escapado. */
function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:${COLORS.bone};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.bone};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-top:6px solid ${COLORS.volt};font-family:Arial,Helvetica,sans-serif;color:${COLORS.ink};">
<tr><td style="background:${COLORS.ink};padding:20px 28px;color:${COLORS.bone};font-size:18px;font-weight:800;letter-spacing:2px;">THE HYBRID METHOD</td></tr>
<tr><td style="padding:28px;font-size:16px;line-height:1.5;">${body}</td></tr>
<tr><td style="padding:16px 28px;color:${COLORS.muted};font-size:12px;border-top:1px solid #e5e2db;">THE HYBRID METHOD · by Ferro Fits</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function rows(items: ReadonlyArray<readonly [string, string]>): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:16px 0;border-collapse:collapse;">${items
    .map(
      ([label, value]) =>
        `<tr><td style="padding:6px 12px 6px 0;color:${COLORS.muted};white-space:nowrap;vertical-align:top;">${escapeHtml(label)}</td><td style="padding:6px 0;font-weight:bold;">${escapeHtml(value)}</td></tr>`,
    )
    .join("")}</table>`;
}

function button(href: string, label: string): string {
  return `<p style="margin:24px 0;"><a href="${escapeHtml(href)}" style="display:inline-block;background:${COLORS.volt};color:${COLORS.ink};padding:14px 24px;font-weight:800;text-decoration:none;text-transform:uppercase;letter-spacing:1px;">${escapeHtml(label)}</a></p>`;
}

// ─── Verification Code (cliente) ────────────────────────────────────────────

export function verificationCodeEmail(input: {
  code: string;
  expiresInMinutes: number;
}): EmailContent {
  const subject = "Tu código de verificación · THE HYBRID METHOD";
  const html = layout(
    subject,
    `<h1 style="margin:0 0 12px;font-size:22px;">Verifica tu correo</h1>
<p style="margin:0 0 16px;">Escribe este código en la página para continuar con tu inscripción:</p>
<p style="margin:0 0 16px;font-size:36px;font-weight:800;letter-spacing:10px;font-family:'Courier New',monospace;">${escapeHtml(input.code)}</p>
<p style="margin:0 0 8px;">Vence en ${input.expiresInMinutes} minutos y solo se puede usar una vez.</p>
<p style="margin:0;color:${COLORS.muted};font-size:14px;">Si no pediste este código, ignora este correo. Nadie de THE HYBRID METHOD te lo va a pedir.</p>`,
  );
  const text = [
    "Verifica tu correo",
    "",
    `Tu código: ${input.code}`,
    "",
    `Vence en ${input.expiresInMinutes} minutos y solo se puede usar una vez.`,
    "Si no pediste este código, ignora este correo.",
  ].join("\n");
  return { subject, html, text };
}

// ─── Transfer Pending (Ferro) ───────────────────────────────────────────────

export type TransferPendingEmailInput = {
  reference: string;
  customerName: string;
  customerEmail: string;
  customerWhatsapp: string;
  programName: string;
  /** Importe ya formateado (p. ej. "$1,200 MXN"). */
  amount: string;
  confirmUrl: string;
  /** Fecha de vencimiento del enlace ya formateada. */
  expiresAt: string;
};

export function transferPendingEmail(input: TransferPendingEmailInput): EmailContent {
  const subject = `Nueva transferencia pendiente · ${input.reference}`;
  const details = [
    ["Referencia", input.reference],
    ["Cliente", input.customerName],
    ["Correo", input.customerEmail],
    ["WhatsApp", input.customerWhatsapp],
    ["Programa", input.programName],
    ["Importe", input.amount],
    ["Método", "Transferencia bancaria"],
  ] as const;
  const html = layout(
    subject,
    `<h1 style="margin:0 0 12px;font-size:22px;">Nueva contratación por transferencia</h1>
<p style="margin:0;">El cliente verificó su correo y eligió pagar por transferencia. Te escribirá por WhatsApp para pedirte los datos bancarios.</p>
${rows(details)}
<p style="margin:0;">Cuando veas el pago en tu banco, abre el enlace y confirma con tu PIN:</p>
${button(input.confirmUrl, "Revisar y confirmar pago")}
<p style="margin:0 0 8px;color:${COLORS.muted};font-size:14px;">Abrir el enlace no confirma nada: la confirmación solo ocurre con tu PIN. El enlace vence el ${escapeHtml(input.expiresAt)}; si vence, el contrato sigue pendiente y puedes generar uno nuevo.</p>
<p style="margin:0;color:${COLORS.muted};font-size:14px;">No reenvíes este correo: el enlace es privado.</p>`,
  );
  const text = [
    "Nueva contratación por transferencia",
    "",
    ...details.map(([label, value]) => `${label}: ${value}`),
    "",
    "Cuando veas el pago en tu banco, abre este enlace y confirma con tu PIN:",
    input.confirmUrl,
    "",
    `Abrir el enlace no confirma nada. Vence el ${input.expiresAt}. No reenvíes este correo.`,
  ].join("\n");
  return { subject, html, text };
}
