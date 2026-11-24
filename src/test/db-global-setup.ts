import { execFileSync } from "node:child_process";

import { Client } from "pg";

/**
 * Preparación de las pruebas de integración con PostgreSQL (proyecto `db` de Vitest).
 *
 * Usa `TEST_DATABASE_URL` (nunca `DATABASE_URL`, para no tocar la BD de desarrollo). Si no está
 * definida, las pruebas `*.db.test.ts` se omiten. Por seguridad, el nombre de la BD debe contener
 * "test": se borra por completo y se le aplican todas las migraciones.
 */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    console.warn("[db] TEST_DATABASE_URL no está definida: se omiten las pruebas de BD.");
    return;
  }
  const database = new URL(url).pathname.replace(/^\//, "");
  if (!/test/i.test(database)) {
    throw new Error(
      `TEST_DATABASE_URL debe apuntar a una BD cuyo nombre contenga "test" (es "${database}").`,
    );
  }

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
  } finally {
    await client.end();
  }

  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
}
