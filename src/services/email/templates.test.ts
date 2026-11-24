import { describe, expect, it } from "vitest";

import { escapeHtml, transferPendingEmail, verificationCodeEmail } from "./templates";

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
});
