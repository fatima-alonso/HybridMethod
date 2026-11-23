import { describe, expect, it } from "vitest";

import { PROGRAMS, PROGRAM_SLUGS, getProgram, isProgramSlug } from "./programs";

describe("catálogo de programas (SRS §5)", () => {
  it("tiene exactamente los tres programas del SRS, con slugs únicos", () => {
    expect(PROGRAMS.map((p) => p.slug)).toEqual([...PROGRAM_SLUGS]);
    expect(new Set(PROGRAMS.map((p) => p.slug)).size).toBe(3);
    expect(PROGRAMS.map((p) => p.name)).toEqual(["HM RUN", "HM STRENGTH", "HM COMPLETE"]);
  });

  it("usa los precios del SRS como decimales en texto, en MXN", () => {
    expect(Object.fromEntries(PROGRAMS.map((p) => [p.slug, p.monthlyPrice]))).toEqual({
      "hm-run": "1200.00",
      "hm-strength": "1500.00",
      "hm-complete": "1800.00",
    });
    for (const program of PROGRAMS) {
      expect(typeof program.monthlyPrice).toBe("string");
      expect(program.monthlyPrice).toMatch(/^\d+\.\d{2}$/);
      expect(program.currency).toBe("MXN");
    }
  });

  it("isProgramSlug solo acepta slugs del catálogo", () => {
    expect(isProgramSlug("hm-run")).toBe(true);
    expect(isProgramSlug("HM-RUN")).toBe(false);
    expect(isProgramSlug("hm-yoga")).toBe(false);
    expect(isProgramSlug(null)).toBe(false);
  });

  it("getProgram devuelve el programa por slug", () => {
    expect(getProgram("hm-complete").name).toBe("HM COMPLETE");
  });
});
