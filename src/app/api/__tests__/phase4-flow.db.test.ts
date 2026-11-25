import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hashApprovalPin } from "@/lib/approval-pin";
import { resetConfigCache } from "@/lib/config";
import { createTestPrisma, testDatabaseUrl, truncateAll } from "@/test/db";
import { syncProgramCatalog } from "@/services/program.service";

import nextConfig from "../../../../next.config";

/**
 * Fase 4 a través de las rutas: `POST /api/transfers/confirm` y `/regenerate`, con las pruebas de
 * seguridad del SDD §12.3 sobre tokens y PIN.
 */

const sentLinks: string[] = [];
vi.mock("@/services/email.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/email.service")>()),
  sendTransferPendingEmail: async (input: { confirmUrl: string }) => {
    sentLinks.push(input.confirmUrl);
    return { mode: "console" };
  },
  sendTransferConfirmedEmail: async () => ({ mode: "console" }),
  sendWelcomeEmail: async () => ({ mode: "console" }),
  sendPaymentReceivedEmail: async () => ({ mode: "console" }),
}));

const { requestTransfer } = await import("@/services/transfer.service");
const confirmRoute = await import("../transfers/confirm/route");
const regenerateRoute = await import("../transfers/regenerate/route");

const PIN = "482917";
let ipCounter = 0;

function post(path: string, body: unknown, init: { ip?: string; contentType?: string } = {}) {
  const headers = new Headers({ "content-type": init.contentType ?? "application/json" });
  headers.set("x-forwarded-for", init.ip ?? `10.1.0.${++ipCounter % 250}`);
  headers.set("user-agent", "vitest");
  return new NextRequest(`http://localhost:3000${path}`, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const confirmReq = (body: unknown, init?: { ip?: string; contentType?: string }) =>
  confirmRoute.POST(post("/api/transfers/confirm", body, init));
const regenerateReq = (body: unknown, init?: { ip?: string }) =>
  regenerateRoute.POST(post("/api/transfers/regenerate", body, init));

describe.skipIf(!testDatabaseUrl)("API de la Fase 4 con PostgreSQL", () => {
  const prisma = testDatabaseUrl ? createTestPrisma() : (undefined as never);

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.FERRO_APPROVAL_PIN_HASH = await hashApprovalPin(PIN, 4);
    resetConfigCache();
  });
  beforeEach(async () => {
    await truncateAll(prisma);
    await syncProgramCatalog(prisma);
    sentLinks.length = 0;
  });
  afterAll(async () => {
    delete process.env.DATABASE_URL;
    delete process.env.FERRO_APPROVAL_PIN_HASH;
    resetConfigCache();
    await prisma.$disconnect();
  });

  async function pendingTransfer() {
    const { contract } = await requestTransfer(
      {
        verifiedEmail: "ana@example.com",
        fullName: "Ana López",
        whatsapp: "+525512345678",
        programSlug: "hm-complete",
      },
      {},
      prisma,
    );
    return { contract, token: sentLinks.at(-1)!.split("/").at(-1)! };
  }

  describe("POST /api/transfers/confirm", () => {
    it("confirma con token y PIN y devuelve el periodo", async () => {
      const { contract, token } = await pendingTransfer();
      const res = await confirmReq({ token, pin: PIN });
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const body = await res.json();
      expect(body).toMatchObject({
        success: true,
        reference: contract.reference,
        status: "active",
      });
      expect(new Date(body.serviceEndDate).getTime()).toBeGreaterThan(
        new Date(body.serviceStartDate).getTime(),
      );
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: "transfer.approved" },
      });
      expect(audit.userAgent).toBe("vitest");
      expect(audit.ip).toMatch(/^10\.1\.0\./);
    });

    it.each([
      ["sin token", { pin: PIN }],
      ["sin PIN", { token: "A".repeat(43) }],
      ["con PIN vacío", { token: "A".repeat(43), pin: "" }],
      ["con un PIN que no son dígitos", { token: "A".repeat(43), pin: "abcdef" }],
    ])("rechaza la solicitud %s (400) sin tocar nada", async (_case, body) => {
      const { contract } = await pendingTransfer();
      const res = await confirmReq(body);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("invalid_input");
      expect((await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).status).toBe(
        "pending_payment",
      );
      expect((await prisma.transferApproval.findFirstOrThrow()).pinAttempts).toBe(0);
    });

    it("no acepta un formulario HTML de otro sitio (415)", async () => {
      const { token } = await pendingTransfer();
      const res = await confirmReq(`token=${token}&pin=${PIN}`, {
        contentType: "application/x-www-form-urlencoded",
      });
      expect(res.status).toBe(415);
    });

    it("no existe la acción reject: un campo extra no cambia nada", async () => {
      const { token } = await pendingTransfer();
      const res = await confirmReq({ token, pin: "111222", action: "reject" });
      expect(res.status).toBe(403);
      expect((await prisma.contract.findFirstOrThrow()).status).toBe("pending_payment");
    });

    it("PIN incorrecto: 403 con intentos restantes; al quinto, 410 y enlace invalidado", async () => {
      const { token } = await pendingTransfer();
      for (const remaining of [4, 3, 2, 1]) {
        const res = await confirmReq({ token, pin: "111222" });
        expect(res.status).toBe(403);
        expect(await res.json()).toMatchObject({
          error: "invalid_pin",
          remainingAttempts: remaining,
        });
      }
      const fifth = await confirmReq({ token, pin: "111222" });
      expect(fifth.status).toBe(410);
      expect(await fifth.json()).toMatchObject({
        error: "link_unavailable",
        reason: "invalidated",
      });

      const afterwards = await confirmReq({ token, pin: PIN });
      expect(afterwards.status).toBe(410);
      expect((await prisma.contract.findFirstOrThrow()).status).toBe("pending_payment");
    });

    it("token inexistente: 404 sin revelar datos", async () => {
      await pendingTransfer();
      const res = await confirmReq({ token: "B".repeat(43), pin: PIN });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body).toMatchObject({ error: "link_unavailable", reason: "not_found" });
      expect(body.reference).toBeUndefined();
    });

    it("token usado: 410 y sin un segundo pago", async () => {
      const { token } = await pendingTransfer();
      expect((await confirmReq({ token, pin: PIN })).status).toBe(200);
      const again = await confirmReq({ token, pin: PIN });
      expect(again.status).toBe(410);
      expect(await again.json()).toMatchObject({ reason: "used" });
      expect(await prisma.payment.count()).toBe(1);
    });

    it("token vencido: 410 y el contrato sigue pendiente", async () => {
      const { token } = await pendingTransfer();
      await prisma.transferApproval.updateMany({
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const res = await confirmReq({ token, pin: PIN });
      expect(res.status).toBe(410);
      expect(await res.json()).toMatchObject({ reason: "expired" });
      expect((await prisma.contract.findFirstOrThrow()).status).toBe("pending_payment");
    });

    it("limita los intentos por IP (429)", async () => {
      const ip = "198.51.100.9";
      let last: Response | undefined;
      for (let i = 0; i < 21; i++)
        last = await confirmReq({ token: "C".repeat(43), pin: PIN }, { ip });
      expect(last?.status).toBe(429);
      expect(last?.headers.get("retry-after")).toBeTruthy();
    });

    it("sin FERRO_APPROVAL_PIN_HASH responde 503 y no cuenta el intento", async () => {
      const { token } = await pendingTransfer();
      const saved = process.env.FERRO_APPROVAL_PIN_HASH;
      delete process.env.FERRO_APPROVAL_PIN_HASH;
      resetConfigCache();
      vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const res = await confirmReq({ token, pin: PIN });
        expect(res.status).toBe(503);
      } finally {
        process.env.FERRO_APPROVAL_PIN_HASH = saved;
        resetConfigCache();
      }
      expect((await prisma.transferApproval.findFirstOrThrow()).pinAttempts).toBe(0);
    });
  });

  describe("POST /api/transfers/regenerate", () => {
    it("genera y envía un enlace nuevo; el token no viaja en la respuesta", async () => {
      const { contract, token } = await pendingTransfer();
      const res = await regenerateReq({ reference: contract.reference.toLowerCase(), pin: PIN });
      expect(res.status).toBe(200);
      const text = await res.text();
      const newToken = sentLinks.at(-1)!.split("/").at(-1)!;
      expect(newToken).not.toBe(token);
      expect(text).not.toContain(newToken);
      expect(JSON.parse(text)).toMatchObject({ success: true, reference: contract.reference });

      expect((await confirmReq({ token, pin: PIN })).status).toBe(410);
      expect((await confirmReq({ token: newToken, pin: PIN })).status).toBe(200);
    });

    it("PIN incorrecto: 403 igual exista o no la referencia", async () => {
      const { contract } = await pendingTransfer();
      const a = await regenerateReq({ reference: contract.reference, pin: "111222" });
      const b = await regenerateReq({ reference: "HM-2026-999999", pin: "111222" });
      expect(a.status).toBe(403);
      expect(await a.json()).toEqual(await b.json());
      expect(sentLinks).toHaveLength(1);
    });

    it("contrato ya pagado: 409; referencia inexistente: 404", async () => {
      const { contract, token } = await pendingTransfer();
      expect((await regenerateReq({ reference: "HM-2026-999999", pin: PIN })).status).toBe(404);
      await confirmReq({ token, pin: PIN });
      expect((await regenerateReq({ reference: contract.reference, pin: PIN })).status).toBe(409);
    });

    it("tiene un límite global además del de IP", async () => {
      let last: Response | undefined;
      for (let i = 0; i < 31; i++) {
        last = await regenerateReq({ reference: "HM-2026-999999", pin: "111222" });
      }
      expect(last?.status).toBe(429);
    });
  });

  it("la página del enlace no envía Referer, no se indexa y no se guarda en caché", async () => {
    const rules = await nextConfig.headers!();
    const rule = rules.find((r) => r.source.startsWith("/transfer/confirm/"));
    expect(rule?.headers).toEqual(
      expect.arrayContaining([
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "X-Robots-Tag", value: "noindex, nofollow" },
        { key: "Cache-Control", value: "no-store" },
      ]),
    );
  });
});
