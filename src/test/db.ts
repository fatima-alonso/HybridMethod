import type { PrismaClient } from "@/generated/prisma/client";
import { createPrismaClient } from "@/lib/prisma";

/** URL de la BD de pruebas, o `undefined` si las pruebas de BD están desactivadas. */
export const testDatabaseUrl = process.env.TEST_DATABASE_URL || undefined;

export function createTestPrisma(): PrismaClient {
  if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL no está definida.");
  return createPrismaClient(testDatabaseUrl);
}

/** Vacía todas las tablas (la secuencia de referencias no se reinicia: no hace falta). */
export async function truncateAll(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE "audit_logs", "webhook_events", "otp_verifications", "transfer_approvals",
      "plan_delivery_links", "service_periods", "payments", "subscriptions", "contracts", "programs", "customers",
      "rate_limit_buckets" RESTART IDENTITY CASCADE`,
  );
}
