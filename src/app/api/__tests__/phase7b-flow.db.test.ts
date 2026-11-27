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
 * Fase 7B a través de las rutas (RF-07, RF-08, RN-03, RN-10, RN-11, DECISIONS A34, B18): cupones de
 * descuento de Stripe en el pago único y la suscripción, incluidas las cortesías del 100 %. Ferro
 * crea los códigos en Stripe; el cliente los escribe en el formulario y Stripe calcula el descuento.
 */

let fake = new FakeStripe();
vi.mock("@/lib/stripe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/stripe")>()),
  getStripe: () => fake.asStripe(),
}));

type Sent = { kind: string; input: Record<string, unknown> };
const sent: Sent[] = [];
const record = (kind: string) => async (input: Record<string, unknown>) => {
  sent.push({ kind, input });
  return { mode: "console" };
};
vi.mock("@/services/email.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/email.service")>()),
  sendPurchaseConfirmationEmail: record("purchase_confirmation"),
  sendWelcomeEmail: record("welcome"),
  sendPaymentReceivedEmail: record("payment_received"),
  sendRenewalSuccessfulEmail: record("renewal_successful"),
  sendSubscriptionRenewedEmail: record("subscription_renewed"),
  sendSubscriptionChangeAlertEmail: record("subscription_change_alert"),
  sendSubscriptionDiscountEndedEmail: record("subscription_discount_ended"),
  sendSubscriptionEndedEmail: record("subscription_ended"),
}));

const checkoutRoute = await import("../checkout/route");
const webhookRoute = await import("../webhooks/stripe/route");

const WEBHOOK_SECRET = "whsec_test_secret_for_phase7b";
const COOKIE = "hm_verification";
const EMAIL = "ana@example.com";
let ipCounter = 0;

function checkout(mode: "payment" | "subscription", program = "hm-run") {
  const headers = new Headers({ "content-type": "application/json" });
  headers.set("x-forwarded-for", `10.8.0.${++ipCounter % 250}`);
  headers.set("cookie", `${COOKIE}=${createVerificationSessionToken(EMAIL).token}`);
  return checkoutRoute.POST(
    new NextRequest("http://localhost:3000/api/checkout", {
      method: "POST",
      headers,
      body: JSON.stringify({
        fullName: "Ana López",
        whatsapp: { country: "MX", number: "55 1234 5678" },
        program,
        privacyAccepted: true,
        mode,
      }),
    }),
  );
}

let eventSeq = 0;
function stripeEvent(type: string, object: unknown): Stripe.Event {
  return {
    id: `evt_test7b_${++eventSeq}`,
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

const find = (kind: string) => sent.find((s) => s.kind === kind)?.input;

describe.skipIf(!testDatabaseUrl)("API de la Fase 7B (cupones) con PostgreSQL", () => {
  const prisma = testDatabaseUrl ? createTestPrisma() : (undefined as never);

  beforeAll(() => {
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.STRIPE_SECRET_KEY = "sk_test_phase7b";
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_test_phase7b";
    resetConfigCache();
  });
  beforeEach(async () => {
    await truncateAll(prisma);
    await syncProgramCatalog(prisma);
    fake = new FakeStripe();
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

  /** Abre el Checkout y devuelve el contrato y su sesión. */
  async function open(mode: "payment" | "subscription", program = "hm-run") {
    const res = await checkout(mode, program);
    expect(res.status).toBe(201);
    const { reference } = await res.json();
    const contract = await prisma.contract.findUniqueOrThrow({ where: { reference } });
    return { contract, sessionId: contract.stripeCheckoutSessionId! };
  }

  /** Suscripción pagada con un código; devuelve el contrato y la suscripción de Stripe. */
  async function subscribeWith(promotionCodeId: string) {
    const { contract, sessionId } = await open("subscription");
    fake.applyPromotionCode(sessionId, promotionCodeId);
    const started = fake.startSubscription(sessionId);
    await webhook(stripeEvent("checkout.session.completed", started.session));
    await webhook(stripeEvent("customer.subscription.created", started.subscription));
    const res = await webhook(stripeEvent("invoice.paid", started.invoice));
    expect(res.body).toMatchObject({ status: "processed" });
    return { contract, subscriptionId: started.subscription.id, invoice: started.invoice };
  }

  const renew = async (subscriptionId: string) => {
    const invoice = fake.nextInvoice(subscriptionId);
    const res = await webhook(stripeEvent("invoice.paid", fake.payInvoice(invoice.id)));
    expect(res.body).toMatchObject({ status: "processed" });
  };

  it("el Checkout acepta códigos en los dos modos; la suscripción siempre pide la tarjeta", async () => {
    const oneTime = await open("payment");
    expect(fake.sessions.get(oneTime.sessionId)?.params).toMatchObject({
      allow_promotion_codes: true,
    });
    expect(fake.sessions.get(oneTime.sessionId)?.params).not.toHaveProperty(
      "payment_method_collection",
    );
    await truncateAll(prisma);
    await syncProgramCatalog(prisma);
    await syncStripeCatalog(fake.asStripe(), prisma);
    const subscription = await open("subscription");
    expect(fake.sessions.get(subscription.sessionId)?.params).toMatchObject({
      allow_promotion_codes: true,
      payment_method_collection: "always",
    });
  });

  describe("pago único", () => {
    it("con un descuento parcial registra lo cobrado, el descuento y el código", async () => {
      const promo = fake.addPromotionCode({ code: "VERANO20", percentOff: 20 });
      const { contract, sessionId } = await open("payment");
      fake.applyPromotionCode(sessionId, promo.id);
      await webhook(stripeEvent("checkout.session.completed", fake.completeSession(sessionId)));

      const after = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
      expect(after.status).toBe("active");
      // El contrato conserva su precio; el Payment guarda lo cobrado.
      expect(after.amount.toFixed(2)).toBe("1200.00");
      const payment = await prisma.payment.findFirstOrThrow({ where: { contractId: contract.id } });
      expect(payment.amount.toFixed(2)).toBe("960.00");
      expect(payment.discountAmount?.toFixed(2)).toBe("240.00");
      expect(payment.promotionCode).toBe("VERANO20");
      expect(await prisma.auditLog.count({ where: { action: "stripe.amount_mismatch" } })).toBe(0);
      expect(
        await prisma.auditLog.findFirst({ where: { action: "stripe.discount_applied" } }),
      ).toMatchObject({ metadata: { coupon: "VERANO20", discount: "240.00" } });

      const discount = {
        listAmount: "$1,200 MXN",
        discount: "$240 MXN",
        promotionCode: "VERANO20",
        courtesy: false,
      };
      expect(find("purchase_confirmation")).toMatchObject({ amount: "$960 MXN", discount });
      expect(find("payment_received")).toMatchObject({ amount: "$960 MXN", discount });
    });

    it("una cortesía del 100 % activa el servicio aunque Stripe no cobre nada", async () => {
      const promo = fake.addPromotionCode({ code: "CORTESIA-ANA", percentOff: 100 });
      const { contract, sessionId } = await open("payment");
      fake.applyPromotionCode(sessionId, promo.id);
      const session = fake.completeSession(sessionId);
      expect(session.payment_status).toBe("no_payment_required");
      expect(session.payment_intent).toBeNull();

      const res = await webhook(stripeEvent("checkout.session.completed", session));
      expect(res.body).toMatchObject({ status: "processed" });
      const after = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
      expect(after.status).toBe("active");
      expect(after.serviceEndDate).not.toBeNull();
      const payment = await prisma.payment.findFirstOrThrow({ where: { contractId: contract.id } });
      expect(payment).toMatchObject({ status: "succeeded", stripePaymentIntentId: null });
      expect(payment.amount.toFixed(2)).toBe("0.00");
      expect(payment.discountAmount?.toFixed(2)).toBe("1200.00");
      expect(await prisma.servicePeriod.count({ where: { contractId: contract.id } })).toBe(1);
      expect(find("payment_received")).toMatchObject({
        discount: { courtesy: true, promotionCode: "CORTESIA-ANA" },
      });
      expect(find("welcome")).toBeTruthy();
    });

    it("si Stripe no responde al leer el código, registra el descuento sin el código", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const promo = fake.addPromotionCode({ code: "VERANO20", percentOff: 20 });
      const { contract, sessionId } = await open("payment");
      fake.applyPromotionCode(sessionId, promo.id);
      fake.promotionCodes.delete(promo.id);
      await webhook(stripeEvent("checkout.session.completed", fake.completeSession(sessionId)));
      const payment = await prisma.payment.findFirstOrThrow({ where: { contractId: contract.id } });
      expect(payment.discountAmount?.toFixed(2)).toBe("240.00");
      expect(payment.promotionCode).toBeNull();
    });
  });

  describe("suscripción", () => {
    it("cortesía para siempre: cada mes se abre en $0 con su botón de entrega", async () => {
      const promo = fake.addPromotionCode({
        code: "CORTESIA-ANA",
        percentOff: 100,
        duration: "forever",
      });
      const { contract, subscriptionId } = await subscribeWith(promo.id);
      let after = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
      expect(after.status).toBe("active");
      expect(await prisma.subscription.findFirst()).toMatchObject({
        hasDiscount: true,
        promotionCode: "CORTESIA-ANA",
      });
      expect(find("purchase_confirmation")).toMatchObject({
        discount: { courtesy: true, listAmount: "$1,080 MXN" },
      });

      sent.length = 0;
      await renew(subscriptionId);
      await renew(subscriptionId);
      const periods = await prisma.servicePeriod.findMany({ where: { contractId: contract.id } });
      expect(periods).toHaveLength(3);
      const payments = await prisma.payment.findMany({ where: { contractId: contract.id } });
      expect(payments.map((p) => p.amount.toFixed(2))).toEqual(["0.00", "0.00", "0.00"]);
      expect(payments.every((p) => p.promotionCode === "CORTESIA-ANA")).toBe(true);
      after = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
      expect(after.serviceEndDate).toEqual(periods.at(-1)?.endDate);
      expect(find("renewal_successful")).toMatchObject({ discount: { courtesy: true } });
      expect(await prisma.auditLog.count({ where: { action: "stripe.amount_mismatch" } })).toBe(0);
    });

    it("el cupón se acumula con el 10 % de la suscripción (B18)", async () => {
      const promo = fake.addPromotionCode({
        code: "AMIGO20",
        percentOff: 20,
        duration: "forever",
      });
      const { contract } = await subscribeWith(promo.id);
      const payment = await prisma.payment.findFirstOrThrow({ where: { contractId: contract.id } });
      // 20 % sobre $1,080 (que ya tiene el 10 %): $864.
      expect(payment.amount.toFixed(2)).toBe("864.00");
      expect(payment.discountAmount?.toFixed(2)).toBe("216.00");
      expect(await prisma.auditLog.count({ where: { action: "stripe.amount_mismatch" } })).toBe(0);
    });

    it("un descuento por varios meses termina solo: avisa una vez y luego cobra el precio normal", async () => {
      const promo = fake.addPromotionCode({
        code: "TRES-MESES",
        percentOff: 50,
        duration: "repeating",
        durationInMonths: 2,
      });
      const { contract, subscriptionId } = await subscribeWith(promo.id);
      sent.length = 0;
      await renew(subscriptionId); // mes 2: último con descuento; Stripe quita el cupón.
      const updated = await fake.asStripe().subscriptions.retrieve(subscriptionId);
      await webhook(stripeEvent("customer.subscription.updated", updated));
      expect(sent.filter((s) => s.kind === "subscription_discount_ended")).toHaveLength(1);
      expect(find("subscription_discount_ended")).toMatchObject({
        to: EMAIL,
        promotionCode: "TRES-MESES",
        amount: "$1,080 MXN",
      });
      expect(find("subscription_change_alert")).toMatchObject({ kind: "discount_ended" });

      await webhook(stripeEvent("customer.subscription.updated", updated));
      expect(sent.filter((s) => s.kind === "subscription_discount_ended")).toHaveLength(1);

      await renew(subscriptionId); // mes 3: precio normal.
      const payments = await prisma.payment.findMany({
        where: { contractId: contract.id },
        orderBy: { createdAt: "asc" },
      });
      expect(payments.map((p) => p.amount.toFixed(2))).toEqual(["540.00", "540.00", "1080.00"]);
      expect(payments[2]?.discountAmount).toBeNull();
    });

    it("Ferro quita el cupón de una cortesía: aviso al cliente y a Ferro, y el siguiente mes se cobra", async () => {
      const promo = fake.addPromotionCode({
        code: "CORTESIA-ANA",
        percentOff: 100,
        duration: "forever",
      });
      const { contract, subscriptionId } = await subscribeWith(promo.id);
      sent.length = 0;
      await webhook(
        stripeEvent("customer.subscription.updated", fake.removeDiscount(subscriptionId)),
      );
      expect(await prisma.subscription.findFirst()).toMatchObject({
        hasDiscount: false,
        promotionCode: null,
      });
      expect(sent.map((s) => s.kind)).toEqual([
        "subscription_discount_ended",
        "subscription_change_alert",
      ]);
      await renew(subscriptionId);
      const last = await prisma.payment.findFirstOrThrow({
        where: { contractId: contract.id },
        orderBy: { createdAt: "desc" },
      });
      expect(last.amount.toFixed(2)).toBe("1080.00");
    });

    it("una suscripción con la cancelación programada no avisa del fin del descuento", async () => {
      const promo = fake.addPromotionCode({
        code: "CORTESIA-ANA",
        percentOff: 100,
        duration: "forever",
      });
      const { subscriptionId } = await subscribeWith(promo.id);
      fake.scheduleCancellation(subscriptionId);
      fake.removeDiscount(subscriptionId);
      sent.length = 0;
      const sub = await fake.asStripe().subscriptions.retrieve(subscriptionId);
      await webhook(stripeEvent("customer.subscription.updated", sub));
      expect(sent.map((s) => s.kind)).not.toContain("subscription_discount_ended");
    });
  });
});
