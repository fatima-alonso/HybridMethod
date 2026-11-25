import { PROGRAMS, isProgramSlug, type Program as CatalogProgram } from "@/content/programs";
import type { Program } from "@/generated/prisma/client";
import { getPrisma, isDatabaseConfigured, type Db } from "@/lib/prisma";
import type { LandingProgram } from "@/types/program";

/**
 * Programas (RF-02, SDD §5.3, DECISIONS A14).
 *
 * La BD es la fuente de los datos comerciales (precio, moneda, disponibilidad, Price IDs de
 * Stripe). El catálogo `src/content/programs.ts` los alimenta mediante el seed y aporta los textos
 * editoriales de la landing.
 */

export async function listActivePrograms(db: Db = getPrisma()): Promise<Program[]> {
  return db.program.findMany({
    where: { active: true },
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
  });
}

/** Programa activo por slug, o `null` si no existe o está inactivo. */
export async function findActiveProgram(
  slug: string,
  db: Db = getPrisma(),
): Promise<Program | null> {
  const program = await db.program.findUnique({ where: { slug } });
  return program?.active ? program : null;
}

/** Combina un programa de la BD con sus textos editoriales. `null` si el slug no está en el catálogo. */
export function toLandingProgram(program: Program): LandingProgram | null {
  if (!isProgramSlug(program.slug)) return null;
  const editorial = PROGRAMS.find((p) => p.slug === program.slug);
  if (!editorial) return null;
  return {
    slug: program.slug,
    name: program.name,
    description: program.description,
    monthlyPrice: program.monthlyPrice.toFixed(2) as `${number}`,
    subscriptionPrice: program.subscriptionPrice.toFixed(2) as `${number}`,
    currency: program.currency,
    summary: editorial.summary,
    highlights: editorial.highlights,
    featured: editorial.featured,
  };
}

function catalogToLanding(program: CatalogProgram): LandingProgram {
  return {
    slug: program.slug,
    name: program.name,
    description: program.description,
    monthlyPrice: program.monthlyPrice,
    subscriptionPrice: program.subscriptionPrice,
    currency: program.currency,
    summary: program.summary,
    highlights: program.highlights,
    featured: program.featured,
  };
}

/**
 * Programas activos para la landing.
 *
 * Si no hay `DATABASE_URL` (desarrollo sin BD, pruebas o `next build` en la CI) se usa el
 * catálogo directamente; en producción el servidor no arranca sin `DATABASE_URL` (DECISIONS A9),
 * así que ahí siempre se lee la BD. Si la BD está configurada pero falla, el error se propaga:
 * es preferible fallar a mostrar precios que podrían no coincidir con los que se cobran.
 */
export async function getLandingPrograms(db?: Db): Promise<LandingProgram[]> {
  if (!db && !isDatabaseConfigured()) {
    return PROGRAMS.filter((p) => p.active).map(catalogToLanding);
  }
  const programs = await listActivePrograms(db);
  return programs.map(toLandingProgram).filter((p): p is LandingProgram => p !== null);
}

/**
 * Copia el catálogo a la tabla `programs` (seed, idempotente). Crea los que faltan y actualiza
 * nombre, descripción, precio, moneda, disponibilidad y orden. No toca los Price IDs de Stripe,
 * que se configuran por entorno (Fases 5 y 6).
 */
export async function syncProgramCatalog(
  db: Db = getPrisma(),
  catalog: readonly CatalogProgram[] = PROGRAMS,
): Promise<Program[]> {
  const result: Program[] = [];
  for (const [index, program] of catalog.entries()) {
    const data = {
      name: program.name,
      description: program.description,
      monthlyPrice: program.monthlyPrice,
      subscriptionPrice: program.subscriptionPrice,
      currency: program.currency,
      active: program.active,
      displayOrder: index + 1,
    };
    result.push(
      await db.program.upsert({
        where: { slug: program.slug },
        create: { slug: program.slug, ...data },
        update: data,
      }),
    );
  }
  return result;
}
