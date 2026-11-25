import { describe, expect, it } from "vitest";

import { Prisma } from "@/generated/prisma/client";

import { fromMinorUnits, isLiveKey, normalizeCurrency, toMinorUnits } from "./stripe";

describe("importes de Stripe (Decimal, nunca float)", () => {
  it("convierte a centavos de forma exacta", () => {
    expect(toMinorUnits(new Prisma.Decimal("1200.00"))).toBe(120000);
    expect(toMinorUnits("1080.00")).toBe(108000);
    // 0.1 + 0.2 en float no es 0.3; con Decimal sí.
    expect(toMinorUnits(new Prisma.Decimal("0.1").add("0.2"))).toBe(30);
    expect(toMinorUnits("1999.99")).toBe(199999);
  });

  it("rechaza importes con más de dos decimales", () => {
    expect(() => toMinorUnits("10.005")).toThrow();
  });

  it("convierte de centavos a Decimal con dos decimales", () => {
    expect(fromMinorUnits(120000).toFixed(2)).toBe("1200.00");
    expect(fromMinorUnits(199999).equals(new Prisma.Decimal("1999.99"))).toBe(true);
    expect(() => fromMinorUnits(1.5)).toThrow();
  });

  it("normaliza la moneda y reconoce las claves live", () => {
    expect(normalizeCurrency("mxn")).toBe("MXN");
    expect(isLiveKey("sk_live_123")).toBe(true);
    expect(isLiveKey("rk_live_123")).toBe(true);
    expect(isLiveKey("sk_test_123")).toBe(false);
  });
});
