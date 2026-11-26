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

// ─── Transfer Confirmed (cliente) ───────────────────────────────────────────

export type TransferConfirmedEmailInput = {
  customerName: string;
  reference: string;
  programName: string;
  /** Importe ya formateado. */
  amount: string;
  /** Fechas ya formateadas. */
  serviceStart: string;
  serviceEnd: string;
};

export function transferConfirmedEmail(input: TransferConfirmedEmailInput): EmailContent {
  const subject = `Recibimos tu pago · ${input.reference}`;
  const details = [
    ["Referencia", input.reference],
    ["Programa", input.programName],
    ["Importe", input.amount],
    ["Método", "Transferencia bancaria"],
    ["Vigencia", `Del ${input.serviceStart} al ${input.serviceEnd}`],
  ] as const;
  const html = layout(
    subject,
    `<h1 style="margin:0 0 12px;font-size:22px;">Pago confirmado</h1>
<p style="margin:0;">Hola ${escapeHtml(input.customerName)}, Ferro confirmó tu transferencia. Tu plan ya está activo.</p>
${rows(details)}
<p style="margin:0;color:${COLORS.muted};font-size:14px;">Guarda este correo como comprobante de tu pago.</p>`,
  );
  const text = [
    "Pago confirmado",
    "",
    `Hola ${input.customerName}, Ferro confirmó tu transferencia. Tu plan ya está activo.`,
    "",
    ...details.map(([label, value]) => `${label}: ${value}`),
    "",
    "Guarda este correo como comprobante de tu pago.",
  ].join("\n");
  return { subject, html, text };
}

// ─── Welcome (cliente) ──────────────────────────────────────────────────────

/** Plazo de entrega del plan (RN-07, SDD §6.2, DECISIONS A19). */
export const PLAN_DELIVERY_NOTICE = "Ferro te entregará tu plan en 3 a 5 días hábiles.";

export type WelcomeEmailInput = {
  customerName: string;
  programName: string;
  serviceStart: string;
  serviceEnd: string;
  /** Enlace `wa.me` con Ferro, o `null` si todavía no está configurado. */
  whatsappUrl: string | null;
};

export function welcomeEmail(input: WelcomeEmailInput): EmailContent {
  const subject = `Bienvenido a ${input.programName} · THE HYBRID METHOD`;
  const html = layout(
    subject,
    `<h1 style="margin:0 0 12px;font-size:22px;">Bienvenido a THE HYBRID METHOD</h1>
<p style="margin:0 0 16px;">Hola ${escapeHtml(input.customerName)}, ya eres parte de <strong>${escapeHtml(input.programName)}</strong>.</p>
<p style="margin:0 0 16px;"><strong>Periodo de pago:</strong> del ${escapeHtml(input.serviceStart)} al ${escapeHtml(input.serviceEnd)}</p>
<p style="margin:0 0 16px;"><strong>${PLAN_DELIVERY_NOTICE}</strong></p>
<p style="margin:0;">Ferro te va a escribir por WhatsApp para conocer tus objetivos y arrancar con tu programa.${input.whatsappUrl ? " Si quieres adelantarte, escríbele tú:" : ""}</p>
${input.whatsappUrl ? button(input.whatsappUrl, "Escribirle a Ferro") : ""}
<p style="margin:16px 0 0;color:${COLORS.muted};font-size:14px;">Run. Lift. Hybrid.</p>`,
  );
  const text = [
    "Bienvenido a THE HYBRID METHOD",
    "",
    `Hola ${input.customerName}, ya eres parte de ${input.programName}.`,
    "",
    `Periodo de pago: del ${input.serviceStart} al ${input.serviceEnd}`,
    "",
    PLAN_DELIVERY_NOTICE,
    "",
    "Ferro te va a escribir por WhatsApp para conocer tus objetivos y arrancar con tu programa.",
    ...(input.whatsappUrl ? ["Si quieres adelantarte, escríbele tú:", input.whatsappUrl] : []),
  ].join("\n");
  return { subject, html, text };
}

// ─── Payment Received (Ferro) ───────────────────────────────────────────────

export type PaymentReceivedEmailInput = {
  reference: string;
  customerName: string;
  customerEmail: string;
  customerWhatsapp: string;
  programName: string;
  amount: string;
  /** Modalidad y método ya en texto (p. ej. "Transferencia bancaria (confirmada por ti)"). */
  method: string;
  /** Fecha de pago ya formateada. */
  paidAt: string;
  serviceStart: string;
  serviceEnd: string;
  /**
   * Si es un mes pagado por adelantado (DECISIONS A20): fechas sin hora del mes nuevo. Empieza
   * cuando termina el mes que el cliente ya tenía pagado.
   */
  prepaid: { from: string; to: string } | null;
  /** Botón "Registrar entrega del plan" (DECISIONS A19). */
  deliveryUrl: string;
};

const DELIVERY_BUTTON = "Registrar entrega del plan";

/** Correo de Ferro con los datos del cliente y del pago, y el botón de entrega (A19). */
function paidWithDeliveryButton(
  input: Omit<PaymentReceivedEmailInput, "prepaid">,
  copy: { subject: string; title: string; lead: string },
): EmailContent {
  const details = [
    ["Cliente", input.customerName],
    ["Correo", input.customerEmail],
    ["WhatsApp", input.customerWhatsapp],
    ["Programa", input.programName],
    ["Modalidad", input.method],
    ["Importe", input.amount],
    ["Referencia", input.reference],
    ["Fecha de pago", input.paidAt],
    ["Periodo", `Del ${input.serviceStart} al ${input.serviceEnd}`],
  ] as const;
  const html = layout(
    copy.subject,
    `<h1 style="margin:0 0 12px;font-size:22px;">${escapeHtml(copy.title)}</h1>
<p style="margin:0;">${escapeHtml(copy.lead)}</p>
${rows(details)}
<p style="margin:0;">Cuando le entregues el plan, regístralo aquí (puedes cambiar la fecha si lo registras después):</p>
${button(input.deliveryUrl, DELIVERY_BUTTON)}
<p style="margin:0;color:${COLORS.muted};font-size:14px;">Mientras no registres la entrega, te llegará un recordatorio cada día hábil con un botón nuevo.</p>`,
  );
  const text = [
    copy.title,
    "",
    copy.lead,
    "",
    ...details.map(([label, value]) => `${label}: ${value}`),
    "",
    `${DELIVERY_BUTTON}:`,
    input.deliveryUrl,
  ].join("\n");
  return { subject: copy.subject, html, text };
}

export function paymentReceivedEmail(input: PaymentReceivedEmailInput): EmailContent {
  const lead = input.prepaid
    ? `El contrato quedó pagado por adelantado. Este cliente ya tiene un mes pagado hasta el ${input.prepaid.from}, así que este pago cubre del ${input.prepaid.from} al ${input.prepaid.to}. Ya recibió su confirmación y el correo de bienvenida.`
    : "El contrato quedó activo y el cliente recibió su confirmación y el correo de bienvenida.";
  return paidWithDeliveryButton(input, {
    subject: `Pago registrado · ${input.reference} · ${input.customerName}`,
    title: "Pago registrado",
    lead,
  });
}

// ─── Renewal Successful (Ferro) ─────────────────────────────────────────────

export type RenewalSuccessfulEmailInput = Omit<PaymentReceivedEmailInput, "prepaid"> & {
  /** Número de mes de la suscripción (2, 3, …). */
  monthNumber: number;
};

/** Renovación cobrada por Stripe (RF-08, RF-17): los mismos datos y su propio botón de entrega. */
export function renewalSuccessfulEmail(input: RenewalSuccessfulEmailInput): EmailContent {
  return paidWithDeliveryButton(input, {
    subject: `Renovación registrada · ${input.reference} · ${input.customerName}`,
    title: "Renovación registrada",
    lead: `La suscripción se renovó: es el mes ${input.monthNumber} de este cliente. Su servicio sigue activo y ya recibió la confirmación de su renovación.`,
  });
}

// ─── Subscription Renewed (cliente) ─────────────────────────────────────────

export type SubscriptionRenewedEmailInput = {
  customerName: string;
  reference: string;
  programName: string;
  /** Importe ya formateado. */
  amount: string;
  /** Fechas ya formateadas. */
  serviceStart: string;
  serviceEnd: string;
};

/** El cliente recibe la confirmación de cada renovación (RF-08). */
export function subscriptionRenewedEmail(input: SubscriptionRenewedEmailInput): EmailContent {
  const subject = `Tu suscripción se renovó · ${input.reference}`;
  const details = [
    ["Referencia", input.reference],
    ["Programa", input.programName],
    ["Importe", input.amount],
    ["Método", "Suscripción mensual con tarjeta"],
    ["Nuevo periodo", `Del ${input.serviceStart} al ${input.serviceEnd}`],
  ] as const;
  const lead = `Hola ${input.customerName}, cobramos tu mes de ${input.programName}. Tu plan sigue activo.`;
  const note =
    "Tu suscripción se renueva cada mes hasta que la canceles. Ferro te entregará el plan de este mes por WhatsApp.";
  const html = layout(
    subject,
    `<h1 style="margin:0 0 12px;font-size:22px;">Suscripción renovada</h1>
<p style="margin:0;">${escapeHtml(lead)}</p>
${rows(details)}
<p style="margin:0;color:${COLORS.muted};font-size:14px;">${escapeHtml(note)} Stripe también te envía su recibo.</p>`,
  );
  const text = [
    "Suscripción renovada",
    "",
    lead,
    "",
    ...details.map(([label, value]) => `${label}: ${value}`),
    "",
    `${note} Stripe también te envía su recibo.`,
  ].join("\n");
  return { subject, html, text };
}

// ─── Payment Failed (cliente y Ferro) ───────────────────────────────────────

export type PaymentFailedEmailInput = {
  customerName: string;
  reference: string;
  programName: string;
  /** Importe del cobro que falló, ya formateado. */
  amount: string;
  /** Página de Stripe para pagar la factura con otra tarjeta, si Stripe la dio. */
  payUrl: string | null;
};

/** Cobro de la renovación rechazado: el servicio queda suspendido (RF-18, RN-14). */
export function paymentFailedEmail(input: PaymentFailedEmailInput): EmailContent {
  const subject = `No pudimos cobrar tu suscripción · ${input.reference}`;
  const lead = `Hola ${input.customerName}, el cobro de ${input.amount} de tu suscripción a ${input.programName} no se completó.`;
  const paused =
    "Mientras el pago esté pendiente, tu servicio queda en pausa. Stripe volverá a intentar el cobro en los próximos días; en cuanto se pague, tu plan se reactiva solo. Si los intentos no se completan, la suscripción se cancela.";
  const action = input.payUrl
    ? "Si tu tarjeta cambió o no tiene fondos, puedes pagar ahora con otra tarjeta:"
    : "Si tu tarjeta cambió o no tiene fondos, escríbele a Ferro por WhatsApp.";
  const html = layout(
    subject,
    `<h1 style="margin:0 0 12px;font-size:22px;">No pudimos cobrar tu suscripción</h1>
<p style="margin:0 0 16px;">${escapeHtml(lead)}</p>
<p style="margin:0 0 16px;">${escapeHtml(paused)}</p>
<p style="margin:0;">${escapeHtml(action)}</p>
${input.payUrl ? button(input.payUrl, "Pagar ahora") : ""}`,
  );
  const text = [
    "No pudimos cobrar tu suscripción",
    "",
    lead,
    "",
    paused,
    "",
    action,
    ...(input.payUrl ? [input.payUrl] : []),
  ].join("\n");
  return { subject, html, text };
}

export type PaymentFailedAlertEmailInput = {
  reference: string;
  customerName: string;
  customerEmail: string;
  customerWhatsapp: string;
  programName: string;
  amount: string;
  /** Intento de cobro según Stripe (1, 2, …). */
  attempt: number;
};

/** Aviso a Ferro: una renovación falló y el servicio de ese cliente está suspendido. */
export function paymentFailedAlertEmail(input: PaymentFailedAlertEmailInput): EmailContent {
  const subject = `Pago fallido · ${input.reference} · ${input.customerName}`;
  const details = [
    ["Cliente", input.customerName],
    ["Correo", input.customerEmail],
    ["WhatsApp", input.customerWhatsapp],
    ["Programa", input.programName],
    ["Importe", input.amount],
    ["Referencia", input.reference],
    ["Intento", String(input.attempt)],
  ] as const;
  const lead =
    "Stripe no pudo cobrar la renovación de esta suscripción. El servicio queda suspendido hasta que se pague; Stripe reintenta el cobro solo y, si los intentos se agotan, cancela la suscripción. Ya le avisamos al cliente.";
  const html = layout(
    subject,
    `<h1 style="margin:0 0 12px;font-size:22px;">Pago fallido</h1>
<p style="margin:0;">${escapeHtml(lead)}</p>
${rows(details)}`,
  );
  const text = [
    "Pago fallido",
    "",
    lead,
    "",
    ...details.map(([label, value]) => `${label}: ${value}`),
  ].join("\n");
  return { subject, html, text };
}

// ─── Plan Delivery Reminder (Ferro) ─────────────────────────────────────────

export type PlanDeliveryReminderEmailInput = {
  customerName: string;
  programName: string;
  reference: string;
  /** Fecha de pago ya formateada. */
  paidAt: string;
  deliveryUrl: string;
};

export function planDeliveryReminderEmail(input: PlanDeliveryReminderEmailInput): EmailContent {
  const summary = `${input.customerName} · ${input.programName} · ${input.reference} · pagado el ${input.paidAt}`;
  const subject = `Está pendiente el plan de ${input.customerName}`;
  const html = layout(
    subject,
    `<h1 style="margin:0 0 12px;font-size:22px;">Está pendiente el plan de ${escapeHtml(input.customerName)}</h1>
<p style="margin:0;">${escapeHtml(summary)}</p>
${button(input.deliveryUrl, DELIVERY_BUTTON)}
<p style="margin:0;color:${COLORS.muted};font-size:14px;">Este recordatorio llega cada día hábil hasta que registres la entrega. La fecha de entrega es solo de referencia: no cambia el periodo ni los cobros.</p>`,
  );
  const text = [
    `Está pendiente el plan de ${input.customerName}`,
    "",
    summary,
    "",
    `${DELIVERY_BUTTON}:`,
    input.deliveryUrl,
  ].join("\n");
  return { subject, html, text };
}

// ─── Purchase Confirmation (cliente, pago con Stripe) ───────────────────────

export type PurchaseConfirmationEmailInput = {
  customerName: string;
  reference: string;
  programName: string;
  /** Importe ya formateado. */
  amount: string;
  /** Modalidad en texto (p. ej. "Pago único con tarjeta"). */
  method: string;
  /** Fechas ya formateadas. */
  serviceStart: string;
  serviceEnd: string;
  /** `true` si es un mes pagado por adelantado que empieza después (DECISIONS A20). */
  startsLater: boolean;
  /** `true` si es el primer pago de una suscripción (se renueva cada mes, RF-08). */
  renewsMonthly?: boolean;
};

export function purchaseConfirmationEmail(input: PurchaseConfirmationEmailInput): EmailContent {
  const subject = `Confirmación de compra · ${input.reference}`;
  const details = [
    ["Referencia", input.reference],
    ["Programa", input.programName],
    ["Importe", input.amount],
    ["Método", input.method],
    ["Vigencia", `Del ${input.serviceStart} al ${input.serviceEnd}`],
  ] as const;
  const lead = input.startsLater
    ? `Hola ${input.customerName}, recibimos tu pago. Este mes empieza el ${input.serviceStart}, cuando termina el que ya tenías pagado.`
    : `Hola ${input.customerName}, recibimos tu pago. Tu plan ya está activo.`;
  const renews = input.renewsMonthly
    ? "Tu suscripción se renueva sola cada mes, en la misma fecha, hasta que la canceles."
    : null;
  const html = layout(
    subject,
    `<h1 style="margin:0 0 12px;font-size:22px;">Compra confirmada</h1>
<p style="margin:0;">${escapeHtml(lead)}</p>
${rows(details)}
${renews ? `<p style="margin:0 0 16px;">${escapeHtml(renews)}</p>` : ""}
<p style="margin:0;color:${COLORS.muted};font-size:14px;">Guarda este correo como comprobante. Stripe también te envía su recibo.</p>`,
  );
  const text = [
    "Compra confirmada",
    "",
    lead,
    "",
    ...details.map(([label, value]) => `${label}: ${value}`),
    "",
    ...(renews ? [renews, ""] : []),
    "Guarda este correo como comprobante. Stripe también te envía su recibo.",
  ].join("\n");
  return { subject, html, text };
}

// ─── Payment Not Completed (cliente, pago asíncrono fallido) ────────────────

export type PaymentNotCompletedEmailInput = {
  customerName: string;
  reference: string;
  programName: string;
  /** Enlace para volver a intentarlo (la sección de inscripción de la landing). */
  retryUrl: string;
};

export function paymentNotCompletedEmail(input: PaymentNotCompletedEmailInput): EmailContent {
  const subject = `Tu pago no se completó · ${input.reference}`;
  const lead = `Hola ${input.customerName}, Stripe nos avisó que tu pago de ${input.programName} no se completó, así que no se hizo ningún cargo.`;
  const next =
    "Tu registro sigue pendiente durante 7 días. Puedes volver a intentarlo con tu mismo correo, con otra forma de pago o por transferencia.";
  const html = layout(
    subject,
    `<h1 style="margin:0 0 12px;font-size:22px;">Tu pago no se completó</h1>
<p style="margin:0 0 16px;">${escapeHtml(lead)}</p>
<p style="margin:0;">${escapeHtml(next)}</p>
${button(input.retryUrl, "Intentarlo de nuevo")}`,
  );
  const text = ["Tu pago no se completó", "", lead, "", next, "", input.retryUrl].join("\n");
  return { subject, html, text };
}

// ─── Extra Payment Alert (Ferro) ────────────────────────────────────────────

export type ExtraPaymentAlertEmailInput = {
  reference: string;
  customerName: string;
  customerEmail: string;
  /** Importe cobrado por Stripe, ya formateado. */
  amount: string;
  /** ID del Payment Intent (o de la factura), para buscarlo en el Dashboard de Stripe. */
  stripePaymentIntentId: string;
  /**
   * Si el cobro es de una segunda suscripción del mismo contrato (p. ej. dos pestañas de Checkout):
   * su ID, para cancelarla en Stripe y que no se vuelva a cobrar (DECISIONS A31).
   */
  duplicateSubscriptionId?: string | null;
};

/**
 * Stripe confirmó un pago para un contrato que ya estaba pagado (p. ej. dos pestañas de Checkout).
 * No abre otro mes: Ferro decide en Stripe si lo reembolsa (los reembolsos son manuales).
 */
export function extraPaymentAlertEmail(input: ExtraPaymentAlertEmailInput): EmailContent {
  const subject = `Revisa un pago adicional · ${input.reference}`;
  const details = [
    ["Cliente", input.customerName],
    ["Correo", input.customerEmail],
    ["Referencia", input.reference],
    ["Importe", input.amount],
    ["Pago en Stripe", input.stripePaymentIntentId],
    ...(input.duplicateSubscriptionId
      ? ([["Suscripción duplicada", input.duplicateSubscriptionId]] as const)
      : []),
  ] as const;
  const lead = input.duplicateSubscriptionId
    ? "Stripe cobró una segunda suscripción para un contrato que ya tiene la suya. No se abrió otro mes. Cancela esa suscripción en el Dashboard de Stripe para que no se vuelva a cobrar y, si corresponde, reembolsa el pago."
    : "Stripe cobró un pago para un contrato que ya estaba pagado. No se abrió otro mes. Revísalo en el Dashboard de Stripe y, si corresponde, reembólsalo desde ahí.";
  const html = layout(
    subject,
    `<h1 style="margin:0 0 12px;font-size:22px;">Revisa un pago adicional</h1>
<p style="margin:0;">${escapeHtml(lead)}</p>
${rows(details)}`,
  );
  const text = [
    "Revisa un pago adicional",
    "",
    lead,
    "",
    ...details.map(([label, value]) => `${label}: ${value}`),
  ].join("\n");
  return { subject, html, text };
}
