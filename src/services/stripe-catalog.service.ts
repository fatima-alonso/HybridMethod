import type Stripe from "stripe";

import type { Program } from "@/generated/prisma/client";
import { normalizeCurrency, toMinorUnits } from "@/lib/stripe";
import type { Db } from "@/lib/prisma";

import { PaymentsUnavailableError } from "./errors";

/**
 * Productos y Prices de Stripe de cada programa (SDD §5.3 Program, §6.1, DECISIONS A18, A26).
 *
 * Cada programa tiene en Stripe un Product (con el mismo id que el slug, p. ej. `hm-run`) y dos
 * Prices, identificados por su `lookup_key`:
 * - `<slug>_one_time`: pago único por `monthlyPrice`.
 * - `<slug>_recurring`: mensual por `subscriptionPrice` (Fase 6).
 *
 * `syncStripeCatalog` (script `npm run stripe:sync`) los crea o actualiza y guarda sus IDs en la
 * BD. `verifyProgramPrice` comprueba, antes de cada Checkout, que el Price de Stripe siga valiendo
 * lo mismo que la BD.
 */

export type PriceKind = "one_time" | "recurring";

export const PRICE_KINDS: readonly PriceKind[] = ["one_time", "recurring"];

export function priceLookupKey(slug: string, kind: PriceKind): string {
  return `${slug}_${kind}`;
}

/** Importe que debe tener cada Price según la BD. */
export function expectedPriceAmount(
  program: Pick<Program, "monthlyPrice" | "subscriptionPrice">,
  kind: PriceKind,
): number {
  return toMinorUnits(kind === "one_time" ? program.monthlyPrice : program.subscriptionPrice);
}

/** Motivos por los que un Price de Stripe no coincide con el programa (vacío si coincide). */
export function priceMismatches(
  price: Pick<Stripe.Price, "active" | "type" | "currency" | "unit_amount" | "recurring"> & {
    product: string | { id: string };
  },
  program: Pick<Program, "slug" | "monthlyPrice" | "subscriptionPrice" | "currency">,
  kind: PriceKind,
): string[] {
  const problems: string[] = [];
  if (!price.active) problems.push("inactivo");
  if (price.type !== kind) problems.push(`tipo ${price.type}`);
  if (normalizeCurrency(price.currency) !== program.currency) {
    problems.push(`moneda ${normalizeCurrency(price.currency)}`);
  }
  const expected = expectedPriceAmount(program, kind);
  if (price.unit_amount !== expected) {
    problems.push(`importe ${price.unit_amount ?? "variable"} en lugar de ${expected}`);
  }
  if (kind === "recurring") {
    const recurring = price.recurring;
    if (!recurring || recurring.interval !== "month" || recurring.interval_count !== 1) {
      problems.push("no es mensual");
    }
  }
  const productId = typeof price.product === "string" ? price.product : price.product.id;
  if (productId !== program.slug) problems.push(`producto ${productId}`);
  return problems;
}

/**
 * Comprueba que el Price del programa exista en Stripe y valga lo mismo que la BD (SDD §6.1, §10).
 * Si no, lanza `PaymentsUnavailableError` (el Checkout no se crea y el cliente puede pagar por
 * transferencia). Devuelve el ID del Price.
 */
export async function verifyProgramPrice(
  stripe: Pick<Stripe, "prices">,
  program: Program,
  kind: PriceKind,
): Promise<string> {
  const priceId =
    kind === "one_time" ? program.stripePriceIdOneTime : program.stripePriceIdRecurring;
  if (!priceId) {
    console.error(
      `[stripe] ${program.slug} no tiene Price ${kind}: ejecuta "npm run stripe:sync".`,
    );
    throw new PaymentsUnavailableError("price_missing", program.slug);
  }
  let price: Stripe.Price;
  try {
    price = await stripe.prices.retrieve(priceId);
  } catch (error) {
    console.error(
      `[stripe] No se pudo leer el Price de ${program.slug}:`,
      error instanceof Error ? error.name : "error desconocido",
    );
    throw new PaymentsUnavailableError("stripe_error", program.slug);
  }
  const problems = priceMismatches(price, program, kind);
  if (problems.length > 0) {
    console.error(
      `[stripe] El Price ${kind} de ${program.slug} no coincide con la BD (${problems.join(", ")}). ` +
        'Ejecuta "npm run stripe:sync".',
    );
    throw new PaymentsUnavailableError("price_mismatch", program.slug);
  }
  return priceId;
}

// ─── Sincronización (npm run stripe:sync) ───────────────────────────────────

export type SyncedPrice = { kind: PriceKind; id: string; action: "kept" | "created" };
export type SyncedProgram = {
  slug: string;
  productAction: "kept" | "created" | "updated";
  prices: SyncedPrice[];
};

function isMissingResource(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "resource_missing"
  );
}

async function ensureProduct(
  stripe: Pick<Stripe, "products">,
  program: Program,
): Promise<SyncedProgram["productAction"]> {
  const data = { name: program.name, description: program.description };
  let product: Stripe.Product;
  try {
    product = await stripe.products.retrieve(program.slug);
  } catch (error) {
    if (!isMissingResource(error)) throw error;
    await stripe.products.create({
      id: program.slug,
      ...data,
      metadata: { programSlug: program.slug },
    });
    return "created";
  }
  if (product.name !== data.name || product.description !== data.description || !product.active) {
    await stripe.products.update(program.slug, { ...data, active: true });
    return "updated";
  }
  return "kept";
}

async function ensurePrice(
  stripe: Pick<Stripe, "prices">,
  program: Program,
  kind: PriceKind,
): Promise<SyncedPrice> {
  const lookupKey = priceLookupKey(program.slug, kind);
  const existing = await stripe.prices.list({ lookup_keys: [lookupKey], limit: 1 });
  const current = existing.data[0];
  if (current && priceMismatches(current, program, kind).length === 0) {
    return { kind, id: current.id, action: "kept" };
  }
  const created = await stripe.prices.create({
    product: program.slug,
    currency: program.currency.toLowerCase(),
    unit_amount: expectedPriceAmount(program, kind),
    lookup_key: lookupKey,
    // El lookup_key pasa al Price nuevo: el anterior queda sin él.
    transfer_lookup_key: true,
    ...(kind === "recurring" ? { recurring: { interval: "month", interval_count: 1 } } : {}),
    tax_behavior: "inclusive",
    metadata: { programSlug: program.slug, kind },
  });
  if (current?.active) {
    // Los Prices no se pueden editar ni borrar: el anterior se archiva.
    await stripe.prices.update(current.id, { active: false });
  }
  return { kind, id: created.id, action: "created" };
}

/**
 * Crea o actualiza en Stripe el Product y los dos Prices de cada programa de la BD y guarda los
 * IDs en `programs`. Idempotente: si ya coinciden, no crea nada. Si un precio cambió (se editó el
 * catálogo y se corrió el seed), crea un Price nuevo y archiva el anterior.
 */
export async function syncStripeCatalog(
  stripe: Pick<Stripe, "products" | "prices">,
  db: Db,
): Promise<SyncedProgram[]> {
  const programs = await db.program.findMany({ orderBy: { displayOrder: "asc" } });
  const report: SyncedProgram[] = [];
  for (const program of programs) {
    const productAction = await ensureProduct(stripe, program);
    const prices: SyncedPrice[] = [];
    for (const kind of PRICE_KINDS) prices.push(await ensurePrice(stripe, program, kind));
    await db.program.update({
      where: { id: program.id },
      data: {
        stripePriceIdOneTime: prices.find((p) => p.kind === "one_time")!.id,
        stripePriceIdRecurring: prices.find((p) => p.kind === "recurring")!.id,
      },
    });
    report.push({ slug: program.slug, productAction, prices });
  }
  return report;
}
