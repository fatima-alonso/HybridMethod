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
 * Fase 7 a través de las rutas (RF-14, RF-19, RN-08, SDD §7.7, §8.5, §12.3, DECISIONS A21, A33):
 * `POST /api/portal` y los webhooks de lo que el cliente hace en el Stripe Customer Portal
 * (cancelar al final del periodo, deshacerlo, cambiar de programa), con sus correos.
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
const portalRoute = await import("../portal/route");
const webhookRoute = await import("../webhooks/stripe/route");

const WEBHOOK_SECRET = "whsec_test_secret_for_phase7";
const COOKIE = "hm_verification";
const EMAIL = "sofia@example.com";
let ipCounter = 0;

function request(path: string, init: { body?: unknown; email?: string; ip?: string } = {}) {
  const headers = new Headers({ "content-type": "application/json" });
  headers.set("x-forwarded-for", init.ip ?? `10.7.0.${++ipCounter % 250}`);
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

const portal = (email?: string, ip?: string) =>
  portalRoute.POST(request("/api/portal", { email, ip }));

let eventSeq = 0;
function stripeEvent(type: string, object: unknown): Stripe.Event {
  return {
    id: `evt_test7_${++eventSeq}`,
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
const updated = (subscription: Stripe.Subscription) =>
  webhook(stripeEvent("customer.subscription.updated", subscription));

describe.skipIf(!testDatabaseUrl)("API de la Fase 7 (portal y cancelación) con PostgreSQL", () => {
  const prisma = testDatabaseUrl ? createTestPrisma() : (undefined as never);

  beforeAll(() => {
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.STRIPE_SECRET_KEY = "sk_test_phase7";
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_test_phase7";
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

  /** El cliente se suscribe y paga; Stripe manda los eventos del alta. */
  async function subscribe(program = "hm-run", email = EMAIL) {
    const res = await checkoutRoute.POST(
      request("/api/checkout", {
        body: application(program, { mode: "subscription" }),
        email,
      }),
    );
    expect(res.status).toBe(201);
    const { reference } = await res.json();
    const contract = await prisma.contract.findUniqueOrThrow({ where: { reference } });
    const started = fake.startSubscription(contract.stripeCheckoutSessionId!);
    await webhook(stripeEvent("checkout.session.completed", started.session));
    await webhook(stripeEvent("customer.subscription.created", started.subscription));
    await webhook(stripeEvent("invoice.paid", started.invoice));
    sent.length = 0;
    return { contract, subscriptionId: started.subscription.id };
  }

  const contractOf = (id: string) => prisma.contract.findUniqueOrThrow({ where: { id } });

  describe("POST /api/portal (RF-19, SDD §7.7)", () => {
    it("sin sesión de verificación responde 401", async () => {
      const res = await portal();
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ error: "verification_required" });
      expect(fake.calls.portalSessionCreate).toBe(0);
    });

    it("abre el portal del cliente de la sesión, con la landing como regreso", async () => {
      await subscribe();
      const customer = await prisma.customer.findUniqueOrThrow({ where: { email: EMAIL } });
      const res = await portal(EMAIL);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({
        success: true,
        url: expect.stringMatching(/^https:\/\/billing\.stripe\.test\/p\/session\//),
      });
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(fake.portalSessions).toEqual([
        {
          customer: customer.stripeCustomerId,
          return_url: "http://localhost:3000/",
          locale: "es-419",
        },
      ]);
      expect(
        await prisma.auditLog.findFirst({ where: { action: "portal.session_created" } }),
      ).toMatchObject({ actor: `customer:${customer.id}`, entityType: "Subscription" });
    });

    it("responde lo mismo si el correo no existe o si no tiene suscripción (sin revelar nada)", async () => {
      // Un cliente que pagó por transferencia: existe, pero no tiene suscripción.
      await transfersRoute.POST(
        request("/api/transfers", { body: application("hm-run"), email: "ana@example.com" }),
      );
      const withoutSubscription = await portal("ana@example.com");
      const unknown = await portal("nadie@example.com");
      expect(withoutSubscription.status).toBe(404);
      expect(unknown.status).toBe(404);
      expect(await withoutSubscription.json()).toEqual(await unknown.json());
      expect(fake.calls.portalSessionCreate).toBe(0);
    });

    it("la sesión de otro correo no abre el portal de este cliente", async () => {
      await subscribe();
      const res = await portal("otra@example.com");
      expect(res.status).toBe(404);
      expect(fake.calls.portalSessionCreate).toBe(0);
    });

    it("con un cobro pendiente también abre el portal (para actualizar la tarjeta)", async () => {
      const { subscriptionId } = await subscribe();
      const invoice = fake.nextInvoice(subscriptionId);
      await webhook(stripeEvent("invoice.payment_failed", fake.failInvoice(invoice.id)));
      expect(await prisma.subscription.findFirst()).toMatchObject({ status: "past_due" });
      expect((await portal(EMAIL)).status).toBe(200);
    });

    it("una suscripción que ya terminó no se administra", async () => {
      const { subscriptionId } = await subscribe();
      await webhook(
        stripeEvent(
          "customer.subscription.deleted",
          fake.cancelSubscription(subscriptionId, "cancellation_requested"),
        ),
      );
      expect((await portal(EMAIL)).status).toBe(404);
    });

    it("sin Stripe o si Stripe falla responde 503", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      await subscribe();
      fake.failPortalCreate = new Error("boom");
      const failed = await portal(EMAIL);
      expect(failed.status).toBe(503);
      expect(await failed.json()).toMatchObject({ error: "portal_unavailable" });
      stripeEnabled = false;
      expect((await portal(EMAIL)).status).toBe(503);
    });

    it("limita las solicitudes por IP (10 por hora)", async () => {
      await subscribe();
      for (let i = 0; i < 10; i += 1) {
        expect((await portal(EMAIL, "10.7.1.1")).status).toBe(200);
      }
      expect((await portal(EMAIL, "10.7.1.1")).status).toBe(429);
    });
  });

  describe("cancelación en el portal (RF-19, A33)", () => {
    it("al pedirla avisa al cliente y a Ferro; el servicio sigue hasta el final del periodo", async () => {
      const { contract, subscriptionId } = await subscribe();
      const before = await contractOf(contract.id);

      const res = await updated(fake.scheduleCancellation(subscriptionId));
      expect(res.body).toMatchObject({ status: "processed" });
      const after = await contractOf(contract.id);
      expect(after.status).toBe("active");
      expect(after.serviceEndDate).toEqual(before.serviceEndDate);
      expect(await prisma.subscription.findFirst()).toMatchObject({
        status: "active",
        cancelAtPeriodEnd: true,
      });

      expect(kinds()).toEqual(["subscription_cancellation_scheduled", "subscription_change_alert"]);
      expect(sent[0]?.input).toMatchObject({
        to: EMAIL,
        reference: contract.reference,
        programName: "HM RUN",
        manageUrl: "http://localhost:3000/suscripcion",
      });
      expect(sent[1]?.input).toMatchObject({
        kind: "cancellation_scheduled",
        customerEmail: EMAIL,
        endsOn: sent[0]?.input.endsOn,
      });

      // Otro evento con el mismo estado (o el mismo evento repetido) no repite el aviso.
      await updated(await fake.asStripe().subscriptions.retrieve(subscriptionId));
      expect(sent).toHaveLength(2);
    });

    it("también reconoce la cancelación con `cancel_at`", async () => {
      const { subscriptionId } = await subscribe();
      await updated(fake.scheduleCancellation(subscriptionId, { useCancelAt: true }));
      expect(kinds()).toEqual(["subscription_cancellation_scheduled", "subscription_change_alert"]);
    });

    it("deshacer la cancelación avisa que la suscripción sigue", async () => {
      const { subscriptionId } = await subscribe();
      await updated(fake.scheduleCancellation(subscriptionId));
      sent.length = 0;

      await updated(fake.undoCancellation(subscriptionId));
      expect(await prisma.subscription.findFirst()).toMatchObject({ cancelAtPeriodEnd: false });
      expect(kinds()).toEqual(["subscription_cancellation_reverted", "subscription_change_alert"]);
      expect(sent[1]?.input).toMatchObject({ kind: "cancellation_reverted" });
    });

    it("al final del periodo la suscripción termina: contrato cancelado y aviso de fin", async () => {
      const { contract, subscriptionId } = await subscribe();
      await updated(fake.scheduleCancellation(subscriptionId));
      sent.length = 0;
      const paidUntil = (await contractOf(contract.id)).serviceEndDate;
      expect(paidUntil).not.toBeNull();

      const deleted = fake.endScheduledCancellation(subscriptionId);
      await webhook(stripeEvent("customer.subscription.deleted", deleted));
      const after = await contractOf(contract.id);
      expect(after.status).toBe("cancelled");
      // No se recorta el periodo pagado.
      expect(after.serviceEndDate).toEqual(paidUntil);
      expect(kinds()).toEqual(["subscription_ended", "subscription_change_alert"]);
      expect(sent[0]?.input).toMatchObject({
        to: EMAIL,
        reason: "requested",
        rejoinUrl: "http://localhost:3000/#athlete-application",
      });
      expect(sent[1]?.input).toMatchObject({ kind: "ended", reason: "requested" });

      // Un aviso repetido de Stripe no vuelve a mandar nada.
      await webhook(stripeEvent("customer.subscription.deleted", deleted));
      expect(sent).toHaveLength(2);

      // Ya puede contratar de nuevo.
      const again = await checkoutRoute.POST(
        request("/api/checkout", {
          body: application("hm-run", { mode: "subscription" }),
          email: EMAIL,
        }),
      );
      expect(again.status).toBe(201);
    });

    it("si Stripe la cancela por los cobros fallidos, el aviso lo dice", async () => {
      const { subscriptionId } = await subscribe();
      const invoice = fake.nextInvoice(subscriptionId);
      await webhook(stripeEvent("invoice.payment_failed", fake.failInvoice(invoice.id)));
      sent.length = 0;
      await webhook(
        stripeEvent(
          "customer.subscription.deleted",
          fake.cancelSubscription(subscriptionId, "payment_failed"),
        ),
      );
      expect(kinds()).toEqual(["subscription_ended", "subscription_change_alert"]);
      expect(sent[0]?.input).toMatchObject({ reason: "payment_failed" });
    });
  });

  describe("cambio de programa en el portal (RN-08, A33)", () => {
    it("avisa al cliente y a Ferro; aplica en la siguiente renovación", async () => {
      const { contract, subscriptionId } = await subscribe("hm-run");
      const strength = await prisma.program.findUniqueOrThrow({ where: { slug: "hm-strength" } });

      await updated(fake.changePrice(subscriptionId, strength.stripePriceIdRecurring!));
      expect(await prisma.subscription.findFirst()).toMatchObject({ programId: strength.id });
      expect(kinds()).toEqual(["subscription_plan_changed", "subscription_change_alert"]);
      const subscription = await prisma.subscription.findFirstOrThrow();
      expect(sent[0]?.input).toMatchObject({
        to: EMAIL,
        fromProgramName: "HM RUN",
        toProgramName: "HM STRENGTH",
        amount: "$1,350 MXN",
      });
      expect(sent[1]?.input).toMatchObject({
        kind: "plan_changed",
        programName: "HM RUN",
        toProgramName: "HM STRENGTH",
        effectiveOn: sent[0]?.input.effectiveOn,
      });
      expect(subscription.currentPeriodEnd).toEqual((await contractOf(contract.id)).serviceEndDate);

      // El mes ya pagado sigue siendo del programa anterior; la renovación cobra el nuevo.
      sent.length = 0;
      const invoice = fake.nextInvoice(subscriptionId);
      await webhook(stripeEvent("invoice.paid", fake.payInvoice(invoice.id)));
      const periods = await prisma.servicePeriod.findMany({
        where: { contractId: contract.id },
        orderBy: { sequence: "asc" },
      });
      expect(periods.map((p) => p.programId)).toEqual([contract.programId, strength.id]);
      // La renovación no repite el aviso del cambio.
      expect(kinds()).not.toContain("subscription_plan_changed");
    });

    it("si el cambio llega primero en la factura (eventos fuera de orden), avisa una sola vez", async () => {
      const { subscriptionId } = await subscribe("hm-run");
      const complete = await prisma.program.findUniqueOrThrow({ where: { slug: "hm-complete" } });
      const changed = fake.changePrice(subscriptionId, complete.stripePriceIdRecurring!);
      const invoice = fake.nextInvoice(subscriptionId);

      await webhook(stripeEvent("invoice.paid", fake.payInvoice(invoice.id)));
      await updated(changed);
      expect(kinds().filter((k) => k === "subscription_plan_changed")).toHaveLength(1);
    });
  });
});
