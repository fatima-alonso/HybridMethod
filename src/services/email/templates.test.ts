import { describe, expect, it } from "vitest";

import {
  escapeHtml,
  extraPaymentAlertEmail,
  paymentNotCompletedEmail,
  paymentReceivedEmail,
  planDeliveryReminderEmail,
  purchaseConfirmationEmail,
  transferConfirmedEmail,
  transferPendingEmail,
  verificationCodeEmail,
  welcomeEmail,
} from "./templates";

describe("plantillas de correo (SDD §6.2)", () => {
  it("Verification Code incluye el código y su vigencia", () => {
    const email = verificationCodeEmail({ code: "042917", expiresInMinutes: 10 });
    expect(email.subject).not.toContain("042917");
    expect(email.html).toContain("042917");
    expect(email.text).toContain("042917");
    expect(email.text).toContain("10 minutos");
  });

  const transfer = {
    reference: "HM-2026-000001",
    customerName: "Ana <script>alert(1)</script>",
    customerEmail: "ana@example.com",
    customerWhatsapp: "+525512345678",
    programName: "HM RUN",
    amount: "$1,200 MXN",
    confirmUrl: "https://hm.example/transfer/confirm/abc_DEF-123",
    expiresAt: "1 de diciembre de 2026, 10:00",
  };

  it("Transfer Pending incluye los datos del contrato y el enlace privado", () => {
    const email = transferPendingEmail(transfer);
    expect(email.subject).toContain("HM-2026-000001");
    for (const value of ["HM-2026-000001", "ana@example.com", "+525512345678", "HM RUN"]) {
      expect(email.html).toContain(value);
      expect(email.text).toContain(value);
    }
    expect(email.html).toContain('href="https://hm.example/transfer/confirm/abc_DEF-123"');
    expect(email.text).toContain(transfer.confirmUrl);
    expect(email.text).toMatch(/PIN/);
  });

  it("escapa el HTML que viene del cliente", () => {
    const email = transferPendingEmail(transfer);
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
    expect(escapeHtml(`"'&<>`)).toBe("&quot;&#39;&amp;&lt;&gt;");
  });

  const period = { serviceStart: "24 de noviembre de 2026", serviceEnd: "24 de diciembre de 2026" };
  const evil = "Ana <img src=x onerror=alert(1)>";

  it("Transfer Confirmed incluye referencia, importe y periodo, y escapa el nombre", () => {
    const email = transferConfirmedEmail({
      customerName: evil,
      reference: "HM-2026-000001",
      programName: "HM RUN",
      amount: "$1,200 MXN",
      ...period,
    });
    expect(email.subject).toContain("HM-2026-000001");
    for (const part of ["HM RUN", "$1,200 MXN", period.serviceStart, period.serviceEnd]) {
      expect(email.html).toContain(part);
      expect(email.text).toContain(part);
    }
    expect(email.text).toContain(`Vigencia: Del ${period.serviceStart} al ${period.serviceEnd}`);
    expect(email.html).toContain("Vigencia");
    expect(email.html).not.toContain("<img");
  });

  it("Welcome incluye el botón de WhatsApp solo si hay enlace", () => {
    const withLink = welcomeEmail({
      customerName: evil,
      programName: "HM COMPLETE",
      ...period,
      whatsappUrl: "https://wa.me/5215512345678?text=Hola",
    });
    expect(withLink.html).toContain("https://wa.me/5215512345678?text=Hola");
    expect(withLink.text).toContain("https://wa.me/5215512345678?text=Hola");
    expect(withLink.html).not.toContain("<img");
    const withoutLink = welcomeEmail({
      customerName: "Ana",
      programName: "HM COMPLETE",
      ...period,
      whatsappUrl: null,
    });
    expect(withoutLink.html).not.toContain("wa.me");
    for (const email of [withLink, withoutLink]) {
      expect(email.text).toContain(
        `Periodo de pago: del ${period.serviceStart} al ${period.serviceEnd}`,
      );
      expect(email.html).toContain("Periodo de pago:");
      expect(email.text).not.toContain("Tu plan va");
      expect(email.text).toContain("Ferro te entregará tu plan en 3 a 5 días hábiles.");
      expect(email.html).toContain("Ferro te entregará tu plan en 3 a 5 días hábiles.");
    }
  });

  it("Payment Received (Ferro) incluye los datos del cliente y el método", () => {
    const email = paymentReceivedEmail({
      reference: "HM-2026-000001",
      customerName: evil,
      customerEmail: "ana@example.com",
      customerWhatsapp: "+525512345678",
      programName: "HM RUN",
      amount: "$1,200 MXN",
      method: "Transferencia bancaria (confirmada por ti)",
      paidAt: "24 de noviembre de 2026, 10:00 a.m.",
      ...period,
      prepaid: null,
      deliveryUrl: "https://example.com/plan/entrega/abc",
    });
    for (const part of [
      "ana@example.com",
      "+525512345678",
      "HM RUN",
      "Transferencia bancaria (confirmada por ti)",
      "$1,200 MXN",
      "HM-2026-000001",
      "24 de noviembre de 2026, 10:00 a.m.",
      period.serviceEnd,
      "https://example.com/plan/entrega/abc",
    ]) {
      expect(email.text).toContain(part);
    }
    expect(email.html).toContain("Registrar entrega del plan");
    expect(email.html).toContain('href="https://example.com/plan/entrega/abc"');
    expect(email.html).not.toContain("<img");
  });

  it("Payment Received explica un pago por adelantado con las fechas del mes nuevo", () => {
    const email = paymentReceivedEmail({
      reference: "HM-2026-000010",
      customerName: "Ana",
      customerEmail: "ana@example.com",
      customerWhatsapp: "+525512345678",
      programName: "HM COMPLETE",
      amount: "$1,800 MXN",
      method: "Transferencia bancaria (confirmada por ti)",
      paidAt: "24 de noviembre de 2026, 11:13 a.m.",
      ...period,
      prepaid: { from: "24 de diciembre de 2026", to: "24 de enero de 2027" },
      deliveryUrl: "https://example.com/plan/entrega/abc",
    });
    const sentence =
      "Este cliente ya tiene un mes pagado hasta el 24 de diciembre de 2026, así que este pago cubre del 24 de diciembre de 2026 al 24 de enero de 2027.";
    expect(email.text).toContain(sentence);
    expect(email.html).toContain(sentence);
  });

  it("Plan Delivery Reminder dice qué plan falta y trae su propio botón", () => {
    const email = planDeliveryReminderEmail({
      customerName: evil,
      programName: "HM RUN",
      reference: "HM-2026-000001",
      paidAt: "24 de noviembre de 2026",
      deliveryUrl: "https://example.com/plan/entrega/xyz",
    });
    expect(email.subject).toContain("Está pendiente el plan de");
    expect(email.text).toContain("HM RUN · HM-2026-000001 · pagado el 24 de noviembre de 2026");
    expect(email.html).toContain('href="https://example.com/plan/entrega/xyz"');
    expect(email.html).not.toContain("<img");
  });

  it("Purchase Confirmation (Stripe) incluye referencia, método y vigencia, y escapa el nombre", () => {
    const base = {
      customerName: evil,
      reference: "HM-2026-000051",
      programName: "HM STRENGTH",
      amount: "$1,500 MXN",
      method: "Pago único con tarjeta",
      serviceStart: "25 de noviembre de 2026",
      serviceEnd: "25 de diciembre de 2026",
    };
    const email = purchaseConfirmationEmail({ ...base, startsLater: false });
    expect(email.subject).toBe("Confirmación de compra · HM-2026-000051");
    expect(email.text).toContain("Tu plan ya está activo.");
    expect(email.text).toContain("Método: Pago único con tarjeta");
    expect(email.text).toContain(
      "Vigencia: Del 25 de noviembre de 2026 al 25 de diciembre de 2026",
    );
    expect(email.html).not.toContain("<img");

    const later = purchaseConfirmationEmail({ ...base, startsLater: true });
    expect(later.text).toContain("Este mes empieza el 25 de noviembre de 2026");
    expect(later.text).not.toContain("ya está activo");
  });

  it("Payment Not Completed dice que no hubo cargo y trae el botón para reintentar", () => {
    const email = paymentNotCompletedEmail({
      customerName: evil,
      reference: "HM-2026-000052",
      programName: "HM RUN",
      retryUrl: "https://example.com/?programa=hm-run#athlete-application",
    });
    expect(email.text).toContain("no se hizo ningún cargo");
    expect(email.html).toContain('href="https://example.com/?programa=hm-run#athlete-application"');
    expect(email.html).not.toContain("<img");
  });

  it("Extra Payment Alert (Ferro) incluye el pago de Stripe para revisarlo", () => {
    const email = extraPaymentAlertEmail({
      reference: "HM-2026-000053",
      customerName: evil,
      customerEmail: "ana@example.com",
      amount: "$1,200 MXN",
      stripePaymentIntentId: "pi_123",
    });
    expect(email.subject).toContain("HM-2026-000053");
    expect(email.text).toContain("Pago en Stripe: pi_123");
    expect(email.text).toContain("No se abrió otro mes");
    expect(email.html).not.toContain("<img");
  });
});
