import { describe, expect, it } from "vitest";

import { businessYear, formatContractReference, isContractReference } from "./reference";

describe("referencias de contrato HM-AAAA-NNNNNN", () => {
  it("rellena el consecutivo con ceros hasta 6 dígitos", () => {
    expect(formatContractReference(2026, 1)).toBe("HM-2026-000001");
    expect(formatContractReference(2026, 123456)).toBe("HM-2026-123456");
    expect(formatContractReference(2027, BigInt(42))).toBe("HM-2027-000042");
  });

  it("usa más dígitos al pasar de 999999 en lugar de repetir números", () => {
    expect(formatContractReference(2026, 1_000_000)).toBe("HM-2026-1000000");
    expect(isContractReference("HM-2026-1000000")).toBe(true);
  });

  it("rechaza consecutivos y años inválidos", () => {
    expect(() => formatContractReference(2026, 0)).toThrow(RangeError);
    expect(() => formatContractReference(2026, -1)).toThrow(RangeError);
    expect(() => formatContractReference(26, 1)).toThrow(RangeError);
  });

  it("valida el formato", () => {
    expect(isContractReference("HM-2026-000001")).toBe(true);
    expect(isContractReference("HM-2026-00001")).toBe(false);
    expect(isContractReference("hm-2026-000001")).toBe(false);
    expect(isContractReference("HM-26-000001")).toBe(false);
  });

  it("toma el año en la hora de Ciudad de México, no en UTC", () => {
    // 1 de enero 03:00 UTC = 31 de diciembre 21:00 en CDMX.
    expect(businessYear(new Date("2027-01-01T03:00:00Z"))).toBe(2026);
    expect(businessYear(new Date("2027-01-01T07:00:00Z"))).toBe(2027);
  });
});
