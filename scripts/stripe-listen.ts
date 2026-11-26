/**
 * `npm run stripe:listen` — reenvía los webhooks de Stripe a la app local (DECISIONS A30).
 *
 * Arranca `stripe listen` con la clave de `.env.local` y los eventos que escucha la app, toma el
 * secreto `whsec_…` de esa ejecución y lo escribe en `STRIPE_WEBHOOK_SECRET` de `.env.local`.
 * `next dev` recarga `.env.local` solo y la configuración se vuelve a leer en desarrollo, así que
 * no hace falta reiniciar `npm run dev`. El secreto nunca se imprime completo.
 *
 * Requiere la Stripe CLI instalada. Solo acepta claves de prueba. Opciones:
 *   npm run stripe:listen -- --port 3001
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { isLiveKey, STRIPE_WEBHOOK_EVENTS } from "../src/lib/stripe-constants";

const ENV_FILE = resolve(process.cwd(), ".env.local");
const SECRET_PATTERN = /whsec_[A-Za-z0-9]+/;

/** Valor de una variable en el contenido de un archivo `.env` (sin comillas). */
export function readEnvValue(contents: string, name: string): string | undefined {
  let value: string | undefined;
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(new RegExp(`^\\s*${name}\\s*=\\s*(.*)\\s*$`));
    if (match) value = match[1]!.replace(/^(['"])(.*)\1$/, "$2").trim();
  }
  return value || undefined;
}

/** Reemplaza (o agrega) una variable dejando una sola línea con ese nombre. */
export function upsertEnvValue(contents: string, name: string, value: string): string {
  const lines = contents
    .split(/\r?\n/)
    .filter((line) => !new RegExp(`^\\s*${name}\\s*=`).test(line));
  while (lines.length > 0 && lines.at(-1) === "") lines.pop();
  lines.push(`${name}=${value}`);
  return `${lines.join("\n")}\n`;
}

export function parsePort(argv: readonly string[]): number {
  const index = argv.indexOf("--port");
  const raw = index >= 0 ? argv[index + 1] : process.env.PORT;
  const port = Number(raw ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Puerto inválido: ${raw}`);
  }
  return port;
}

function main() {
  if (!existsSync(ENV_FILE)) throw new Error("No existe .env.local en esta carpeta.");
  const contents = readFileSync(ENV_FILE, "utf8");
  const apiKey = readEnvValue(contents, "STRIPE_SECRET_KEY");
  if (!apiKey) throw new Error("Falta STRIPE_SECRET_KEY en .env.local.");
  if (isLiveKey(apiKey)) {
    throw new Error("STRIPE_SECRET_KEY es de modo live: stripe:listen es solo para pruebas.");
  }
  const port = parsePort(process.argv.slice(2));
  const forwardTo = `127.0.0.1:${port}/api/webhooks/stripe`;

  console.log(`Reenviando ${STRIPE_WEBHOOK_EVENTS.join(", ")} a ${forwardTo}`);
  const child = spawn(
    "stripe",
    [
      "listen",
      "--api-key",
      apiKey,
      "--forward-to",
      forwardTo,
      "--events",
      STRIPE_WEBHOOK_EVENTS.join(","),
    ],
    { stdio: ["inherit", "pipe", "pipe"] },
  );

  let secretSaved = false;
  const onOutput = (chunk: Buffer, write: (text: string) => void) => {
    const text = chunk.toString();
    write(text);
    const match = !secretSaved && text.match(SECRET_PATTERN);
    if (!match) return;
    secretSaved = true;
    const secret = match[0];
    const current = readFileSync(ENV_FILE, "utf8");
    const tail = secret.slice(-4);
    if (readEnvValue(current, "STRIPE_WEBHOOK_SECRET") === secret) {
      console.log(`\n✔ STRIPE_WEBHOOK_SECRET ya estaba al día en .env.local (…${tail}).\n`);
      return;
    }
    writeFileSync(ENV_FILE, upsertEnvValue(current, "STRIPE_WEBHOOK_SECRET", secret));
    console.log(
      `\n✔ Actualicé STRIPE_WEBHOOK_SECRET en .env.local (…${tail}). npm run dev lo toma solo; ` +
        "si un webhook responde [400], reinícialo.\n",
    );
  };
  child.stdout.on("data", (chunk: Buffer) => onOutput(chunk, (t) => process.stdout.write(t)));
  child.stderr.on("data", (chunk: Buffer) => onOutput(chunk, (t) => process.stderr.write(t)));
  child.on("error", (error: NodeJS.ErrnoException) => {
    console.error(
      error.code === "ENOENT"
        ? "No se encontró la Stripe CLI. Instálala: https://docs.stripe.com/stripe-cli"
        : `No se pudo arrancar stripe listen: ${error.message}`,
    );
    process.exit(1);
  });
  child.on("exit", (code) => process.exit(code ?? 0));
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => child.kill(signal));
  }
}

// Solo se ejecuta como script (las pruebas importan las funciones).
if (process.argv[1]?.endsWith("stripe-listen.ts")) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
