import { afterEach, describe, expect, it, vi } from "vitest";

import { resetConfigCache } from "@/lib/config";

const send = vi.fn();
vi.mock("resend", () => ({
  Resend: class {
    emails = { send };
  },
}));

const { EmailDeliveryError, sendTransferPendingEmail, sendVerificationCodeEmail } =
  await import("./email.service");

afterEach(() => {
  resetConfigCache();
  send.mockReset();
});

describe("email.service", () => {
  it("sin RESEND_API_KEY no llama a Resend (modo desarrollo)", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    resetConfigCache();
    const result = await sendVerificationCodeEmail({
      to: "ana@example.com",
      code: "123456",
      expiresInMinutes: 10,
    });
    expect(result).toEqual({ mode: "console" });
    expect(send).not.toHaveBeenCalled();
  });

  it("con RESEND_API_KEY envía con el remitente configurado", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_123");
    vi.stubEnv("RESEND_FROM_EMAIL", "HM <hola@hm.example>");
    resetConfigCache();
    send.mockResolvedValue({ data: { id: "email_1" }, error: null });
    const result = await sendVerificationCodeEmail({
      to: "ana@example.com",
      code: "123456",
      expiresInMinutes: 10,
    });
    expect(result).toEqual({ mode: "resend", id: "email_1" });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ from: "HM <hola@hm.example>", to: "ana@example.com" }),
    );
  });

  it("Transfer Pending va al correo de Ferro", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_123");
    vi.stubEnv("FERRO_NOTIFICATION_EMAIL", "ferro@hm.example");
    resetConfigCache();
    send.mockResolvedValue({ data: { id: "email_2" }, error: null });
    await sendTransferPendingEmail({
      reference: "HM-2026-000001",
      customerName: "Ana",
      customerEmail: "ana@example.com",
      customerWhatsapp: "+525512345678",
      programName: "HM RUN",
      amount: "$1,200 MXN",
      confirmUrl: "https://hm.example/transfer/confirm/x",
      expiresAt: "1 de diciembre",
    });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: "ferro@hm.example" }));
  });

  it("si Resend rechaza el correo, lanza EmailDeliveryError", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_123");
    resetConfigCache();
    send.mockResolvedValue({ data: null, error: { name: "validation_error", message: "x" } });
    await expect(
      sendVerificationCodeEmail({ to: "ana@example.com", code: "1", expiresInMinutes: 10 }),
    ).rejects.toBeInstanceOf(EmailDeliveryError);
  });
});
