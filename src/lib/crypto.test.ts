import { describe, expect, it } from "vitest";

import {
  deriveKey,
  generateOtpCode,
  generateToken,
  hashOtpCode,
  hashToken,
  safeEqual,
  sha256Hex,
} from "./crypto";

describe("crypto", () => {
  it("genera códigos OTP de 6 dígitos", () => {
    for (let i = 0; i < 200; i++) expect(generateOtpCode()).toMatch(/^\d{6}$/);
  });

  it("genera tokens de 32 bytes en base64url, distintos entre sí", () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generateToken()));
    expect(tokens.size).toBe(100);
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("el hash de un token es SHA-256 en hex y no contiene el token", () => {
    const token = generateToken();
    expect(hashToken(token)).toBe(sha256Hex(token));
    expect(hashToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashToken(token)).not.toContain(token);
  });

  it("el hash del OTP depende del correo y del código, y no es un SHA-256 simple", () => {
    const hash = hashOtpCode("ana@example.com", "123456");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).toBe(hashOtpCode("ana@example.com", "123456"));
    expect(hash).not.toBe(hashOtpCode("ana@example.com", "123457"));
    expect(hash).not.toBe(hashOtpCode("otra@example.com", "123456"));
    expect(hash).not.toBe(sha256Hex("123456"));
  });

  it("deriva claves distintas por uso y por secreto", () => {
    const secret = "x".repeat(32);
    expect(deriveKey("otp-code", secret).equals(deriveKey("rate-limit", secret))).toBe(false);
    expect(deriveKey("otp-code", secret).equals(deriveKey("otp-code", "y".repeat(32)))).toBe(false);
  });

  it("compara cadenas", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});
