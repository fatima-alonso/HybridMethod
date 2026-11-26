import { NextRequest } from "next/server";
import Stripe from "stripe";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { resetConfigCache } from "@/lib/config";
import { createVerificationSessionToken } from "@/lib/verification-session";
import { syncProgramCatalog } from "@/services/program.service";
import { syncStripeCatalog } from "@/services/stripe-catalog.service";
import { createTestPrisma, testDatabaseUrl, truncateAll } from "@/test/db";
import { FakeStripe } from "@/test/fake-stripe";

/**
 * Fase 5 a través de las rutas (RF-07, RN-10, RN-11, SDD §7.4, §7.5, §12.3): `POST /api/checkout`
 * con un Stripe en memoria y `POST /api/webhooks/stripe` con firmas reales del SDK de Stripe.
 */

let fake = new FakeStripe();
vi.mock("@/lib/stripe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/stripe")>()),
  getStripe: () => (stripeEnabled ? fake.asStripe() : null),
}));
let stripeEnabled = true;

type Sent = { kind: string; input: Record<string, unknown> };
const sent: Sent[] = [];
const record = (kind: string) => async (input: Record<string, unknown>) => {
  sent.push({ kind, input });
  return { mode: "console" };
};
vi.mock("@/services/email.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/email.service")>()),
  sendTransferPendingEmail: record("transfer_pending"),
  sendPurchaseConfirmationEmail: record("purchase_confirmation"),
  sendWelcomeEmail: record("welcome"),
  sendPaymentReceivedEmail: record("payment_received"),
  sendPaymentNotCompletedEmail: record("payment_not_completed"),
  sendExtraPaymentAlertEmail: record("extra_payment_alert"),
}));

const checkoutRoute = await import("../checkout/route");
const transfersRoute = await import("../transfers/route");
const webhookRoute = await import("../webhooks/stripe/route");

const WEBHOOK_SECRET = "whsec_test_secret_for_phase5";
const COOKIE = "hm_verification";
const EMAIL = "ana@example.com";
let ipCounter = 0;

function request(path: string, init: { body?: unknown; email?: string } = {}) {
  const headers = new Headers({ "content-type": "application/json" });
  headers.set("x-forwarded-for", `10.5.0.${++ipCounter % 250}`);
  if (init.email) {
    headers.set("cookie", `${COOKIE}=${createVerificationSessionToken(init.email).token}`);
  }
  return new NextRequest(`http://localhost:3000${path}`, {
    method: "POST",
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

const checkout = (program = "hm-run", extra: Record<string, unknown> = {}, email = EMAIL) =>
  checkoutRoute.POST(
    request("/api/checkout", { body: application(program, { mode: "payment", ...extra }), email }),
  );

let eventSeq = 0;
function stripeEvent(
  type: string,
  object: unknown,
  options: { id?: string; created?: Date } = {},
): Stripe.Event {
  return {
    id: options.id ?? `evt_test_${++eventSeq}`,
    object: "event",
    type,
    api_version: Stripe.API_VERSION,
    created: Math.floor((options.created ?? new Date()).getTime() / 1000),
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    data: { object },
  } as unknown as Stripe.Event;
}

function webhook(
  event: Stripe.Event | string,
  options: { secret?: string; signature?: string | null } = {},
) {
  const payload = typeof event === "string" ? event : JSON.stringify(event);
  const signature =
    options.signature === undefined
      ? Stripe.webhooks.generateTestHeaderString({
          payload,
          secret: options.secret ?? WEBHOOK_SECRET,
        })
      : options.signature;
  const headers = new Headers({ "content-type": "application/json" });
  if (signature !== null) headers.set("stripe-signature", signature);
  return webhookRoute.POST(
    new NextRequest("http://localhost:3000/api/webhooks/stripe", {
      method: "POST",
      headers,
      body: payload,
    }),
  );
}

describe.skipIf(!testDatabaseUrl)("API de la Fase 5 (Stripe) con PostgreSQL", () => {
  const prisma = testDatabaseUrl ? createTestPrisma() : (undefined as never);

  beforeAll(() => {
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.STRIPE_SECRET_KEY = "sk_test_phase5";
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_test_phase5";
    resetConfigCache();
  });
  beforeEach(async () => {
    await truncateAll(prisma);
    await syncProgramCatalog(prisma);
    fake = new FakeStripe();
    stripeEnabled = true;
    await syncStripeCatalog(fake.asStripe(), prisma);
    sent.length = 0;
  });
  afterAll(async () => {
    delete process.env.DATABASE_URL;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    resetConfigCache();
    await prisma.$disconnect();
  });

  /** Crea un Checkout y devuelve el contrato y la sesión guardada. */
  async function openCheckout(program = "hm-run", email = EMAIL) {
    const res = await checkout(program, {}, email);
    expect(res.status).toBe(201);
    const body = await res.json();
    const contract = await prisma.contract.findUniqueOrThrow({
      where: { reference: body.reference },
    });
    return { body, contract, sessionId: contract.stripeCheckoutSessionId! };
  }

  const paid = (sessionId: string, paymentStatus: "paid" | "unpaid" = "paid") =>
    fake.completeSession(sessionId, paymentStatus);

  describe("stripe:sync", () => {
    it("crea un Product y dos Prices por programa, guarda sus IDs y es idempotente", async () => {
      const programs = await prisma.program.findMany({ orderBy: { displayOrder: "asc" } });
      expect(programs.every((p) => p.stripePriceIdOneTime && p.stripePriceIdRecurring)).toBe(true);
      const run = programs.find((p) => p.slug === "hm-run")!;
      expect(fake.prices.get(run.stripePriceIdOneTime!)).toMatchObject({
        unit_amount: 120000,
        currency: "mxn",
        type: "one_time",
        lookup_key: "hm-run_one_time",
      });
      expect(fake.prices.get(run.stripePriceIdRecurring!)).toMatchObject({
        unit_amount: 108000,
        type: "recurring",
      });

      const again = await syncStripeCatalog(fake.asStripe(), prisma);
      expect(again.flatMap((p) => p.prices).every((p) => p.action === "kept")).toBe(true);
      expect(fake.prices.size).toBe(6);
    });

    it("si cambia un precio, crea un Price nuevo y archiva el anterior", async () => {
      const before = await prisma.program.findUniqueOrThrow({ where: { slug: "hm-run" } });
      await prisma.program.update({
        where: { slug: "hm-run" },
        data: { monthlyPrice: "1300.00", subscriptionPrice: "1170.00" },
      });
      await syncStripeCatalog(fake.asStripe(), prisma);
      const after = await prisma.program.findUniqueOrThrow({ where: { slug: "hm-run" } });
      expect(after.stripePriceIdOneTime).not.toBe(before.stripePriceIdOneTime);
      expect(fake.prices.get(after.stripePriceIdOneTime!)?.unit_amount).toBe(130000);
      expect(fake.prices.get(before.stripePriceIdOneTime!)?.active).toBe(false);
    });
  });

  describe("POST /api/checkout", () => {
    it("exige la sesión de verificación (no crea contratos sin OTP)", async () => {
      const res = await checkoutRoute.POST(
        request("/api/checkout", { body: application("hm-run", { mode: "payment" }) }),
      );
      expect(res.status).toBe(401);
      expect(await prisma.contract.count()).toBe(0);
    });

    it("crea el contrato y la sesión con el Price de la BD; ignora importes del navegador", async () => {
      const res = await checkout("hm-strength", {
        amount: "1.00",
        price: "price_hacked",
        priceId: "price_hacked",
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body).toMatchObject({
        success: true,
        outcome: "created",
        status: "pending_payment",
        amount: "1500.00",
        program: { slug: "hm-strength" },
      });
      expect(body.clientSecret).toMatch(/_secret_test$/);
      expect(body.publishableKey).toBe("pk_test_phase5");
      expect(body.returnUrl).toBe("http://localhost:3000/pago/exito");

      const contract = await prisma.contract.findUniqueOrThrow({
        where: { reference: body.reference },
        include: { customer: true, program: true },
      });
      expect(contract.paymentType).toBe("one_time");
      const session = fake.sessions.get(contract.stripeCheckoutSessionId!)!;
      expect(session.params).toMatchObject({
        mode: "payment",
        line_items: [{ price: contract.program.stripePriceIdOneTime, quantity: 1 }],
        client_reference_id: contract.id,
        metadata: { contractId: contract.id, reference: contract.reference },
        ui_mode: "form",
        integration_identifier: "custom_embedded_web_0002",
        billing_address_collection: "auto",
        saved_payment_method_options: { payment_method_save: "enabled" },
      });
      // El nombre ya está en el registro: el formulario de pago no lo vuelve a pedir.
      expect(session.params).not.toHaveProperty("name_collection");
      expect(session.amount_total).toBe(150000);
      // El cliente de Stripe se crea una vez y se guarda.
      expect(contract.customer.stripeCustomerId).toBe(session.customer);
      expect(fake.customersById.get(session.customer!)?.email).toBe(EMAIL);
    });

    it("un doble envío reutiliza el contrato y la misma sesión abierta", async () => {
      const first = await openCheckout();
      const again = await checkout();
      expect(again.status).toBe(200);
      const body = await again.json();
      expect(body).toMatchObject({ reference: first.body.reference, outcome: "reused" });
      expect(body.clientSecret).toBe(first.body.clientSecret);
      expect(fake.calls.sessionCreate).toBe(1);
      expect(fake.calls.customerCreate).toBe(1);
    });

    it("no reutiliza una sesión abierta del formulario anterior (embedded_page)", async () => {
      const first = await openCheckout();
      fake.sessions.get(first.sessionId)!.ui_mode = "embedded_page";
      const again = await (await checkout()).json();
      expect(again.reference).toBe(first.body.reference);
      expect(again.clientSecret).not.toBe(first.body.clientSecret);
      expect(fake.sessions.get(first.sessionId)?.status).toBe("expired");
    });

    it("si la sesión anterior venció, abre otra con la misma referencia", async () => {
      const first = await openCheckout();
      await fake.checkout.sessions.expire(first.sessionId);
      const again = await (await checkout()).json();
      expect(again.reference).toBe(first.body.reference);
      expect(again.clientSecret).not.toBe(first.body.clientSecret);
      expect(fake.calls.sessionCreate).toBe(2);
    });

    it("no abre otra sesión si la anterior ya se pagó y Stripe todavía no avisa (409)", async () => {
      const first = await openCheckout();
      paid(first.sessionId, "unpaid"); // p. ej. OXXO generado, sin pagar todavía
      const res = await checkout();
      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe("payment_in_progress");
      expect(fake.calls.sessionCreate).toBe(1);
    });

    it("sin Stripe configurado o con un Price distinto responde 503 y no crea el contrato", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      stripeEnabled = false;
      const noStripe = await checkout();
      expect(noStripe.status).toBe(503);
      expect((await noStripe.json()).error).toBe("payments_unavailable");

      stripeEnabled = true;
      const program = await prisma.program.findUniqueOrThrow({ where: { slug: "hm-run" } });
      fake.prices.get(program.stripePriceIdOneTime!)!.unit_amount = 100; // alguien lo cambió en Stripe
      const mismatch = await checkout();
      expect(mismatch.status).toBe(503);
      expect(await prisma.contract.count()).toBe(0);
      expect(fake.calls.sessionCreate).toBe(0);
    });

    it("sin clave publicable, o con claves de modos distintos, responde 503", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      try {
        delete process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
        resetConfigCache();
        expect((await checkout()).status).toBe(503);
        process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_live_phase5";
        resetConfigCache();
        expect((await checkout()).status).toBe(503);
        expect(await prisma.contract.count()).toBe(0);
      } finally {
        process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_test_phase5";
        resetConfigCache();
      }
    });

    it("si Stripe falla al crear la sesión responde 503 y el pendiente se conserva", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      fake.failSessionCreate = new Error("boom");
      const res = await checkout();
      expect(res.status).toBe(503);
      expect(await prisma.contract.count({ where: { status: "pending_payment" } })).toBe(1);
    });

    it("rechaza la suscripción (Fase 6) y modalidades desconocidas", async () => {
      expect((await checkout("hm-run", { mode: "subscription" })).status).toBe(400);
      expect((await checkout("hm-run", { mode: "gratis" })).status).toBe(400);
    });

    it("con un pendiente por transferencia pregunta, y al cambiarlo invalida el enlace de Ferro", async () => {
      const created = await transfersRoute.POST(
        request("/api/transfers", { body: application("hm-run"), email: EMAIL }),
      );
      const { reference } = await created.json();

      const conflict = await checkout("hm-run");
      expect(conflict.status).toBe(409);
      expect(await conflict.json()).toMatchObject({
        error: "pending_contract_exists",
        pending: { reference, paymentType: "transfer" },
      });

      const cont = await checkout("hm-run", { pendingAction: "continue" });
      expect(cont.status).toBe(409);
      expect((await cont.json()).message).toMatch(/Cambiar/);

      const changed = await checkout("hm-run", { pendingAction: "change" });
      expect(changed.status).toBe(200);
      expect(await changed.json()).toMatchObject({ reference, outcome: "changed" });
      const contract = await prisma.contract.findUniqueOrThrow({ where: { reference } });
      expect(contract.paymentType).toBe("one_time");
      expect(
        await prisma.transferApproval.count({
          where: { contractId: contract.id, invalidatedAt: null },
        }),
      ).toBe(0);
    });

    it("cambiar un pendiente con tarjeta a transferencia expira la sesión en Stripe", async () => {
      const first = await openCheckout("hm-run");
      const res = await transfersRoute.POST(
        request("/api/transfers", {
          body: application("hm-run", { pendingAction: "change" }),
          email: EMAIL,
        }),
      );
      expect(res.status).toBe(200);
      expect(fake.sessions.get(first.sessionId)?.status).toBe("expired");
      const contract = await prisma.contract.findUniqueOrThrow({
        where: { id: first.contract.id },
      });
      expect(contract).toMatchObject({ paymentType: "transfer", stripeCheckoutSessionId: null });
    });

    it("cambiar de programa expira la sesión anterior y abre una con el Price nuevo", async () => {
      const first = await openCheckout("hm-run");
      const res = await checkout("hm-complete", { pendingAction: "change" });
      const body = await res.json();
      expect(body).toMatchObject({ outcome: "changed", amount: "1800.00" });
      expect(fake.sessions.get(first.sessionId)?.status).toBe("expired");
      const contract = await prisma.contract.findUniqueOrThrow({
        where: { id: first.contract.id },
      });
      expect(fake.sessions.get(contract.stripeCheckoutSessionId!)?.amount_total).toBe(180000);
    });
  });

  describe("POST /api/webhooks/stripe: firma", () => {
    it("rechaza una firma inválida, sin firma o de otro secreto (400) sin registrar nada", async () => {
      const event = stripeEvent("checkout.session.completed", {});
      expect((await webhook(event, { signature: null })).status).toBe(400);
      expect((await webhook(event, { signature: "t=1,v1=deadbeef" })).status).toBe(400);
      expect((await webhook(event, { secret: "whsec_otro" })).status).toBe(400);
      // Body alterado después de firmar.
      const payload = JSON.stringify(event);
      const signature = Stripe.webhooks.generateTestHeaderString({
        payload,
        secret: WEBHOOK_SECRET,
      });
      expect((await webhook(payload.replace("evt_", "evt_x"), { signature })).status).toBe(400);
      expect(await prisma.webhookEvent.count()).toBe(0);
    });

    it("sin STRIPE_WEBHOOK_SECRET responde 503", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      delete process.env.STRIPE_WEBHOOK_SECRET;
      resetConfigCache();
      try {
        expect((await webhook(stripeEvent("checkout.session.completed", {}))).status).toBe(503);
      } finally {
        process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
        resetConfigCache();
      }
    });

    it("ignora los eventos que no escucha (A6) y responde 200", async () => {
      const res = await webhook(stripeEvent("payment_intent.succeeded", { id: "pi_x" }));
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ status: "ignored" });
      expect(await prisma.webhookEvent.findFirst()).toMatchObject({ status: "ignored" });
    });
  });

  describe("POST /api/webhooks/stripe: pago único", () => {
    it("checkout.session.completed (paid) activa el contrato, registra el pago y avisa", async () => {
      const { contract, sessionId } = await openCheckout("hm-run");
      const session = paid(sessionId);
      const res = await webhook(stripeEvent("checkout.session.completed", session));
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ status: "processed" });

      const after = await prisma.contract.findUniqueOrThrow({
        where: { id: contract.id },
        include: { payments: true, servicePeriods: { include: { deliveryLinks: true } } },
      });
      expect(after.status).toBe("active");
      expect(after.payments).toHaveLength(1);
      expect(after.payments[0]).toMatchObject({
        method: "stripe_one_time",
        status: "succeeded",
        stripePaymentIntentId: session.payment_intent,
        currency: "MXN",
      });
      expect(after.payments[0]!.amount.toFixed(2)).toBe("1200.00");
      expect(after.servicePeriods).toHaveLength(1);
      expect(after.servicePeriods[0]!.deliveryLinks).toHaveLength(1);
      expect(after.serviceEndDate!.getTime()).toBeGreaterThan(after.serviceStartDate!.getTime());

      expect(sent.map((s) => s.kind)).toEqual([
        "purchase_confirmation",
        "welcome",
        "payment_received",
      ]);
      const received = sent.find((s) => s.kind === "payment_received")!.input;
      expect(received).toMatchObject({
        reference: contract.reference,
        method: "Pago único con tarjeta (Stripe)",
      });
      expect(String(received.deliveryUrl)).toMatch(/\/plan\/entrega\//);
      expect(
        await prisma.auditLog.count({
          where: { action: "stripe.payment_succeeded", entityId: contract.id },
        }),
      ).toBe(1);
    });

    it("un evento repetido responde 200 sin duplicar pagos, meses ni correos", async () => {
      const { contract, sessionId } = await openCheckout();
      const event = stripeEvent("checkout.session.completed", paid(sessionId));
      await webhook(event);
      const again = await webhook(event);
      expect(again.status).toBe(200);
      expect(await again.json()).toMatchObject({ status: "duplicate" });
      expect(await prisma.payment.count({ where: { contractId: contract.id } })).toBe(1);
      expect(await prisma.servicePeriod.count({ where: { contractId: contract.id } })).toBe(1);
      expect(sent.filter((s) => s.kind === "payment_received")).toHaveLength(1);
    });

    it("entregas simultáneas del mismo evento se aplican una sola vez", async () => {
      const { contract, sessionId } = await openCheckout();
      const event = stripeEvent("checkout.session.completed", paid(sessionId));
      const results = await Promise.all([webhook(event), webhook(event), webhook(event)]);
      expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
      expect(await prisma.payment.count({ where: { contractId: contract.id } })).toBe(1);
    });

    it("el mismo pago en otro evento (completed + async_payment_succeeded) no se duplica", async () => {
      const { contract, sessionId } = await openCheckout();
      const session = paid(sessionId);
      await webhook(stripeEvent("checkout.session.completed", session));
      const res = await webhook(stripeEvent("checkout.session.async_payment_succeeded", session));
      expect(await res.json()).toMatchObject({ status: "processed" });
      expect(await prisma.payment.count({ where: { contractId: contract.id } })).toBe(1);
    });

    it("pago asíncrono: espera con `unpaid` y activa con async_payment_succeeded, aun fuera de orden", async () => {
      const { contract, sessionId } = await openCheckout();
      const pending = paid(sessionId, "unpaid");
      const succeeded = { ...pending, payment_status: "paid" };

      // Llega primero el éxito y después el `completed` (unpaid) más viejo.
      await webhook(stripeEvent("checkout.session.async_payment_succeeded", succeeded));
      await webhook(stripeEvent("checkout.session.completed", pending));
      const after = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
      expect(after.status).toBe("active");
      expect(await prisma.payment.count({ where: { contractId: contract.id } })).toBe(1);
    });

    it("con `unpaid` el contrato sigue pendiente y la página de éxito no activa nada", async () => {
      const { contract, sessionId } = await openCheckout();
      await webhook(stripeEvent("checkout.session.completed", paid(sessionId, "unpaid")));
      const after = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
      expect(after.status).toBe("pending_payment");
      expect(await prisma.payment.count()).toBe(0);
      expect(sent).toHaveLength(0);
    });

    it("async_payment_failed registra el pago fallido, deja el pendiente y permite reintentar", async () => {
      const { contract, sessionId } = await openCheckout();
      const session = paid(sessionId, "unpaid");
      await webhook(stripeEvent("checkout.session.async_payment_failed", session));

      const after = await prisma.contract.findUniqueOrThrow({
        where: { id: contract.id },
        include: { payments: true },
      });
      expect(after.status).toBe("pending_payment");
      expect(after.stripeCheckoutSessionId).toBeNull();
      expect(after.payments).toMatchObject([{ status: "failed", paidAt: null }]);
      expect(sent.map((s) => s.kind)).toEqual(["payment_not_completed"]);

      // El siguiente intento abre otra sesión con la misma referencia.
      const retry = await (await checkout()).json();
      expect(retry.reference).toBe(contract.reference);
      expect(fake.calls.sessionCreate).toBe(2);
    });

    it("respeta un pago tardío sobre un contrato vencido y lo audita (A20)", async () => {
      const { contract, sessionId } = await openCheckout();
      await prisma.contract.update({ where: { id: contract.id }, data: { status: "expired" } });
      await webhook(stripeEvent("checkout.session.completed", paid(sessionId)));
      const after = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
      expect(after.status).toBe("active");
      expect(
        await prisma.auditLog.count({
          where: { action: "contract.paid_after_expiry", entityId: contract.id },
        }),
      ).toBe(1);
    });

    it("mes con mes: con un mes vigente no abre otro Checkout (409 active_period, A28)", async () => {
      const { contract, sessionId } = await openCheckout("hm-run");
      await webhook(stripeEvent("checkout.session.completed", paid(sessionId)));
      const res = await checkout("hm-strength");
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body).toMatchObject({ error: "active_period" });
      const active = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
      expect(body.activeUntil).toBe(active.serviceEndDate!.toISOString());
      expect(fake.calls.sessionCreate).toBe(1);
    });

    it("un pago tardío con un mes vigente queda `scheduled` y empieza al terminar el vigente", async () => {
      // El cliente dejó vencer un Checkout, contrató y pagó otro, y después Stripe confirma el
      // primero (p. ej. un pago lento): se respeta (A20) y empieza al terminar el mes vigente.
      const late = await openCheckout("hm-run");
      await prisma.contract.update({
        where: { id: late.contract.id },
        data: { status: "expired" },
      });
      const current = await openCheckout("hm-strength");
      await webhook(stripeEvent("checkout.session.completed", paid(current.sessionId)));
      const active = await prisma.contract.findUniqueOrThrow({
        where: { id: current.contract.id },
      });

      await webhook(stripeEvent("checkout.session.completed", paid(late.sessionId)));
      const next = await prisma.contract.findUniqueOrThrow({ where: { id: late.contract.id } });
      expect(next.status).toBe("scheduled");
      expect(next.serviceStartDate!.toISOString()).toBe(active.serviceEndDate!.toISOString());
      const confirmation = sent.filter((s) => s.kind === "purchase_confirmation").at(-1)!;
      expect(confirmation.input.startsLater).toBe(true);
    });

    it("un cobro de un contrato ya pagado no abre otro mes y avisa a Ferro", async () => {
      const { contract, sessionId } = await openCheckout();
      await webhook(stripeEvent("checkout.session.completed", paid(sessionId)));
      // Otra sesión del mismo contrato que también se pagó (p. ej. dos pestañas).
      const other = await fake.checkout.sessions.create({
        mode: "payment",
        line_items: [{ price: [...fake.prices.keys()][0]!, quantity: 1 }],
        client_reference_id: contract.id,
        metadata: { contractId: contract.id, reference: contract.reference },
      });
      await webhook(stripeEvent("checkout.session.completed", paid(other.id)));
      expect(await prisma.payment.count({ where: { contractId: contract.id } })).toBe(2);
      expect(await prisma.servicePeriod.count({ where: { contractId: contract.id } })).toBe(1);
      expect(sent.at(-1)?.kind).toBe("extra_payment_alert");
    });

    it("un evento de un contrato inexistente se marca `failed` y responde 200 (no se reintenta)", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const res = await webhook(
        stripeEvent("checkout.session.completed", {
          id: "cs_test_ajeno",
          object: "checkout.session",
          mode: "payment",
          payment_status: "paid",
          metadata: { contractId: "00000000-0000-4000-8000-000000000000" },
          client_reference_id: null,
          payment_intent: "pi_test_ajeno",
          amount_total: 120000,
          currency: "mxn",
        }),
      );
      expect(res.status).toBe(200);
      expect(await prisma.webhookEvent.findFirst()).toMatchObject({
        status: "failed",
        error: "contract_not_found",
      });
    });

    it("si el procesamiento falla responde 500, revierte todo y el reintento de Stripe sí aplica", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const { contract, sessionId } = await openCheckout();
      const event = stripeEvent("checkout.session.completed", paid(sessionId));

      // Un Payment con el mismo Payment Intent en otro estado provoca un error de UNIQUE.
      const intent = fake.sessions.get(sessionId)!.payment_intent!;
      const blocker = await prisma.payment.create({
        data: {
          contractId: contract.id,
          method: "stripe_one_time",
          stripePaymentIntentId: intent,
          amount: "1200.00",
          currency: "MXN",
          status: "pending",
        },
      });
      const failed = await webhook(event);
      expect(failed.status).toBe(500);
      expect(await prisma.webhookEvent.findFirst()).toMatchObject({ status: "failed" });
      expect((await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).status).toBe(
        "pending_payment",
      );

      await prisma.payment.delete({ where: { id: blocker.id } });
      const retried = await webhook(event);
      expect(retried.status).toBe(200);
      expect((await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).status).toBe(
        "active",
      );
      expect(await prisma.webhookEvent.findFirst()).toMatchObject({ status: "processed" });
    });

    it("una suscripción (Fase 6) se ignora por ahora", async () => {
      const res = await webhook(
        stripeEvent("checkout.session.completed", {
          id: "cs_test_sub",
          object: "checkout.session",
          mode: "subscription",
          payment_status: "paid",
          metadata: {},
        }),
      );
      expect(await res.json()).toMatchObject({ status: "ignored" });
    });
  });
});
