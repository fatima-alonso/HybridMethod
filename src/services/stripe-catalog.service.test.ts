import { describe, expect, it, vi } from "vitest";

import { Prisma, type Program } from "@/generated/prisma/client";
import { FakeStripe } from "@/test/fake-stripe";

import { PaymentsUnavailableError } from "./errors";
import {
  expectedPriceAmount,
  priceLookupKey,
  priceMismatches,
  verifyProgramPrice,
} from "./stripe-catalog.service";

function program(overrides: Partial<Program> = {}): Program {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    slug: "hm-run",
    name: "HM RUN",
    description: "Running",
    monthlyPrice: new Prisma.Decimal("1200.00"),
    subscriptionPrice: new Prisma.Decimal("1080.00"),
    currency: "MXN",
    stripePriceIdOneTime: null,
    stripePriceIdRecurring: null,
    active: true,
    displayOrder: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("Prices de Stripe del catálogo (DECISIONS A26)", () => {
  it("usa una lookup_key por programa y modalidad, y el importe de la BD", () => {
    expect(priceLookupKey("hm-run", "one_time")).toBe("hm-run_one_time");
    expect(expectedPriceAmount(program(), "one_time")).toBe(120000);
    expect(expectedPriceAmount(program(), "recurring")).toBe(108000);
  });

  it("detecta un Price que no coincide con la BD", () => {
    const base = {
      active: true,
      type: "one_time" as const,
      currency: "mxn",
      unit_amount: 120000,
      recurring: null,
      product: "hm-run",
    };
    expect(priceMismatches(base, program(), "one_time")).toEqual([]);
    expect(priceMismatches({ ...base, unit_amount: 100000 }, program(), "one_time")).toHaveLength(
      1,
    );
    expect(priceMismatches({ ...base, currency: "usd" }, program(), "one_time")).toHaveLength(1);
    expect(priceMismatches({ ...base, active: false }, program(), "one_time")).toHaveLength(1);
    expect(
      priceMismatches({ ...base, product: "hm-strength" }, program(), "one_time"),
    ).toHaveLength(1);
    // Un Price one_time no sirve como recurrente (tipo, importe y periodicidad).
    expect(priceMismatches(base, program(), "recurring")).toHaveLength(3);
  });

  it("verifyProgramPrice: acepta el Price correcto y rechaza uno distinto, inexistente o ausente", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fake = new FakeStripe();
    const good = fake.addPrice({ product: "hm-run", unit_amount: 120000 });
    const wrong = fake.addPrice({ product: "hm-run", unit_amount: 99900 });
    const stripe = fake.asStripe();

    await expect(
      verifyProgramPrice(stripe, program({ stripePriceIdOneTime: good.id }), "one_time"),
    ).resolves.toBe(good.id);

    const reasons = async (p: Program) =>
      verifyProgramPrice(stripe, p, "one_time").catch(
        (error: PaymentsUnavailableError) => error.reason,
      );
    expect(await reasons(program({ stripePriceIdOneTime: wrong.id }))).toBe("price_mismatch");
    expect(await reasons(program({ stripePriceIdOneTime: "price_missing" }))).toBe("stripe_error");
    expect(await reasons(program())).toBe("price_missing");
  });
});
