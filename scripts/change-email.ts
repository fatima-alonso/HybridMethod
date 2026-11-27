/**
 * `npm run customer:change-email -- <correo-actual> <correo-nuevo>` — cambia el correo de un cliente
 * en la BD y en Stripe, y lo deja en la auditoría (DECISIONS A35). Lo corre quien mantiene el
 * sistema cuando Ferro lo pide; no hay panel ni ruta pública para esto.
 *
 * Antes de correrlo, confirma con el cliente (p. ej. Ferro por WhatsApp) que el correo nuevo es suyo:
 * después, ese correo es su identidad para inscribirse y para "Administrar mi suscripción".
 *
 * Primero muestra lo que va a cambiar sin tocar nada. Para aplicarlo, agrega `--confirmar`:
 *   npm run customer:change-email -- ana@viejo.com ana@nuevo.com
 *   npm run customer:change-email -- ana@viejo.com ana@nuevo.com --confirmar
 *
 * Usa `DATABASE_URL` y `STRIPE_SECRET_KEY` de `.env.local` (o del entorno). Con una clave live
 * (`sk_live_…`) exige también `--live`, para no tocar producción por error.
 */
import { loadEnvConfig } from "@next/env";
import Stripe from "stripe";

import { createPrismaClient } from "@/lib/prisma";
import { isLiveKey } from "@/lib/stripe";
import { normalizeEmail } from "@/lib/validations";
import { changeCustomerEmail } from "@/services/customer.service";

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith("--")));
  const [from, to] = args.filter((a) => !a.startsWith("--"));
  if (!from || !to) {
    throw new Error(
      "Uso: npm run customer:change-email -- <correo-actual> <correo-nuevo> [--confirmar] [--live]",
    );
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL no está definida.");
  const key = process.env.STRIPE_SECRET_KEY;
  if (key && isLiveKey(key) && !flags.has("--live")) {
    throw new Error(
      "STRIPE_SECRET_KEY es de modo live. Si de verdad es producción, agrega --live.",
    );
  }

  const prisma = createPrismaClient(url);
  try {
    const customer = await prisma.customer.findUnique({
      where: { email: normalizeEmail(from) },
      select: {
        fullName: true,
        stripeCustomerId: true,
        _count: { select: { contracts: true } },
      },
    });
    if (!customer) throw new Error(`No hay ningún cliente con el correo ${from}.`);
    console.log(`Cliente: ${customer.fullName} (${customer._count.contracts} contrato(s))`);
    console.log(`Correo:  ${normalizeEmail(from)} → ${normalizeEmail(to)}`);
    console.log(
      customer.stripeCustomerId
        ? `Stripe:  también se cambia en ${customer.stripeCustomerId}${key && isLiveKey(key) ? " (LIVE)" : ""}`
        : "Stripe:  el cliente no tiene cliente de Stripe; solo cambia la BD",
    );
    if (!flags.has("--confirmar")) {
      console.log("\nNo se cambió nada. Para aplicarlo, repite el comando con --confirmar.");
      return;
    }

    const stripe = key ? new Stripe(key, { maxNetworkRetries: 2 }) : null;
    const result = await changeCustomerEmail({ from, to }, stripe, prisma);
    console.log(`\n✔ Correo cambiado a ${result.to}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
