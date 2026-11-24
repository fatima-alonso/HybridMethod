import { loadEnvConfig } from "@next/env";
import { defineConfig } from "prisma/config";

// Carga .env / .env.local igual que Next.js (Prisma 7 no lee .env por sí mismo).
loadEnvConfig(process.cwd());

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  // Opcional: `prisma generate` (postinstall, CI, build) no necesita base de datos.
  // `migrate`, `db seed` y `studio` sí la exigen.
  // `SHADOW_DATABASE_URL` solo hace falta para `prisma migrate diff --from-migrations` (CI).
  datasource: {
    url: process.env.DATABASE_URL,
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
