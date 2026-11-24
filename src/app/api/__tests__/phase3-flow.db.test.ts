import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { Prisma } from "@/generated/prisma/client";
import { createTestPrisma, testDatabaseUrl, truncateAll } from "@/test/db";
import { syncProgramCatalog } from "@/services/program.service";

/**
 * Flujo de la Fase 3 a través de las rutas: formulario → OTP → sesión → transferencia.
 * Incluye las pruebas de seguridad del SDD §12.3 que aplican a esta fase.
 */

const sentCodes: Array<{ to: string; code: string }> = [];
vi.mock("@/services/email.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/email.service")>()),
  sendVerificationCodeEmail: async (input: { to: string; code: string }) => {
    sentCodes.push(input);
    return { mode: "console" };
  },
  sendTransferPendingEmail: async () => ({ mode: "console" }),
}));

const requestRoute = await import("../verification/request/route");
const confirmRoute = await import("../verification/confirm/route");
const transfersRoute = await import("../transfers/route");

const COOKIE = "hm_verification";
let ipCounter = 0;

function post(path: string, body: unknown, init: { cookie?: string; ip?: string } = {}) {
  const headers = new Headers({ "content-type": "application/json" });
  headers.set("x-forwarded-for", init.ip ?? `10.0.0.${++ipCounter % 250}`);
  if (init.cookie) headers.set("cookie", `${COOKIE}=${init.cookie}`);
  return new NextRequest(`http://localhost:3000${path}`, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const application = {
  fullName: "Ana López",
  whatsapp: { country: "MX", number: "55 1234 5678" },
  program: "hm-strength",
  privacyAccepted: true,
};

describe.skipIf(!testDatabaseUrl)("API de la Fase 3 con PostgreSQL", () => {
  const prisma = testDatabaseUrl ? createTestPrisma() : (undefined as never);

  beforeAll(() => {
    // Las rutas usan el cliente por defecto (`getPrisma()`), que lee DATABASE_URL.
    process.env.DATABASE_URL = testDatabaseUrl;
  });
  beforeEach(async () => {
    await truncateAll(prisma);
    await syncProgramCatalog(prisma);
    sentCodes.length = 0;
  });
  afterAll(async () => {
    delete process.env.DATABASE_URL;
    await prisma.$disconnect();
  });

  async function verify(email = "ana@example.com"): Promise<string> {
    const requested = await requestRoute.POST(post("/api/verification/request", { email }));
    expect(requested.status).toBe(200);
    const code = sentCodes.at(-1)?.code;
    const confirmed = await confirmRoute.POST(post("/api/verification/confirm", { email, code }));
    expect(confirmed.status).toBe(200);
    const cookie = confirmed.cookies.get(COOKIE);
    expect(cookie?.value).toBeTruthy();
    return cookie!.value;
  }

  describe("POST /api/verification/request", () => {
    it("responde igual exista o no el correo (sin enumeración)", async () => {
      await prisma.customer.create({
        data: { fullName: "Ana", email: "ana@example.com", whatsapp: "+525512345678" },
      });
      const a = await requestRoute.POST(
        post("/api/verification/request", { email: "ana@example.com" }),
      );
      const b = await requestRoute.POST(
        post("/api/verification/request", { email: "nadie@example.com" }),
      );
      expect(a.status).toBe(b.status);
      expect(await a.json()).toEqual(await b.json());
      expect(a.headers.get("cache-control")).toBe("no-store");
      expect(sentCodes.map((c) => c.to)).toEqual(["ana@example.com", "nadie@example.com"]);
    });

    it("valida el correo con Zod", async () => {
      const res = await requestRoute.POST(post("/api/verification/request", { email: "no-es" }));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ success: false, error: "invalid_input" });
    });

    it("exige JSON", async () => {
      const req = new NextRequest("http://localhost:3000/api/verification/request", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "email=ana%40example.com",
      });
      expect((await requestRoute.POST(req)).status).toBe(415);
    });

    it("limita el reenvío a uno cada 60 s por correo", async () => {
      await requestRoute.POST(post("/api/verification/request", { email: "ana@example.com" }));
      const again = await requestRoute.POST(
        post("/api/verification/request", { email: "ana@example.com" }),
      );
      expect(again.status).toBe(429);
      expect(Number(again.headers.get("retry-after"))).toBeGreaterThan(0);
    });

    it("limita las solicitudes por IP", async () => {
      const statuses: number[] = [];
      for (let i = 0; i < 21; i++) {
        const res = await requestRoute.POST(
          post("/api/verification/request", { email: `user${i}@example.com` }, { ip: "9.9.9.9" }),
        );
        statuses.push(res.status);
      }
      expect(statuses.slice(0, 20).every((s) => s === 200)).toBe(true);
      expect(statuses[20]).toBe(429);
    });
  });

  describe("POST /api/verification/confirm", () => {
    it("con el código correcto emite la cookie de sesión httpOnly de 30 minutos", async () => {
      await requestRoute.POST(post("/api/verification/request", { email: "ana@example.com" }));
      const res = await confirmRoute.POST(
        post("/api/verification/confirm", { email: "ana@example.com", code: sentCodes[0]!.code }),
      );
      expect(res.status).toBe(200);
      const setCookie = res.headers.get("set-cookie") ?? "";
      expect(setCookie).toMatch(/HttpOnly/i);
      expect(setCookie).toMatch(/SameSite=lax/i);
      expect(setCookie).toMatch(/Max-Age=1800/);
      expect(setCookie).toMatch(/Path=\//);
    });

    it("con un código incorrecto no emite la cookie e indica los intentos restantes", async () => {
      await requestRoute.POST(post("/api/verification/request", { email: "ana@example.com" }));
      const wrong = sentCodes[0]!.code === "111111" ? "222222" : "111111";
      const res = await confirmRoute.POST(
        post("/api/verification/confirm", { email: "ana@example.com", code: wrong }),
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: "invalid_code", remainingAttempts: 4 });
      expect(res.cookies.get(COOKIE)).toBeUndefined();
    });

    it("sin código pedido responde igual que un código vencido", async () => {
      const res = await confirmRoute.POST(
        post("/api/verification/confirm", { email: "nadie@example.com", code: "123456" }),
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: "code_expired" });
    });
  });

  describe("POST /api/transfers", () => {
    it("sin sesión de verificación no crea nada (401)", async () => {
      const res = await transfersRoute.POST(post("/api/transfers", application));
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ error: "verification_required" });
      expect(await prisma.contract.count()).toBe(0);
      expect(await prisma.customer.count()).toBe(0);
    });

    it("con una cookie falsificada no crea nada (401)", async () => {
      const forged = `v1.${Buffer.from(
        JSON.stringify({ e: "ana@example.com", i: Date.now(), x: Date.now() + 1e6 }),
      ).toString("base64url")}.firma`;
      const res = await transfersRoute.POST(
        post("/api/transfers", application, { cookie: forged }),
      );
      expect(res.status).toBe(401);
      expect(await prisma.contract.count()).toBe(0);
    });

    it("con la sesión crea el cliente y el contrato pendiente y devuelve la referencia", async () => {
      const cookie = await verify();
      const res = await transfersRoute.POST(post("/api/transfers", application, { cookie }));
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body).toMatchObject({
        success: true,
        status: "pending_payment",
        program: { slug: "hm-strength", name: "HM STRENGTH" },
        currency: "MXN",
      });
      expect(body.reference).toMatch(/^HM-\d{4}-\d{6}$/);

      const customer = await prisma.customer.findUniqueOrThrow({
        where: { email: "ana@example.com" },
      });
      expect(customer.whatsapp).toBe("+525512345678");
      const contract = await prisma.contract.findUniqueOrThrow({
        where: { reference: body.reference },
      });
      expect(contract.customerId).toBe(customer.id);
    });

    it("toma el correo de la sesión, no del body", async () => {
      const cookie = await verify("ana@example.com");
      const res = await transfersRoute.POST(
        post("/api/transfers", { ...application, email: "victima@example.com" }, { cookie }),
      );
      expect(res.status).toBe(201);
      expect(await prisma.customer.findMany({ select: { email: true } })).toEqual([
        { email: "ana@example.com" },
      ]);
    });

    it("ignora importes y Price IDs enviados por el navegador", async () => {
      await prisma.program.update({
        where: { slug: "hm-strength" },
        data: { monthlyPrice: new Prisma.Decimal("1499.00") },
      });
      const cookie = await verify();
      const res = await transfersRoute.POST(
        post(
          "/api/transfers",
          { ...application, amount: "1.00", monthlyPrice: "1.00", priceId: "price_x" },
          { cookie },
        ),
      );
      const body = await res.json();
      expect(body.amount).toBe("1499.00");
      const contract = await prisma.contract.findFirstOrThrow();
      expect(contract.amount.toFixed(2)).toBe("1499.00");
    });

    it("vuelve a validar el formulario en el servidor", async () => {
      const cookie = await verify();
      const res = await transfersRoute.POST(
        post(
          "/api/transfers",
          { ...application, privacyAccepted: false, whatsapp: { country: "MX", number: "123" } },
          { cookie },
        ),
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(Object.keys(body.fields)).toEqual(
        expect.arrayContaining(["privacyAccepted", "whatsapp.number"]),
      );
      expect(await prisma.contract.count()).toBe(0);
    });

    it("rechaza un programa inactivo (422)", async () => {
      await prisma.program.update({ where: { slug: "hm-strength" }, data: { active: false } });
      const cookie = await verify();
      const res = await transfersRoute.POST(post("/api/transfers", application, { cookie }));
      expect(res.status).toBe(422);
      expect(await prisma.contract.count()).toBe(0);
    });

    it("un doble envío con la misma sesión devuelve la misma referencia", async () => {
      const cookie = await verify();
      const a = await (
        await transfersRoute.POST(post("/api/transfers", application, { cookie }))
      ).json();
      const b = await (
        await transfersRoute.POST(post("/api/transfers", application, { cookie }))
      ).json();
      expect(a.reference).toBe(b.reference);
      expect(await prisma.contract.count()).toBe(1);
    });

    it("incluye el enlace de WhatsApp con el programa y la referencia (RF-10)", async () => {
      vi.stubEnv("FERRO_WHATSAPP_NUMBER", "5215512345678");
      const cookie = await verify();
      const body = await (
        await transfersRoute.POST(post("/api/transfers", application, { cookie }))
      ).json();
      const url = new URL(body.whatsappUrl);
      expect(url.origin + url.pathname).toBe("https://wa.me/5215512345678");
      const text = url.searchParams.get("text") ?? "";
      expect(text).toContain("HM STRENGTH");
      expect(text).toContain(body.reference);
    });
  });
});
