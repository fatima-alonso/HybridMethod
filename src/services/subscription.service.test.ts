import type Stripe from "stripe";
import { describe, expect, it } from "vitest";

import { invoiceServiceLine } from "./stripe-subscription-webhook.service";
import { mapSubscriptionStatus, subscriptionSnapshot } from "./subscription.service";

describe("subscription.service (DECISIONS A31)", () => {
  it("traduce los estados de Stripe al enum local", () => {
    expect(mapSubscriptionStatus("active")).toBe("active");
    expect(mapSubscriptionStatus("trialing")).toBe("active");
    expect(mapSubscriptionStatus("past_due")).toBe("past_due");
    expect(mapSubscriptionStatus("unpaid")).toBe("unpaid");
    expect(mapSubscriptionStatus("paused")).toBe("unpaid");
    expect(mapSubscriptionStatus("canceled")).toBe("canceled");
    expect(mapSubscriptionStatus("incomplete_expired")).toBe("canceled");
    expect(mapSubscriptionStatus("incomplete")).toBe("incomplete");
  });

  it("toma el periodo y el Price del concepto, y la cancelación programada", () => {
    const snapshot = subscriptionSnapshot({
      id: "sub_1",
      status: "active",
      customer: "cus_1",
      metadata: { contractId: "c-1" },
      cancel_at_period_end: false,
      cancel_at: 1_800_000_000,
      items: {
        data: [{ price: { id: "price_1" }, current_period_start: 100, current_period_end: 200 }],
      },
    } as unknown as Stripe.Subscription);
    expect(snapshot).toMatchObject({
      status: "active",
      priceId: "price_1",
      contractId: "c-1",
      stripeCustomerId: "cus_1",
      cancelAtPeriodEnd: true,
      currentPeriodStart: new Date(100_000),
      currentPeriodEnd: new Date(200_000),
    });
  });

  it("el periodo de la factura sale de la línea de la suscripción, no del encabezado", () => {
    const invoice = {
      period_start: 100,
      period_end: 100,
      lines: {
        data: [
          {
            amount: 108000,
            period: { start: 100, end: 2_000 },
            parent: { type: "subscription_item_details" },
            pricing: { price_details: { price: "price_1", product: "hm-run" } },
          },
        ],
      },
    } as unknown as Stripe.Invoice;
    expect(invoiceServiceLine(invoice)).toEqual({
      priceId: "price_1",
      productId: "hm-run",
      start: new Date(100_000),
      end: new Date(2_000_000),
    });
    const empty = { lines: { data: [] } } as unknown as Stripe.Invoice;
    expect(invoiceServiceLine(empty)).toBeNull();
  });
});
