import { describe, expect, it } from "vitest";

import {
  ApprovalPinNotConfiguredError,
  hashApprovalPin,
  verifyApprovalPin,
  weakPinReason,
} from "./approval-pin";
import { parseConfig } from "./config";

describe("PIN de aprobación (DECISIONS A7)", () => {
  it("genera un hash bcrypt que acepta la configuración y verifica el PIN", async () => {
    const hash = await hashApprovalPin("482917", 4);
    expect(hash).toMatch(/^\$2b\$04\$/);
    expect(hash).not.toContain("482917");
    expect(() => parseConfig({ FERRO_APPROVAL_PIN_HASH: hash })).not.toThrow();
    await expect(verifyApprovalPin("482917", hash)).resolves.toBe(true);
    await expect(verifyApprovalPin("482918", hash)).resolves.toBe(false);
  });

  it("rechaza sin comparar un PIN con otro formato", async () => {
    const hash = await hashApprovalPin("482917", 4);
    await expect(verifyApprovalPin(" 482917", hash)).resolves.toBe(false);
    await expect(verifyApprovalPin("", hash)).resolves.toBe(false);
  });

  it("sin FERRO_APPROVAL_PIN_HASH no existe un PIN por defecto", async () => {
    await expect(verifyApprovalPin("482917", undefined)).rejects.toBeInstanceOf(
      ApprovalPinNotConfiguredError,
    );
  });

  it.each([
    ["12345", /de 6 a 12 dígitos/],
    ["1234567890123", /de 6 a 12 dígitos/],
    ["12a456", /de 6 a 12 dígitos/],
    ["000000", /repetido/],
    ["123456", /secuencia/],
    ["987654", /secuencia/],
    ["890123", /secuencia/],
  ])("no acepta %s como PIN nuevo", (pin, reason) => {
    expect(weakPinReason(pin)).toMatch(reason);
  });

  it.each(["482917", "20261124", "135792468024"])("acepta %s como PIN nuevo", (pin) => {
    expect(weakPinReason(pin)).toBeNull();
  });
});
