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
 * Fase 6 a través de las rutas (RF-08, RF-17, RF-18, RN-03, RN-14, SDD §7.4, §7.5, §8.3, §12):
 * `POST /api/checkout` en modo `subscription` y los webhooks de la suscripción con firmas reales del
 * SDK. El Stripe en memoria hace de "test clock": crea la suscripción y factura cada mes.
 */

let fake = new FakeStripe();
let stripeEnabled = true;
vi.mock("@/lib/stripe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/stripe")>()),
  getStripe: () => (stripeEnabled ? fake.asStripe() : null),
}));

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
  sendRenewalSuccessfulEmail: record("renewal_successful"),
  sendSubscriptionRenewedEmail: record("subscription_renewed"),
  sendPaymentFailedEmail: record("payment_failed"),
  sendPaymentFailedAlertEmail: record("payment_failed_alert"),
  sendSubscriptionEndedEmail: record("subscription_ended"),
  sendSubscriptionChangeAlertEmail: record("subscription_change_alert"),
  sendSubscriptionCancellationScheduledEmail: record("subscription_cancellation_scheduled"),
  sendSubscriptionCancellationRevertedEmail: record("subscription_cancellation_reverted"),
  sendSubscriptionPlanChangedEmail: record("subscription_plan_changed"),
}));

const checkoutRoute = await import("../checkout/route");
const transfersRoute = await import("../transfers/route");
const webhookRoute = await import("../webhooks/stripe/route");

const WEBHOOK_SECRET = "whsec_test_secret_for_phase6";
const COOKIE = "hm_verification";
const EMAIL = "sofia@example.com";
let ipCounter = 0;

function request(path: string, init: { body?: unknown; email?: string } = {}) {
  const headers = new Headers({ "content-type": "application/json" });
  headers.set("x-forwarded-for", `10.6.0.${++ipCounter % 250}`);
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
  fullName: "Sofía Ramírez",
  whatsapp: { country: "MX", number: "55 8765 4321" },
  program,
  privacyAccepted: true,
  ...extra,
});

const checkout = (program = "hm-run", extra: Record<string, unknown> = {}) =>
  checkoutRoute.POST(
    request("/api/checkout", {
      body: application(program, { mode: "subscription", ...extra }),
      email: EMAIL,
    }),
  );

let eventSeq = 0;
function stripeEvent(type: string, object: unknown, options: { id?: string } = {}): Stripe.Event {
  return {
    id: options.id ?? `evt_test6_${++eventSeq}`,
    object: "event",
    type,
    api_version: Stripe.API_VERSION,
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    data: { object },
  } as unknown as Stripe.Event;
}

async function webhook(event: Stripe.Event) {
  const payload = JSON.stringify(event);
  const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  const res = await webhookRoute.POST(
    new NextRequest("http://localhost:3000/api/webhooks/stripe", {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": signature },
      body: payload,
    }),
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const kinds = () => sent.map((s) => s.kind);

describe.skipIf(!testDatabaseUrl)("API de la Fase 6 (suscripciones) con PostgreSQL", () => {
  const prisma = testDatabaseUrl ? createTestPrisma() : (undefined as never);

  beforeAll(() => {
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.STRIPE_SECRET_KEY = "sk_test_phase6";
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_test_phase6";
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

  /** Abre el Checkout de la suscripción y devuelve el contrato y su sesión. */
  async function openSubscription(program = "hm-run") {
    const res = await checkout(program);
    expect(res.status).toBe(201);
    const body = await res.json();
    const contract = await prisma.contract.findUniqueOrThrow({
      where: { reference: body.reference },
    });
    return { body, contract, sessionId: contract.stripeCheckoutSessionId! };
  }

  /** El cliente paga y Stripe manda los eventos del alta en el orden habitual. */
  async function subscribe(program = "hm-run") {
    const opened = await openSubscription(program);
    const started = fake.startSubscription(opened.sessionId);
    expect((await webhook(stripeEvent("checkout.session.completed", started.session))).status).toBe(
      200,
    );
    expect(
      (await webhook(stripeEvent("customer.subscription.created", started.subscription))).status,
    ).toBe(200);
    const paid = await webhook(stripeEvent("invoice.paid", started.invoice));
    expect(paid.body).toMatchObject({ status: "processed" });
    return { ...opened, ...started, subscriptionId: started.subscription.id };
  }

  const contractOf = (id: string) => prisma.contract.findUniqueOrThrow({ where: { id } });

  describe("POST /api/checkout (mode: subscription)", () => {
    it("crea un contrato de suscripción con el Price recurrente y el importe con descuento", async () => {
      const res = await checkout("hm-strength", { amount: "1.00", priceId: "price_hacked" });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body).toMatchObject({
        mode: "subscription",
        outcome: "created",
        status: "pending_payment",
        amount: "1350.00",
        program: { slug: "hm-strength" },
      });
      const contract = await prisma.contract.findUniqueOrThrow({
        where: { reference: body.reference },
        include: { program: true },
      });
      expect(contract.paymentType).toBe("subscription");
      expect(contract.amount.toFixed(2)).toBe("1350.00");
      const session = fake.sessions.get(contract.stripeCheckoutSessionId!)!;
      expect(session.params).toMatchObject({
        mode: "subscription",
        line_items: [{ price: contract.program.stripePriceIdRecurring, quantity: 1 }],
        client_reference_id: contract.id,
        metadata: { contractId: contract.id, reference: contract.reference },
        subscription_data: { metadata: { contractId: contract.id } },
        ui_mode: "form",
      });
      // Solo existen en modo `payment`.
      expect(session.params).not.toHaveProperty("payment_intent_data");
      expect(session.params).not.toHaveProperty("saved_payment_method_options");
      expect(session.amount_total).toBe(135000);
    });

    it("con un Price recurrente distinto en Stripe responde 503 y no crea el contrato", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const program = await prisma.program.findUniqueOrThrow({ where: { slug: "hm-run" } });
      fake.prices.get(program.stripePriceIdRecurring!)!.unit_amount = 120000; // sin descuento
      const res = await checkout();
      expect(res.status).toBe(503);
      expect(await prisma.contract.count()).toBe(0);
    });

    it("un pendiente de pago único pregunta; al cambiar expira su sesión y abre una de suscripción", async () => {
      const first = await checkoutRoute.POST(
        request("/api/checkout", {
          body: application("hm-run", { mode: "payment" }),
          email: EMAIL,
        }),
      );
      const { reference } = await first.json();
      const oneTime = await prisma.contract.findUniqueOrThrow({ where: { reference } });

      const conflict = await checkout();
      expect(conflict.status).toBe(409);
      expect(await conflict.json()).toMatchObject({
        error: "pending_contract_exists",
        pending: { reference, paymentType: "one_time" },
      });
      expect((await checkout("hm-run", { pendingAction: "continue" })).status).toBe(409);

      const changed = await checkout("hm-run", { pendingAction: "change" });
      expect(await changed.json()).toMatchObject({
        reference,
        outcome: "changed",
        amount: "1080.00",
      });
      expect(fake.sessions.get(oneTime.stripeCheckoutSessionId!)?.status).toBe("expired");
      const contract = await prisma.contract.findUniqueOrThrow({ where: { reference } });
      expect(contract.paymentType).toBe("subscription");
      expect(fake.sessions.get(contract.stripeCheckoutSessionId!)?.mode).toBe("subscription");
    });
  });

  describe("alta de la suscripción", () => {
    it("checkout.session.completed solo liga la suscripción; invoice.paid crea el pago y activa", async () => {
      const opened = await openSubscription();
      const started = fake.startSubscription(opened.sessionId);

      await webhook(stripeEvent("checkout.session.completed", started.session));
      let contract = await contractOf(opened.contract.id);
      expect(contract.status).toBe("pending_payment");
      expect(await prisma.payment.count()).toBe(0);
      expect(await prisma.subscription.findFirst()).toMatchObject({
        contractId: contract.id,
        stripeSubscriptionId: started.subscription.id,
        status: "active",
      });
      expect(sent).toHaveLength(0);

      const res = await webhook(stripeEvent("invoice.paid", started.invoice));
      expect(res).toMatchObject({ status: 200, body: { status: "processed" } });
      contract = await contractOf(opened.contract.id);
      const line = started.invoice.lines.data[0]!;
      expect(contract.status).toBe("active");
      expect(contract.serviceStartDate?.getTime()).toBe(line.period.start * 1000);
      expect(contract.serviceEndDate?.getTime()).toBe(line.period.end * 1000);

      const subscription = await prisma.subscription.findFirstOrThrow();
      const payment = await prisma.payment.findFirstOrThrow();
      expect(payment).toMatchObject({
        method: "stripe_subscription",
        status: "succeeded",
        stripeInvoiceId: started.invoice.id,
        subscriptionId: subscription.id,
      });
      expect(payment.amount.toFixed(2)).toBe("1080.00");
      const period = await prisma.servicePeriod.findFirstOrThrow({
        include: { deliveryLinks: true },
      });
      expect(period).toMatchObject({ sequence: 1, paymentId: payment.id });
      expect(period.deliveryLinks).toHaveLength(1);

      expect(kinds()).toEqual(["purchase_confirmation", "welcome", "payment_received"]);
      expect(sent[0]!.input).toMatchObject({
        method: "Suscripción mensual con tarjeta",
        renewsMonthly: true,
      });
      expect(String(sent[2]!.input.deliveryUrl)).toMatch(/\/plan\/entrega\//);
    });

    it("tolera eventos fuera de orden: la factura antes que la sesión y un `created` viejo al final", async () => {
      const opened = await openSubscription();
      const started = fake.startSubscription(opened.sessionId);
      const staleCreated = { ...started.subscription, status: "incomplete" };

      await webhook(stripeEvent("invoice.paid", started.invoice));
      expect((await contractOf(opened.contract.id)).status).toBe("active");
      await webhook(stripeEvent("checkout.session.completed", started.session));
      await webhook(stripeEvent("customer.subscription.created", staleCreated));

      // El estado se lee de Stripe, no del evento: sigue activa.
      expect(await prisma.subscription.findFirst()).toMatchObject({ status: "active" });
      expect(await prisma.payment.count()).toBe(1);
      expect(await prisma.subscription.count()).toBe(1);
    });

    it("un evento repetido o la misma factura en otro evento no duplican nada", async () => {
      const { invoice } = await subscribe();
      const event = stripeEvent("invoice.paid", invoice, { id: "evt_dup_invoice" });
      expect((await webhook(event)).body).toMatchObject({ status: "processed" });
      expect((await webhook(event)).body).toMatchObject({ status: "duplicate" });
      expect(await prisma.payment.count()).toBe(1);
      expect(await prisma.servicePeriod.count()).toBe(1);
      expect(kinds().filter((k) => k === "welcome")).toHaveLength(1);
    });

    it("con la suscripción activa no se puede contratar otra cosa (409 subscription_active)", async () => {
      await subscribe();
      expect((await checkout("hm-complete")).status).toBe(409);
      const transfer = await transfersRoute.POST(
        request("/api/transfers", { body: application("hm-complete"), email: EMAIL }),
      );
      expect(transfer.status).toBe(409);
      expect((await transfer.json()).error).toBe("subscription_active");
    });

    it("si el primer cobro falla, el contrato sigue pendiente y no se avisa", async () => {
      const opened = await openSubscription();
      const started = fake.startSubscription(opened.sessionId);
      fake.subscriptionStore.get(started.subscription.id)!.status = "incomplete";
      const invoice = fake.invoices.get(started.invoice.id)!;
      invoice.status = "open";
      const failed = fake.failInvoice(invoice.id, "incomplete");
      expect((await webhook(stripeEvent("invoice.payment_failed", failed))).body).toMatchObject({
        status: "processed",
      });
      expect((await contractOf(opened.contract.id)).status).toBe("pending_payment");
      expect(await prisma.payment.findFirst()).toMatchObject({ status: "failed" });
      expect(sent).toHaveLength(0);

      // Stripe la da por terminada (`incomplete_expired`): se suelta la sesión para reintentar.
      fake.subscriptionStore.get(started.subscription.id)!.status = "incomplete_expired";
      await webhook(stripeEvent("customer.subscription.deleted", started.subscription));
      const contract = await contractOf(opened.contract.id);
      expect(contract).toMatchObject({ status: "pending_payment", stripeCheckoutSessionId: null });
      expect(await prisma.subscription.findFirst()).toMatchObject({ status: "canceled" });
      expect((await checkout()).status).toBe(200);
    });
  });

  describe("renovaciones (RF-08, RF-17)", () => {
    it("cada invoice.paid de renovación crea un Payment y un mes nuevos y extiende el contrato", async () => {
      const { contract, subscriptionId } = await subscribe();
      sent.length = 0;

      for (const month of [2, 3]) {
        const invoice = fake.nextInvoice(subscriptionId);
        const res = await webhook(stripeEvent("invoice.paid", fake.payInvoice(invoice.id)));
        expect(res.body).toMatchObject({ status: "processed" });
        const updated = await contractOf(contract.id);
        expect(updated.status).toBe("active");
        expect(updated.serviceStartDate?.getTime()).toBe(invoice.periodStart * 1000);
        expect(updated.serviceEndDate?.getTime()).toBe(invoice.periodEnd * 1000);
        const period = await prisma.servicePeriod.findFirstOrThrow({
          where: { contractId: contract.id, sequence: month },
          include: { deliveryLinks: true, payment: true },
        });
        expect(period.payment).toMatchObject({
          stripeInvoiceId: invoice.id,
          status: "succeeded",
        });
        expect(period.deliveryLinks).toHaveLength(1);
      }

      expect(await prisma.payment.count({ where: { status: "succeeded" } })).toBe(3);
      // Renovación: confirmación al cliente y Renewal Successful con botón a Ferro, sin bienvenida.
      expect(kinds()).toEqual([
        "subscription_renewed",
        "renewal_successful",
        "subscription_renewed",
        "renewal_successful",
      ]);
      expect(sent[1]!.input).toMatchObject({ monthNumber: 2, programName: "HM RUN" });
      expect(String(sent[1]!.input.deliveryUrl)).toMatch(/\/plan\/entrega\//);
    });

    it("una factura de importe 0 no abre un mes", async () => {
      const { subscriptionId } = await subscribe();
      const invoice = fake.nextInvoice(subscriptionId);
      invoice.amount = 0;
      const res = await webhook(stripeEvent("invoice.paid", fake.payInvoice(invoice.id)));
      expect(res.body).toMatchObject({ status: "processed" });
      expect(await prisma.servicePeriod.count()).toBe(1);
    });

    it("con un cambio de plan, el mes nuevo es del programa del Price cobrado", async () => {
      const { subscriptionId, contract } = await subscribe("hm-run");
      const complete = await prisma.program.findUniqueOrThrow({ where: { slug: "hm-complete" } });
      fake.subscriptionStore.get(subscriptionId)!.priceId = complete.stripePriceIdRecurring!;
      const sub = await fake.asStripe().subscriptions.retrieve(subscriptionId);
      await webhook(stripeEvent("customer.subscription.updated", sub));
      expect(await prisma.subscription.findFirst()).toMatchObject({ programId: complete.id });

      sent.length = 0;
      const invoice = fake.nextInvoice(subscriptionId);
      await webhook(stripeEvent("invoice.paid", fake.payInvoice(invoice.id)));
      const period = await prisma.servicePeriod.findFirstOrThrow({
        where: { contractId: contract.id, sequence: 2 },
        include: { payment: true },
      });
      expect(period.programId).toBe(complete.id);
      expect(period.payment.amount.toFixed(2)).toBe("1620.00");
      expect(sent.find((s) => s.kind === "renewal_successful")?.input).toMatchObject({
        programName: "HM COMPLETE",
      });
      expect(await prisma.auditLog.count({ where: { action: "stripe.amount_mismatch" } })).toBe(0);
    });
  });

  describe("pagos fallidos (RF-18, RN-14)", () => {
    it("suspende con el primer fallo, registra cada reintento y reactiva cuando se paga", async () => {
      const { contract, subscriptionId } = await subscribe();
      sent.length = 0;
      const invoice = fake.nextInvoice(subscriptionId);

      // Primer intento fallido: servicio suspendido y aviso al cliente y a Ferro.
      await webhook(stripeEvent("invoice.payment_failed", fake.failInvoice(invoice.id)));
      expect((await contractOf(contract.id)).status).toBe("payment_failed");
      expect(kinds()).toEqual(["payment_failed", "payment_failed_alert"]);
      expect(sent[0]!.input).toMatchObject({
        amount: "$1,080 MXN",
        payUrl: `https://invoice.stripe.test/i/${invoice.id}`,
      });
      await webhook(
        stripeEvent(
          "customer.subscription.updated",
          await fake.asStripe().subscriptions.retrieve(subscriptionId),
        ),
      );
      expect(await prisma.subscription.findFirst()).toMatchObject({ status: "past_due" });

      // Reintento del día siguiente: otro intento fallido se registra sin volver a avisar.
      await webhook(stripeEvent("invoice.payment_failed", fake.failInvoice(invoice.id)));
      expect(await prisma.payment.count({ where: { status: "failed" } })).toBe(2);
      expect(kinds()).toHaveLength(2);

      // El reintento se paga: vuelve a `active` con el periodo de la factura.
      await webhook(stripeEvent("invoice.paid", fake.payInvoice(invoice.id)));
      const reactivated = await contractOf(contract.id);
      expect(reactivated.status).toBe("active");
      expect(reactivated.serviceEndDate?.getTime()).toBe(invoice.periodEnd * 1000);
      expect(
        await prisma.payment.count({ where: { stripeInvoiceId: invoice.id, status: "succeeded" } }),
      ).toBe(1);
      expect(await prisma.servicePeriod.count({ where: { contractId: contract.id } })).toBe(2);
      expect(kinds().slice(2)).toEqual(["subscription_renewed", "renewal_successful"]);
    });

    it("un aviso de fallo que llega después del pago de la factura no suspende", async () => {
      const { contract, subscriptionId } = await subscribe();
      const invoice = fake.nextInvoice(subscriptionId);
      const failedAttempt = fake.failInvoice(invoice.id);
      await webhook(stripeEvent("invoice.paid", fake.payInvoice(invoice.id)));
      await webhook(stripeEvent("invoice.payment_failed", failedAttempt));
      expect((await contractOf(contract.id)).status).toBe("active");
    });

    it("3 días seguidos sin poder cobrar: se cancela la suscripción y el contrato (A32)", async () => {
      const { contract, subscriptionId } = await subscribe();
      sent.length = 0;
      const invoice = fake.nextInvoice(subscriptionId);

      // Día 1 y día 2: suspendido, con un solo aviso.
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const failed = fake.failInvoice(invoice.id);
        expect(failed.next_payment_attempt).not.toBeNull();
        await webhook(stripeEvent("invoice.payment_failed", failed));
        expect((await contractOf(contract.id)).status).toBe("payment_failed");
      }
      expect(kinds()).toEqual(["payment_failed", "payment_failed_alert"]);

      // Día 3: último intento. La app cancela en Stripe y el contrato queda cancelado.
      const last = fake.failInvoice(invoice.id);
      expect(last.next_payment_attempt).toBeNull();
      const res = await webhook(stripeEvent("invoice.payment_failed", last));
      expect(res.body).toMatchObject({ status: "processed" });
      expect((await contractOf(contract.id)).status).toBe("cancelled");
      expect(fake.calls.subscriptionCancel).toBe(1);
      expect(fake.subscriptionStore.get(subscriptionId)?.status).toBe("canceled");
      expect(await prisma.subscription.findFirst()).toMatchObject({ status: "canceled" });
      expect(await prisma.payment.count({ where: { status: "failed" } })).toBe(3);
      expect(
        await prisma.auditLog.findFirst({ where: { action: "subscription.cancelled" } }),
      ).toMatchObject({ metadata: { reason: "payment_attempts_exhausted" } });
      // Sin un aviso de "volveremos a intentar" después del último intento: solo Subscription
      // Cancelled por los cobros fallidos, al cliente y a Ferro (Fase 7, DECISIONS A33).
      expect(kinds()).toEqual([
        "payment_failed",
        "payment_failed_alert",
        "subscription_ended",
        "subscription_change_alert",
      ]);
      expect(sent[2]?.input).toMatchObject({ to: EMAIL, reason: "payment_failed" });
      expect(sent[3]?.input).toMatchObject({ kind: "ended", reason: "payment_failed" });

      // El aviso de Stripe de la cancelación no cambia nada más.
      const deleted = await fake.asStripe().subscriptions.retrieve(subscriptionId);
      await webhook(stripeEvent("customer.subscription.deleted", deleted));
      expect((await contractOf(contract.id)).status).toBe("cancelled");
      expect(await prisma.auditLog.count({ where: { action: "subscription.cancelled" } })).toBe(1);
      expect(kinds()).toHaveLength(4);

      // Ya puede contratar de nuevo.
      expect((await checkout("hm-run")).status).toBe(201);
    });

    it("si Stripe ya canceló la suscripción, no la vuelve a cancelar", async () => {
      const { contract, subscriptionId } = await subscribe();
      const invoice = fake.nextInvoice(subscriptionId);
      fake.failInvoice(invoice.id);
      fake.failInvoice(invoice.id);
      const last = fake.failInvoice(invoice.id);
      fake.cancelSubscription(subscriptionId); // configurado en el Dashboard
      await webhook(stripeEvent("invoice.payment_failed", last));
      expect((await contractOf(contract.id)).status).toBe("cancelled");
      expect(fake.calls.subscriptionCancel).toBe(0);
    });

    it("si Stripe cancela por su cuenta, customer.subscription.deleted cancela el contrato", async () => {
      const { contract, subscriptionId } = await subscribe();
      const invoice = fake.nextInvoice(subscriptionId);
      await webhook(stripeEvent("invoice.payment_failed", fake.failInvoice(invoice.id)));
      const cancelled = fake.cancelSubscription(subscriptionId);
      await webhook(stripeEvent("customer.subscription.deleted", cancelled));
      expect((await contractOf(contract.id)).status).toBe("cancelled");
    });
  });

  describe("casos raros", () => {
    it("una segunda suscripción del mismo contrato no abre otro mes y avisa a Ferro", async () => {
      const { contract, sessionId } = await subscribe();
      // Otra pestaña pagó otra sesión del mismo contrato.
      const twin = await fake.checkout.sessions.create(
        fake.sessions.get(sessionId)!.params as Stripe.Checkout.SessionCreateParams,
      );
      const duplicate = fake.startSubscription(twin.id);
      sent.length = 0;
      await webhook(stripeEvent("checkout.session.completed", duplicate.session));
      const res = await webhook(stripeEvent("invoice.paid", duplicate.invoice));
      expect(res.body).toMatchObject({ status: "processed" });
      expect(await prisma.subscription.count()).toBe(1);
      expect(await prisma.servicePeriod.count({ where: { contractId: contract.id } })).toBe(1);
      expect(kinds()).toEqual(["extra_payment_alert"]);
      expect(sent[0]!.input).toMatchObject({ duplicateSubscriptionId: duplicate.subscription.id });
    });

    it("sin Stripe configurado no puede sincronizar: responde 500 para que Stripe reintente", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const opened = await openSubscription();
      const started = fake.startSubscription(opened.sessionId);
      stripeEnabled = false;
      expect((await webhook(stripeEvent("invoice.paid", started.invoice))).status).toBe(500);
      expect((await contractOf(opened.contract.id)).status).toBe("pending_payment");
      stripeEnabled = true;
      expect((await webhook(stripeEvent("invoice.paid", started.invoice))).status).toBe(200);
      expect((await contractOf(opened.contract.id)).status).toBe("active");
    });

    it("una factura que no es de una suscripción se ignora", async () => {
      const res = await webhook(
        stripeEvent("invoice.paid", { id: "in_manual", object: "invoice", parent: null }),
      );
      expect(res.body).toMatchObject({ status: "ignored" });
    });
  });
});
