/**
 * Seed: copia el catálogo de `src/content/programs.ts` a la tabla `programs` (DECISIONS A14).
 * Idempotente: se puede ejecutar en cada despliegue. Uso: `npm run db:seed`.
 */
import { createPrismaClient } from "@/lib/prisma";
import { syncProgramCatalog } from "@/services/program.service";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL no está definida.");
  const prisma = createPrismaClient(url);
  try {
    const programs = await syncProgramCatalog(prisma);
    for (const p of programs) {
      console.log(
        `✔ ${p.slug.padEnd(12)} ${p.monthlyPrice.toFixed(2)} · suscripción ${p.subscriptionPrice.toFixed(2)} ${p.currency}${p.active ? "" : " (inactivo)"}`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
