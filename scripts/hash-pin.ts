/**
 * `npm run hash-pin` — genera `FERRO_APPROVAL_PIN_HASH` (DECISIONS A7, A23).
 *
 * Pide el PIN dos veces sin mostrarlo en pantalla (no se pasa como argumento para que no quede en
 * el historial de la terminal) e imprime su hash bcrypt. El PIN nunca se guarda.
 *
 * También acepta el PIN por la entrada estándar si no es una terminal:
 *   printf '%s\n' "$PIN" | npm run --silent hash-pin
 */
import { createInterface } from "node:readline";

import { hashApprovalPin, weakPinReason } from "../src/lib/approval-pin";

/** Next.js expande `$VAR` en los archivos .env: en ellos el hash se escribe con `\$`. */
export function escapeForDotenv(hash: string): string {
  return hash.replaceAll("$", "\\$");
}

function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const output = rl as unknown as { _writeToOutput: (text: string) => void };
    let prompted = false;
    output._writeToOutput = (text: string) => {
      // Muestra la pregunta una vez y oculta lo que se escribe.
      if (!prompted) {
        process.stdout.write(text);
        prompted = true;
      }
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer.trim());
    });
  });
}

async function readStdinLine(): Promise<string> {
  const rl = createInterface({ input: process.stdin });
  for await (const line of rl) {
    rl.close();
    return line.trim();
  }
  return "";
}

async function main(): Promise<number> {
  let pin: string;
  if (process.stdin.isTTY) {
    pin = await askHidden("PIN de aprobación (6 a 12 dígitos): ");
    const weak = weakPinReason(pin);
    if (weak) {
      console.error(weak);
      return 1;
    }
    const again = await askHidden("Repite el PIN: ");
    if (again !== pin) {
      console.error("Los PIN no coinciden.");
      return 1;
    }
  } else {
    pin = await readStdinLine();
    const weak = weakPinReason(pin);
    if (weak) {
      console.error(weak);
      return 1;
    }
  }

  const hash = await hashApprovalPin(pin);
  console.log(
    [
      "",
      'En .env.local (Next.js expande "$" en los archivos .env, por eso va escapado):',
      `FERRO_APPROVAL_PIN_HASH=${escapeForDotenv(hash)}`,
      "",
      "En Vercel (Settings → Environment Variables), el valor tal cual:",
      hash,
      "",
      "Guarda el PIN en un lugar seguro: no se puede recuperar a partir del hash.",
    ].join("\n"),
  );
  return 0;
}

// Solo se ejecuta como script (no al importarlo en las pruebas).
if (process.argv[1]?.endsWith("hash-pin.ts")) {
  main().then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    },
  );
}
