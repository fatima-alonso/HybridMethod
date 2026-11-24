import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hashOtpCode } from "@/lib/crypto";
import { createTestPrisma, testDatabaseUrl, truncateAll } from "@/test/db";

import { upsertVerifiedCustomer } from "./customer.service";

const sendVerificationCodeEmail = vi.fn();
vi.mock("./email.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./email.service")>()),
  sendVerificationCodeEmail: (...args: unknown[]) => sendVerificationCodeEmail(...args),
}));

const { confirmVerificationCode, requestVerificationCode, OTP_TTL_MS } =
  await import("./verification.service");
const { EmailDeliveryError } = await import("./email.service");

describe.skipIf(!testDatabaseUrl)("verification.service con PostgreSQL (RF-15, A4)", () => {
  const prisma = testDatabaseUrl ? createTestPrisma() : (undefined as never);
  const t0 = new Date("2026-11-24T10:00:00Z");
  const at = (ms: number) => new Date(t0.getTime() + ms);

  beforeEach(async () => {
    await truncateAll(prisma);
    sendVerificationCodeEmail.mockReset().mockResolvedValue({ mode: "console" });
  });
  afterAll(() => prisma.$disconnect());

  const lastCode = (): string => {
    const call = sendVerificationCodeEmail.mock.calls.at(-1);
    return (call?.[0] as { code: string }).code;
  };

  it("envía un código de 6 dígitos y solo guarda su hash, con vigencia de 10 minutos", async () => {
    expect(await requestVerificationCode(" Ana@Example.com ", prisma, t0)).toEqual({
      status: "sent",
    });
    const code = lastCode();
    expect(code).toMatch(/^\d{6}$/);
    expect(sendVerificationCodeEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "ana@example.com", expiresInMinutes: 10 }),
    );
    const otp = await prisma.oTPVerification.findFirstOrThrow();
    expect(otp.email).toBe("ana@example.com");
    expect(otp.codeHash).toBe(hashOtpCode("ana@example.com", code));
    expect(otp.codeHash).not.toContain(code);
    expect(otp.expiresAt.getTime() - t0.getTime()).toBe(OTP_TTL_MS);
  });

  it("envía el código igual exista o no el cliente, y solo lo asocia internamente", async () => {
    const customer = await upsertVerifiedCustomer(
      { fullName: "Ana López", email: "ana@example.com", whatsapp: "+525512345678" },
      prisma,
    );
    const existing = await requestVerificationCode("ana@example.com", prisma, t0);
    const unknown = await requestVerificationCode("nadie@example.com", prisma, t0);
    expect(existing).toEqual(unknown);
    const otps = await prisma.oTPVerification.findMany({ orderBy: { email: "asc" } });
    expect(otps.map((o) => o.customerId)).toEqual([customer.id, null]);
  });

  it("permite un código por correo cada 60 s y 5 por hora", async () => {
    await requestVerificationCode("ana@example.com", prisma, t0);
    expect(await requestVerificationCode("ana@example.com", prisma, at(30_000))).toEqual({
      status: "rate_limited",
      retryAfterSeconds: 30,
    });
    for (let i = 1; i < 5; i++) {
      expect(
        (await requestVerificationCode("ana@example.com", prisma, at(i * 61_000))).status,
      ).toBe("sent");
    }
    const sixth = await requestVerificationCode("ana@example.com", prisma, at(5 * 61_000));
    expect(sixth.status).toBe("rate_limited");
    expect(sendVerificationCodeEmail).toHaveBeenCalledTimes(5);
  });

  it("propaga el fallo del correo", async () => {
    sendVerificationCodeEmail.mockRejectedValue(new EmailDeliveryError("x"));
    await expect(requestVerificationCode("ana@example.com", prisma, t0)).rejects.toBeInstanceOf(
      EmailDeliveryError,
    );
  });

  it("verifica el código correcto una sola vez", async () => {
    await requestVerificationCode("ana@example.com", prisma, t0);
    const code = lastCode();
    expect(await confirmVerificationCode("ANA@example.com", code, prisma, at(1000))).toEqual({
      status: "verified",
      email: "ana@example.com",
    });
    expect(await confirmVerificationCode("ana@example.com", code, prisma, at(2000))).toEqual({
      status: "expired",
    });
    const otp = await prisma.oTPVerification.findFirstOrThrow();
    expect(otp.verifiedAt).not.toBeNull();
  });

  it("rechaza un código incorrecto e indica los intentos restantes; a los 5 se bloquea", async () => {
    await requestVerificationCode("ana@example.com", prisma, t0);
    const code = lastCode();
    const wrong = code === "000000" ? "000001" : "000000";
    for (const remaining of [4, 3, 2, 1]) {
      expect(await confirmVerificationCode("ana@example.com", wrong, prisma, t0)).toEqual({
        status: "invalid",
        remainingAttempts: remaining,
      });
    }
    expect(await confirmVerificationCode("ana@example.com", wrong, prisma, t0)).toEqual({
      status: "too_many_attempts",
    });
    // Ni siquiera el código correcto funciona después de 5 intentos.
    expect(await confirmVerificationCode("ana@example.com", code, prisma, t0)).toEqual({
      status: "too_many_attempts",
    });
  });

  it("intentos simultáneos no superan el máximo", async () => {
    await requestVerificationCode("ana@example.com", prisma, t0);
    const wrong = lastCode() === "000000" ? "000001" : "000000";
    await Promise.all(
      Array.from({ length: 12 }, () =>
        confirmVerificationCode("ana@example.com", wrong, prisma, t0),
      ),
    );
    const otp = await prisma.oTPVerification.findFirstOrThrow();
    expect(otp.attempts).toBe(5);
  });

  it("rechaza un código expirado", async () => {
    await requestVerificationCode("ana@example.com", prisma, t0);
    expect(
      await confirmVerificationCode("ana@example.com", lastCode(), prisma, at(OTP_TTL_MS)),
    ).toEqual({ status: "expired" });
  });

  it("al reenviar, solo vale el código más reciente", async () => {
    await requestVerificationCode("ana@example.com", prisma, t0);
    const first = lastCode();
    await requestVerificationCode("ana@example.com", prisma, at(61_000));
    const second = lastCode();
    if (first !== second) {
      expect(
        (await confirmVerificationCode("ana@example.com", first, prisma, at(62_000))).status,
      ).toBe("invalid");
    }
    expect(
      (await confirmVerificationCode("ana@example.com", second, prisma, at(63_000))).status,
    ).toBe("verified");
  });

  it("un código no sirve para otro correo", async () => {
    await requestVerificationCode("ana@example.com", prisma, t0);
    expect(await confirmVerificationCode("otra@example.com", lastCode(), prisma, t0)).toEqual({
      status: "expired",
    });
  });
});
