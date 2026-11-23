import { describe, expect, it } from "vitest";

import { getPhoneCountryOptions, isE164, isPhoneCountry, toE164 } from "./phone";

describe("phone (DECISIONS B13)", () => {
  it("lista todos los países con México primero, lada al inicio y nombres en español", () => {
    const options = getPhoneCountryOptions();
    expect(options.length).toBeGreaterThan(200);
    expect(options[0]).toEqual({ code: "MX", label: "+52 México" });
    expect(options).toContainEqual({ code: "US", label: "+1 Estados Unidos" });
    expect(options).toContainEqual({ code: "ES", label: "+34 España" });
    expect(new Set(options.map((o) => o.code)).size).toBe(options.length);
    // Después de México, orden alfabético por nombre.
    const names = options.slice(1).map((o) => o.label.replace(/^\+\d+ /, ""));
    expect(names).toEqual([...names].sort(new Intl.Collator("es").compare));
  });

  it("convierte a E.164 con las reglas del país", () => {
    expect(toE164("55 1234 5678", "MX")).toBe("+525512345678");
    expect(toE164("55 1234 5678", "ES")).toBeNull();
    // Los mismos 10 dígitos son un número distinto en cada país: por eso se elige el país.
    expect(toE164("415 555 2671", "US")).toBe("+14155552671");
    expect(toE164("415 555 2671", "MX")).toBe("+524155552671");
  });

  it("isE164 solo acepta números válidos ya normalizados", () => {
    expect(isE164("+525512345678")).toBe(true);
    expect(isE164("+14155552671")).toBe(true);
    expect(isE164("525512345678")).toBe(false);
    expect(isE164("+52 55 1234 5678")).toBe(false);
    expect(isE164("+52123")).toBe(false);
  });

  it("isPhoneCountry valida el código de país", () => {
    expect(isPhoneCountry("MX")).toBe(true);
    expect(isPhoneCountry("mx")).toBe(false);
    expect(isPhoneCountry("XX")).toBe(false);
    expect(isPhoneCountry(52)).toBe(false);
  });
});
