import { describe, expect, it, vi } from "vitest";

import { PROGRAMS } from "@/content/programs";
import { Prisma, type Program } from "@/generated/prisma/client";

import { getLandingPrograms, toLandingProgram } from "./program.service";

function dbProgram(overrides: Partial<Program> = {}): Program {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    slug: "hm-run",
    name: "HM RUN",
    description: "Descripción desde la BD",
    monthlyPrice: new Prisma.Decimal("1250.5"),
    subscriptionPrice: new Prisma.Decimal("1125.45"),
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

describe("programas para la landing (DECISIONS A14)", () => {
  it("toma precio, nombre y descripción de la BD y los textos editoriales del catálogo", () => {
    const landing = toLandingProgram(dbProgram());
    const editorial = PROGRAMS.find((p) => p.slug === "hm-run")!;
    expect(landing).toEqual({
      slug: "hm-run",
      name: "HM RUN",
      description: "Descripción desde la BD",
      monthlyPrice: "1250.50",
      subscriptionPrice: "1125.45",
      currency: "MXN",
      summary: editorial.summary,
      highlights: editorial.highlights,
      featured: editorial.featured,
    });
  });

  it("descarta programas de la BD que no están en el catálogo", () => {
    expect(toLandingProgram(dbProgram({ slug: "hm-yoga" }))).toBeNull();
  });

  it("sin DATABASE_URL usa el catálogo (desarrollo, pruebas y build de la CI)", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const programs = await getLandingPrograms();
    expect(programs.map((p) => [p.slug, p.monthlyPrice])).toEqual(
      PROGRAMS.filter((p) => p.active).map((p) => [p.slug, p.monthlyPrice]),
    );
  });
});
