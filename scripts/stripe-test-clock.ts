/**
 * `npm run stripe:test-clock` — prueba renovaciones y pagos fallidos de la suscripción con un test
 * clock de Stripe (Fase 6, DECISIONS A31, A32). Solo funciona con claves de prueba.
 *
 * Un test clock solo mueve clientes creados dentro de él, así que el script crea en Stripe un
 * cliente y una suscripción dentro de un reloj y los liga (con `metadata.contractId`) a un contrato
 * de suscripción **pendiente** que hiciste en la landing con tu correo verificado. Los webhooks
 * llegan a la app por `npm run stripe:listen`, igual que con un pago real.
 *
 * Comandos (los IDs se guardan en `.stripe-test-clock.json`, que no se sube al repositorio):
 *   npm run stripe:test-clock -- start HM-2026-000123   crea el reloj, el cliente y la suscripción
 *   npm run stripe:test-clock -- renew                  adelanta hasta la siguiente renovación
 *   npm run stripe:test-clock -- day                    adelanta un día (reintentos, A32)
 *   npm run stripe:test-clock -- fail-card              la tarjeta del cliente empieza a fallar
 *   npm run stripe:test-clock -- ok-card                vuelve a una tarjeta que sí paga
 *   npm run stripe:test-clock -- status                 estado en Stripe y en la BD
 *   npm run stripe:test-clock -- end                    borra el reloj (y su cliente) en Stripe
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { loadEnvConfig } from "@next/env";
import Stripe from "stripe";

import { createPrismaClient } from "@/lib/prisma";
import { isLiveKey } from "@/lib/stripe";

export const STATE_FILE = ".stripe-test-clock.json";

/** Stripe cobra la factura de renovación ~1 h después de que empieza el periodo. */
const AFTER_RENEWAL_SECONDS = 2 * 60 * 60;
const DAY_SECONDS = 24 * 60 * 60;

/** Tarjetas de prueba de Stripe: una que paga y una que se guarda pero cuyos cobros fallan. */
export const TEST_CARDS = {
  ok: "pm_card_visa",
  fail: "pm_card_chargeCustomerFail",
} as const;

export const COMMANDS = ["start", "renew", "day", "fail-card", "ok-card", "status", "end"] as const;
export type Command = (typeof COMMANDS)[number];

export type ClockState = {
  clockId: string;
  customerId: string;
  subscriptionId: string;
  contractId: string;
  reference: string;
};

export function parseCommand(argv: readonly string[]): { command: Command; arg?: string } {
  const [command, arg] = argv;
  if (!command || !(COMMANDS as readonly string[]).includes(command)) {
    throw new Error(
      `Comando desconocido: ${command ?? "(ninguno)"}. Usa uno de: ${COMMANDS.join(", ")}.`,
    );
  }
  return { command: command as Command, arg };
}

export function parseState(contents: string): ClockState {
  const data = JSON.parse(contents) as Partial<ClockState>;
  for (const key of [
    "clockId",
    "customerId",
    "subscriptionId",
    "contractId",
    "reference",
  ] as const) {
    if (typeof data[key] !== "string" || !data[key]) {
      throw new Error(`${STATE_FILE} no es válido (falta ${key}). Bórralo y usa "start".`);
    }
  }
  return data as ClockState;
}

/** Momento al que se adelanta el reloj: después del cobro de la renovación, o un día más. */
export function targetTime(
  step: "renew" | "day",
  input: { frozenTime: number; currentPeriodEnd: number },
): number {
  if (step === "renew") {
    return Math.max(input.currentPeriodEnd, input.frozenTime) + AFTER_RENEWAL_SECONDS;
  }
  return input.frozenTime + DAY_SECONDS;
}

const formatTime = (seconds: number) =>
  new Date(seconds * 1000).toLocaleString("es-MX", {
    timeZone: "America/Mexico_City",
    dateStyle: "medium",
    timeStyle: "short",
  });

function readState(): ClockState {
  const path = resolve(process.cwd(), STATE_FILE);
  if (!existsSync(path)) {
    throw new Error(
      `No hay un reloj en curso. Empieza con: npm run stripe:test-clock -- start <REFERENCIA>`,
    );
  }
  return parseState(readFileSync(path, "utf8"));
}

async function waitUntilReady(
  stripe: Stripe,
  clockId: string,
): Promise<Stripe.TestHelpers.TestClock> {
  for (let i = 0; i < 90; i += 1) {
    const clock = await stripe.testHelpers.testClocks.retrieve(clockId);
    if (clock.status === "ready") return clock;
    if (clock.status === "internal_failure") throw new Error("Stripe no pudo adelantar el reloj.");
    await new Promise((done) => setTimeout(done, 2000));
  }
  throw new Error("El reloj sigue avanzando después de 3 minutos. Revisa el Dashboard de Stripe.");
}

async function setDefaultCard(stripe: Stripe, state: ClockState, card: string): Promise<string> {
  const method = await stripe.paymentMethods.attach(card, { customer: state.customerId });
  await stripe.customers.update(state.customerId, {
    invoice_settings: { default_payment_method: method.id },
  });
  await stripe.subscriptions.update(state.subscriptionId, { default_payment_method: method.id });
  return method.id;
}

async function main() {
  loadEnvConfig(process.cwd());
  const { command, arg } = parseCommand(process.argv.slice(2));
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY no está definida en .env.local.");
  if (isLiveKey(key) || !/^(sk|rk)_test_/.test(key)) {
    throw new Error("stripe:test-clock solo funciona con una clave de prueba (sk_test_…).");
  }
  const stripe = new Stripe(key, { maxNetworkRetries: 2 });

  switch (command) {
    case "start":
      return start(stripe, arg);
    case "renew":
    case "day": {
      const state = readState();
      const clock = await stripe.testHelpers.testClocks.retrieve(state.clockId);
      const subscription = await stripe.subscriptions.retrieve(state.subscriptionId);
      const target = targetTime(command, {
        frozenTime: clock.frozen_time,
        currentPeriodEnd: subscription.items.data[0]?.current_period_end ?? clock.frozen_time,
      });
      console.log(
        `Adelantando el reloj de ${formatTime(clock.frozen_time)} a ${formatTime(target)}…`,
      );
      await stripe.testHelpers.testClocks.advance(state.clockId, { frozen_time: target });
      await waitUntilReady(stripe, state.clockId);
      console.log(
        "✔ Listo. Espera unos segundos a que stripe:listen entregue los eventos y revisa:",
      );
      console.log("  npm run stripe:test-clock -- status");
      return;
    }
    case "fail-card": {
      const id = await setDefaultCard(stripe, readState(), TEST_CARDS.fail);
      console.log(
        `✔ Tarjeta que falla (${id}) como predeterminada. Los siguientes cobros fallarán.`,
      );
      return;
    }
    case "ok-card": {
      const id = await setDefaultCard(stripe, readState(), TEST_CARDS.ok);
      console.log(`✔ Tarjeta que paga (${id}) como predeterminada.`);
      return;
    }
    case "status":
      return status(stripe);
    case "end": {
      const state = readState();
      await stripe.testHelpers.testClocks.del(state.clockId);
      rmSync(resolve(process.cwd(), STATE_FILE));
      console.log(`✔ Reloj ${state.clockId} borrado en Stripe (con su cliente y su suscripción).`);
      console.log(`  El contrato ${state.reference} se queda en la BD tal como está.`);
      return;
    }
  }
}

async function start(stripe: Stripe, reference: string | undefined) {
  if (!reference)
    throw new Error("Falta la referencia: npm run stripe:test-clock -- start HM-2026-000123");
  if (existsSync(resolve(process.cwd(), STATE_FILE))) {
    throw new Error(
      `Ya hay un reloj en curso (${STATE_FILE}). Termínalo con "end" antes de empezar otro.`,
    );
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL no está definida.");
  const prisma = createPrismaClient(url);
  try {
    const contract = await prisma.contract.findUnique({
      where: { reference },
      include: { program: true, customer: true },
    });
    if (!contract) throw new Error(`No existe el contrato ${reference}.`);
    if (contract.paymentType !== "subscription" || contract.status !== "pending_payment") {
      throw new Error(
        `${reference} debe ser una suscripción pendiente de pago (es ${contract.paymentType}, ${contract.status}). ` +
          'Inscríbete en la landing con "Suscripción mensual con tarjeta" y no pagues.',
      );
    }
    const priceId = contract.program.stripePriceIdRecurring;
    if (!priceId)
      throw new Error('El programa no tiene Price recurrente: corre "npm run stripe:sync".');

    const now = Math.floor(Date.now() / 1000);
    const clock = await stripe.testHelpers.testClocks.create({
      frozen_time: now,
      name: `HM ${reference}`,
    });
    const customer = await stripe.customers.create({
      test_clock: clock.id,
      email: contract.customer.email,
      name: `${contract.customer.fullName} (test clock)`,
      payment_method: TEST_CARDS.ok,
      invoice_settings: { default_payment_method: TEST_CARDS.ok },
    });
    const metadata = { contractId: contract.id, reference };
    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: priceId }],
      metadata,
    });
    const state: ClockState = {
      clockId: clock.id,
      customerId: customer.id,
      subscriptionId: subscription.id,
      contractId: contract.id,
      reference,
    };
    writeFileSync(resolve(process.cwd(), STATE_FILE), `${JSON.stringify(state, null, 2)}\n`);

    console.log(`✔ Reloj ${clock.id} (${formatTime(now)})`);
    console.log(`✔ Cliente ${customer.id} con una tarjeta que paga`);
    console.log(
      `✔ Suscripción ${subscription.id} (${contract.program.name}) ligada a ${reference}`,
    );
    console.log("");
    console.log("En stripe:listen debe llegar invoice.paid y el contrato pasa a active. Después:");
    console.log("  npm run stripe:test-clock -- renew       renovación exitosa (mes 2)");
    console.log(
      "  npm run stripe:test-clock -- fail-card   y luego renew + day + day: 3 días de fallos",
    );
    console.log("  npm run stripe:test-clock -- status      ver cómo va");
  } finally {
    await prisma.$disconnect();
  }
}

async function status(stripe: Stripe) {
  const state = readState();
  const clock = await stripe.testHelpers.testClocks.retrieve(state.clockId);
  const subscription = await stripe.subscriptions.retrieve(state.subscriptionId, {
    expand: ["latest_invoice"],
  });
  const invoice = subscription.latest_invoice as Stripe.Invoice | null;
  const item = subscription.items.data[0];

  console.log(`Reloj:        ${formatTime(clock.frozen_time)} (${clock.status})`);
  console.log(`Stripe:       suscripción ${subscription.status}`);
  if (item) {
    console.log(
      `              periodo ${formatTime(item.current_period_start)} → ${formatTime(item.current_period_end)}`,
    );
  }
  if (invoice) {
    const next = invoice.next_payment_attempt
      ? `siguiente intento ${formatTime(invoice.next_payment_attempt)}`
      : "sin más intentos";
    console.log(
      `              última factura ${invoice.status} · intentos ${invoice.attempt_count} · ${next}`,
    );
  }

  const url = process.env.DATABASE_URL;
  if (!url) return;
  const prisma = createPrismaClient(url);
  try {
    const contract = await prisma.contract.findUnique({
      where: { id: state.contractId },
      include: {
        payments: { orderBy: { createdAt: "asc" } },
        servicePeriods: { orderBy: { sequence: "asc" } },
        subscription: true,
      },
    });
    if (!contract) return;
    console.log(`App:          contrato ${contract.reference} ${contract.status}`);
    console.log(
      `              suscripción ${contract.subscription?.status ?? "(sin sincronizar)"}`,
    );
    console.log(
      `              pagos: ${contract.payments.map((p) => p.status).join(", ") || "ninguno"}`,
    );
    for (const period of contract.servicePeriods) {
      console.log(
        `              mes ${period.sequence}: ${formatTime(period.startDate.getTime() / 1000)} → ${formatTime(period.endDate.getTime() / 1000)}`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

// Solo se ejecuta como script (las pruebas importan las funciones).
if (process.argv[1] && /stripe-test-clock\.ts$/.test(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
