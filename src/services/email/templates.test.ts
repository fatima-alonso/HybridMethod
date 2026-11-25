import { describe, expect, it } from "vitest";

import {
  escapeHtml,
  paymentReceivedEmail,
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
      ...period,
    });
    expect(email.text).toContain("ana@example.com");
    expect(email.text).toContain("Transferencia bancaria (confirmada por ti)");
    expect(email.html).not.toContain("<img");
  });
});
