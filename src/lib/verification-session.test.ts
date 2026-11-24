import { describe, expect, it } from "vitest";

import { deriveKey } from "./crypto";
import {
  createVerificationSessionToken,
  readVerificationSessionToken,
  VERIFICATION_SESSION_TTL_MS,
  verificationCookieName,
  verificationCookieOptions,
} from "./verification-session";

const key = deriveKey("verification-session", "s".repeat(40));
const now = new Date("2026-11-24T10:00:00Z");

describe("sesión de verificación (SDD §7.1, §9.4)", () => {
  it("firma y lee el correo verificado", () => {
    const { token, session } = createVerificationSessionToken("ana@example.com", now, key);
    expect(token.startsWith("v1.")).toBe(true);
    expect(readVerificationSessionToken(token, now, key)).toEqual(session);
    expect(session.expiresAt - session.issuedAt).toBe(VERIFICATION_SESSION_TTL_MS);
  });

  it("dura 30 minutos", () => {
    const { token } = createVerificationSessionToken("ana@example.com", now, key);
    const almost = new Date(now.getTime() + 30 * 60 * 1000 - 1);
    const expired = new Date(now.getTime() + 30 * 60 * 1000);
    expect(readVerificationSessionToken(token, almost, key)).not.toBeNull();
    expect(readVerificationSessionToken(token, expired, key)).toBeNull();
  });

  it("rechaza una sesión alterada (otro correo o más tiempo)", () => {
    const { token } = createVerificationSessionToken("ana@example.com", now, key);
    const [version, , signature] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ e: "otra@example.com", i: now.getTime(), x: now.getTime() + 1e9 }),
    ).toString("base64url");
    expect(readVerificationSessionToken(`${version}.${forged}.${signature}`, now, key)).toBeNull();
  });

  it("rechaza una sesión firmada con otro secreto", () => {
    const other = deriveKey("verification-session", "t".repeat(40));
    const { token } = createVerificationSessionToken("ana@example.com", now, other);
    expect(readVerificationSessionToken(token, now, key)).toBeNull();
  });

  it.each([undefined, "", "basura", "v1.a.b", "v2.a.b", "v1..", "x".repeat(2000)])(
    "rechaza tokens mal formados: %s",
    (token) => {
      expect(readVerificationSessionToken(token, now, key)).toBeNull();
    },
  );

  it("cookie httpOnly, SameSite=Lax, Secure y con prefijo __Host- en producción", () => {
    expect(verificationCookieName(true)).toBe("__Host-hm_verification");
    expect(verificationCookieOptions(true)).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 1800,
    });
    expect(verificationCookieName(false)).toBe("hm_verification");
    expect(verificationCookieOptions(false).secure).toBe(false);
  });
});
