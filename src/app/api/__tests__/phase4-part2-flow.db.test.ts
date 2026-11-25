import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hashApprovalPin } from "@/lib/approval-pin";
import { resetConfigCache } from "@/lib/config";
import { createVerificationSessionToken } from "@/lib/verification-session";
import { syncProgramCatalog } from "@/services/program.service";
import { createTestPrisma, testDatabaseUrl, truncateAll } from "@/test/db";

/**
 * Fase 4, parte 2 a través de las rutas: reglas de contratación (A20), pendiente de la sesión,
 * registro de la entrega del plan (A19) y cron diario.
 */

// Las rutas GET llaman a `connection()` para no prerenderizarse en `next build`; fuera de una
// solicitud real de Next lanza un error, así que en estas pruebas no hace nada.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => undefined,
}));

const sentLinks: string[] = [];
const deliveryLinks: string[] = [];
vi.mock("@/services/email.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/email.service")>()),
  sendTransferPendingEmail: async (input: { confirmUrl: string }) => {
    sentLinks.push(input.confirmUrl);
    return { mode: "console" };
  },
  sendTransferConfirmedEmail: async () => ({ mode: "console" }),
  sendWelcomeEmail: async () => ({ mode: "console" }),
  sendPaymentReceivedEmail: async (input: { deliveryUrl: string }) => {
    deliveryLinks.push(input.deliveryUrl);
    return { mode: "console" };
  },
  sendPlanDeliveryReminderEmail: async () => ({ mode: "console" }),
}));

const transfersRoute = await import("../transfers/route");
const confirmRoute = await import("../transfers/confirm/route");
const pendingRoute = await import("../contracts/pending/route");
const deliveryRoute = await import("../plan-delivery/confirm/route");
const cronRoute = await import("../cron/daily/route");

const PIN = "482917";
const CRON_SECRET = "s".repeat(32);
const COOKIE = "hm_verification";
let ipCounter = 0;

function request(
  method: "GET" | "POST",
  path: string,
  init: { body?: unknown; email?: string; headers?: Record<string, string> } = {},
) {
  const headers = new Headers({ "content-type": "application/json", ...init.headers });
  headers.set("x-forwarded-for", `10.2.0.${++ipCounter % 250}`);
  if (init.email) {
    headers.set("cookie", `${COOKIE}=${createVerificationSessionToken(init.email).token}`);
  }
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

const application = (program: string, extra: Record<string, unknown> = {}) => ({
  fullName: "Ana López",
  whatsapp: { country: "MX", number: "55 1234 5678" },
  program,
  privacyAccepted: true,
  ...extra,
});

describe.skipIf(!testDatabaseUrl)("API de la Fase 4 (parte 2) con PostgreSQL", () => {
  const prisma = testDatabaseUrl ? createTestPrisma() : (undefined as never);

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.FERRO_APPROVAL_PIN_HASH = await hashApprovalPin(PIN, 4);
    process.env.CRON_SECRET = CRON_SECRET;
    resetConfigCache();
  });
  beforeEach(async () => {
    await truncateAll(prisma);
    await syncProgramCatalog(prisma);
    sentLinks.length = 0;
    deliveryLinks.length = 0;
  });
  afterAll(async () => {
    delete process.env.DATABASE_URL;
    delete process.env.FERRO_APPROVAL_PIN_HASH;
    delete process.env.CRON_SECRET;
    resetConfigCache();
    await prisma.$disconnect();
  });

  const transfer = (program: string, extra: Record<string, unknown> = {}) =>
    transfersRoute.POST(
      request("POST", "/api/transfers", {
        body: application(program, extra),
        email: "ana@example.com",
      }),
    );

  describe("POST /api/transfers con un pendiente (DECISIONS A20)", () => {
    it("crea (201), reutiliza (200) y pregunta antes de cambiar de programa (409)", async () => {
      const created = await transfer("hm-run");
      expect(created.status).toBe(201);
      const { reference } = await created.json();

      const reused = await transfer("hm-run");
      expect(reused.status).toBe(200);
      expect(await reused.json()).toMatchObject({ reference, outcome: "reused" });

      const conflict = await transfer("hm-complete");
      expect(conflict.status).toBe(409);
      expect(await conflict.json()).toMatchObject({
        error: "pending_contract_exists",
        pending: { reference, programName: "HM RUN", paymentType: "transfer", amount: "1200.00" },
      });

      const changed = await transfer("hm-complete", { pendingAction: "change" });
      expect(changed.status).toBe(200);
      expect(await changed.json()).toMatchObject({
        reference,
        outcome: "changed",
        program: { slug: "hm-complete" },
        amount: "1800.00",
      });
    });

    it("rechaza un pendingAction desconocido", async () => {
      const res = await transfer("hm-run", { pendingAction: "borrar" });
      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/contracts/pending", () => {
    it("exige la sesión de verificación", async () => {
      const res = await pendingRoute.GET(request("GET", "/api/contracts/pending"));
      expect(res.status).toBe(401);
    });

    it("devuelve solo el pendiente del correo de la sesión", async () => {
      await transfer("hm-strength");
      const mine = await pendingRoute.GET(
        request("GET", "/api/contracts/pending", { email: "ana@example.com" }),
      );
      expect(await mine.json()).toMatchObject({
        pending: { programSlug: "hm-strength", amount: "1500.00" },
      });
      const other = await pendingRoute.GET(
        request("GET", "/api/contracts/pending", { email: "otro@example.com" }),
      );
      expect(await other.json()).toEqual({ success: true, pending: null });
    });
  });

  async function confirmedMonth() {
    await transfer("hm-run");
    const token = sentLinks.at(-1)!.split("/transfer/confirm/")[1]!;
    const res = await confirmRoute.POST(
      request("POST", "/api/transfers/confirm", { body: { token, pin: PIN } }),
    );
    expect(res.status).toBe(200);
    return deliveryLinks.at(-1)!.split("/plan/entrega/")[1]!;
  }

  describe("POST /api/plan-delivery/confirm", () => {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(
      new Date(),
    );
    const deliver = (body: unknown) =>
      deliveryRoute.POST(request("POST", "/api/plan-delivery/confirm", { body }));

    it("registra la fecha de hoy y responde lo mismo si se repite", async () => {
      const token = await confirmedMonth();
      const res = await deliver({ token, deliveredOn: today });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        success: true,
        deliveredOn: today,
        alreadyRecorded: false,
      });
      const again = await deliver({ token, deliveredOn: today });
      expect(await again.json()).toMatchObject({ alreadyRecorded: true });
    });

    it("valida la fecha y el botón", async () => {
      const token = await confirmedMonth();
      expect((await deliver({ token, deliveredOn: "2026-02-30" })).status).toBe(400);
      expect((await deliver({ token })).status).toBe(400);
      expect((await deliver({ token, deliveredOn: "2099-01-01" })).status).toBe(422);
      expect((await deliver({ token, deliveredOn: "2000-01-01" })).status).toBe(422);
      expect((await deliver({ token: "x".repeat(43), deliveredOn: today })).status).toBe(404);
    });
  });

  describe("GET /api/cron/daily", () => {
    const cron = (authorization?: string) =>
      cronRoute.GET(
        request("GET", "/api/cron/daily", {
          headers: authorization ? { authorization } : {},
        }),
      );

    it("sin el secreto correcto no hace nada (401)", async () => {
      expect((await cron()).status).toBe(401);
      expect((await cron("Bearer otro-secreto")).status).toBe(401);
      expect((await cron(CRON_SECRET)).status).toBe(401);
    });

    it("con el secreto ejecuta las tareas", async () => {
      const res = await cron(`Bearer ${CRON_SECRET}`);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        success: true,
        expiredPending: 0,
        scheduledActivated: 0,
        completed: 0,
      });
    });
  });

  it("la página del botón de entrega no envía Referer, no se indexa y no se guarda en caché", async () => {
    const { default: nextConfig } = await import("../../../../next.config");
    const rules = await nextConfig.headers!();
    const rule = rules.find((r) => r.source.startsWith("/plan/entrega/"));
    expect(rule?.headers).toEqual(
      expect.arrayContaining([
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "X-Robots-Tag", value: "noindex, nofollow" },
        { key: "Cache-Control", value: "no-store" },
      ]),
    );
  });
});
