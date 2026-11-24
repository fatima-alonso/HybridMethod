import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient, type Prisma } from "@/generated/prisma/client";
import { getDatabaseUrl } from "@/lib/config";

/**
 * Acceso a PostgreSQL (SDD §6.3). Solo para código de servidor.
 *
 * El cliente se crea de forma perezosa en la primera llamada, para que `next build` y las pruebas
 * que no usan la BD no necesiten `DATABASE_URL`. En desarrollo se guarda en `globalThis` para no
 * abrir conexiones nuevas en cada recarga en caliente.
 */

/** Cliente normal o cliente de una transacción interactiva (`$transaction(async (tx) => …)`). */
export type Db = PrismaClient | Prisma.TransactionClient;

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super("DATABASE_URL no está definida: no hay base de datos configurada.");
    this.name = "DatabaseNotConfiguredError";
  }
}

export function createPrismaClient(connectionString: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export function getPrisma(): PrismaClient {
  if (globalForPrisma.prisma) return globalForPrisma.prisma;
  const url = getDatabaseUrl();
  if (!url) throw new DatabaseNotConfiguredError();
  const client = createPrismaClient(url);
  globalForPrisma.prisma = client;
  return client;
}

/** `true` si hay una base de datos configurada en este proceso. */
export function isDatabaseConfigured(): boolean {
  return getDatabaseUrl() !== undefined;
}
