import { describe, expect, it } from "vitest";

import { formatPrice } from "./format";

describe("formatPrice", () => {
  it("formatea pesos mexicanos sin decimales cuando son .00", () => {
    expect(formatPrice("1200.00", "MXN")).toBe("$1,200 MXN");
    expect(formatPrice("1800", "MXN")).toBe("$1,800 MXN");
  });

  it("conserva los centavos exactos sin errores de coma flotante", () => {
    expect(formatPrice("1499.90", "MXN")).toBe("$1,499.9 MXN");
    expect(formatPrice("0.30", "MXN")).toBe("$0.3 MXN");
  });
});
