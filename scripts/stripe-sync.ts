/**
 * `npm run stripe:sync` — crea o actualiza en Stripe el Product y los Prices de cada programa y
 * guarda sus IDs en la BD (DECISIONS A26). Idempotente: se puede correr las veces que haga falta.
 *
 * Usa `STRIPE_SECRET_KEY` y `DATABASE_URL` de `.env.local` (o del entorno). Córrelo después de
 * `npm run db:seed` y cada vez que cambie un precio del catálogo. Cada entorno (test y live) tiene
 * sus propios Prices, así que se corre una vez por entorno.
 *
 * Con una clave live (`sk_live_…`) exige `--live`, para no tocar producción por error:
 *   npm run stripe:sync -- --live
 */
import { loadEnvConfig } from "@next/env";
import Stripe from "stripe";

import { createPrismaClient } from "@/lib/prisma";
import { isLiveKey } from "@/lib/stripe";
import { syncStripeCatalog } from "@/services/stripe-catalog.service";

async function main() {
  loadEnvConfig(process.cwd());
  const key = process.env.STRIPE_SECRET_KEY;
  const url = process.env.DATABASE_URL;
  if (!key) throw new Error("STRIPE_SECRET_KEY no está definida.");
  if (!url) throw new Error("DATABASE_URL no está definida.");
  if (isLiveKey(key) && !process.argv.includes("--live")) {
    throw new Error(
      "STRIPE_SECRET_KEY es de modo live. Si de verdad quieres configurar producción, usa: npm run stripe:sync -- --live",
    );
  }

  const stripe = new Stripe(key, { maxNetworkRetries: 2 });
  const prisma = createPrismaClient(url);
  try {
    const report = await syncStripeCatalog(stripe, prisma);
    if (report.length === 0) {
      console.log('No hay programas en la BD. Corre primero "npm run db:seed".');
      return;
    }
    console.log(`Stripe (${isLiveKey(key) ? "LIVE" : "modo de prueba"}):`);
    for (const program of report) {
      const prices = program.prices
        .map((p) => `${p.kind} ${p.id}${p.action === "created" ? " (nuevo)" : ""}`)
        .join(" · ");
      console.log(`✔ ${program.slug.padEnd(12)} producto ${program.productAction} · ${prices}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
