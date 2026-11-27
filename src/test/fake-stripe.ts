import type Stripe from "stripe";

/**
 * Stripe en memoria para las pruebas (sin red). Implementa solo lo que usa la app: Products,
 * Prices, Customers, sesiones de Checkout y suscripciones con sus facturas (un "test clock" simple:
 * `startSubscription`, `nextInvoice` y `payInvoice`/`failInvoice` mueven la suscripción mes a mes). Las firmas de los webhooks se prueban con el SDK real
 * (`Stripe.webhooks.generateTestHeaderString`), que no necesita red.
 */

type FakePrice = Pick<
  Stripe.Price,
  "id" | "active" | "type" | "currency" | "unit_amount" | "recurring" | "lookup_key"
> & { product: string; object: "price" };

type FakeSession = {
  id: string;
  object: "checkout.session";
  mode: Stripe.Checkout.Session.Mode;
  ui_mode: string;
  status: Stripe.Checkout.Session.Status;
  payment_status: Stripe.Checkout.Session.PaymentStatus;
  url: string | null;
  client_secret: string | null;
  customer: string | null;
  client_reference_id: string | null;
  metadata: Record<string, string>;
  amount_total: number | null;
  currency: string | null;
  payment_intent: string | null;
  subscription: string | null;
  line_items: Array<{ price: string; quantity: number }>;
  params: Stripe.Checkout.SessionCreateParams;
  /** Código promocional que el cliente aplicó en el formulario (Fase 7B). */
  promotionCodeId: string | null;
  /** Total antes del descuento, en centavos. */
  subtotal: number;
};

/** Cupón + código promocional de Stripe (Fase 7B, DECISIONS A34). */
type FakePromotionCode = {
  id: string;
  code: string;
  couponId: string;
  percentOff: number | null;
  amountOff: number | null;
  duration: "once" | "repeating" | "forever";
  durationInMonths: number | null;
};

/** Descuento vigente de una suscripción. */
type FakeDiscount = {
  id: string;
  promotionCodeId: string;
  /** Facturas que todavía descuenta (`null` = para siempre). */
  remaining: number | null;
};

class MissingResourceError extends Error {
  code = "resource_missing";
  constructor(id: string) {
    super(`No such resource: ${id}`);
    this.name = "StripeInvalidRequestError";
  }
}

type FakeSubscription = {
  id: string;
  object: "subscription";
  status: Stripe.Subscription.Status;
  customer: string | null;
  metadata: Record<string, string>;
  cancel_at_period_end: boolean;
  cancel_at: number | null;
  /** `cancellation_details.reason` de Stripe. */
  cancellation_reason: Stripe.Subscription.CancellationDetails.Reason | null;
  discount: FakeDiscount | null;
  priceId: string;
  periodStart: number;
  periodEnd: number;
};

type FakeInvoice = {
  id: string;
  subscriptionId: string;
  status: "open" | "paid";
  billing_reason: Stripe.Invoice.BillingReason;
  amount: number;
  priceId: string;
  periodStart: number;
  periodEnd: number;
  attempt_count: number;
  paid_at: number | null;
  payment_intent: string;
  /** Próximo reintento programado, o `null` si Stripe ya no reintentará. */
  next_payment_attempt: number | null;
  /** Precio antes del descuento y descuento aplicado, en centavos (Fase 7B). */
  subtotal: number;
  discountAmount: number;
  discountId: string | null;
};

const unix = (date: Date) => Math.floor(date.getTime() / 1000);

/** Mismo día del mes siguiente en UTC (como Stripe con el ancla de facturación). */
function addMonth(seconds: number): number {
  const date = new Date(seconds * 1000);
  const next = new Date(date);
  next.setUTCMonth(date.getUTCMonth() + 1);
  if (next.getUTCDate() !== date.getUTCDate()) next.setUTCDate(0);
  return unix(next);
}

export class FakeStripe {
  productStore = new Map<
    string,
    { id: string; name: string; description: string | null; active: boolean }
  >();
  prices = new Map<string, FakePrice>();
  customersById = new Map<string, Stripe.CustomerCreateParams & { id: string }>();
  sessions = new Map<string, FakeSession>();
  subscriptionStore = new Map<string, FakeSubscription>();
  invoices = new Map<string, FakeInvoice>();
  promotionCodes = new Map<string, FakePromotionCode>();
  /** Si se define, `checkout.sessions.create` lanza este error. */
  failSessionCreate: Error | null = null;
  calls = {
    sessionCreate: 0,
    sessionExpire: 0,
    customerCreate: 0,
    subscriptionRetrieve: 0,
    subscriptionCancel: 0,
    portalSessionCreate: 0,
  };
  /** Sesiones del Customer Portal creadas (parámetros). */
  portalSessions: Stripe.BillingPortal.SessionCreateParams[] = [];
  /** Si se define, `billingPortal.sessions.create` lanza este error. */
  failPortalCreate: Error | null = null;
  private seq = 0;
  private idempotency = new Map<string, string>();

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}_test_${this.seq.toString().padStart(6, "0")}`;
  }

  /** Agrega un Price directamente (p. ej. uno que no coincide con la BD). */
  addPrice(price: Partial<FakePrice> & { product: string; unit_amount: number }): FakePrice {
    const full: FakePrice = {
      id: this.nextId("price"),
      object: "price",
      active: true,
      type: "one_time",
      currency: "mxn",
      recurring: null,
      lookup_key: null,
      ...price,
    };
    this.prices.set(full.id, full);
    return full;
  }

  /** Marca una sesión como pagada (lo que haría el cliente en Stripe). */
  completeSession(
    id: string,
    paymentStatus: Stripe.Checkout.Session.PaymentStatus = "paid",
  ): Stripe.Checkout.Session {
    const session = this.sessions.get(id);
    if (!session) throw new MissingResourceError(id);
    session.status = "complete";
    // Con un cupón del 100 % no hay cobro: Stripe no crea Payment Intent (Fase 7B).
    const free = session.amount_total === 0;
    session.payment_status = free ? "no_payment_required" : paymentStatus;
    session.url = null;
    session.client_secret = null;
    if (!free) session.payment_intent ??= this.nextId("pi");
    return this.asSession(session);
  }

  // ─── Suscripciones ("test clock" simplificado) ─────────────────────────────

  /**
   * El cliente paga una sesión en modo `subscription`: Stripe crea la suscripción (con la metadata de
   * `subscription_data`) y su primera factura pagada. Devuelve la sesión, la suscripción y la factura.
   */
  startSubscription(sessionId: string, at: Date = new Date()) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new MissingResourceError(sessionId);
    if (session.mode !== "subscription") throw new Error("La sesión no es de suscripción.");
    const priceId = session.line_items[0]!.price;
    const start = unix(at);
    const subscription: FakeSubscription = {
      id: this.nextId("sub"),
      object: "subscription",
      status: "active",
      customer: session.customer,
      metadata: {
        ...((session.params.subscription_data?.metadata as Record<string, string>) ?? {}),
      },
      cancel_at_period_end: false,
      cancel_at: null,
      cancellation_reason: null,
      discount: session.promotionCodeId ? this.newDiscount(session.promotionCodeId) : null,
      priceId,
      periodStart: start,
      periodEnd: addMonth(start),
    };
    this.subscriptionStore.set(subscription.id, subscription);
    session.status = "complete";
    session.client_secret = null;
    session.subscription = subscription.id;
    const invoice = this.createInvoice(subscription, "subscription_create");
    invoice.status = "paid";
    invoice.attempt_count = 1;
    invoice.paid_at = start;
    // Con un cupón del 100 % el primer cobro es $0 y Stripe no cobra nada (Fase 7B).
    session.payment_status = invoice.amount === 0 ? "no_payment_required" : "paid";
    return {
      session: this.asSession(session),
      subscription: this.asSubscription(subscription),
      invoice: this.asInvoice(invoice),
    };
  }

  private createInvoice(
    subscription: FakeSubscription,
    reason: Stripe.Invoice.BillingReason,
  ): FakeInvoice {
    const subtotal = this.prices.get(subscription.priceId)?.unit_amount ?? 0;
    const discount = subscription.discount;
    const discountAmount = discount
      ? this.discountFor(this.promotionCodes.get(discount.promotionCodeId)!, subtotal)
      : 0;
    if (discount && discount.remaining !== null) {
      // Un cupón `once` o `repeating` se gasta con cada factura y Stripe lo quita al terminar.
      discount.remaining -= 1;
      if (discount.remaining <= 0) subscription.discount = null;
    }
    const invoice: FakeInvoice = {
      id: this.nextId("in"),
      subscriptionId: subscription.id,
      status: "open",
      billing_reason: reason,
      subtotal,
      discountAmount,
      discountId: discount?.id ?? null,
      amount: subtotal - discountAmount,
      priceId: subscription.priceId,
      periodStart: subscription.periodStart,
      periodEnd: subscription.periodEnd,
      attempt_count: 0,
      paid_at: null,
      payment_intent: this.nextId("pi"),
      next_payment_attempt: null,
    };
    this.invoices.set(invoice.id, invoice);
    return invoice;
  }

  /** Avanza el reloj al fin del periodo: la suscripción entra a su siguiente mes y se factura. */
  nextInvoice(subscriptionId: string): FakeInvoice {
    const subscription = this.subscriptionStore.get(subscriptionId);
    if (!subscription) throw new MissingResourceError(subscriptionId);
    subscription.periodStart = subscription.periodEnd;
    subscription.periodEnd = addMonth(subscription.periodStart);
    return this.createInvoice(subscription, "subscription_cycle");
  }

  /** Un intento de cobro de la factura se paga (renovación o reintento diario). */
  payInvoice(invoiceId: string): Stripe.Invoice {
    const invoice = this.invoices.get(invoiceId);
    if (!invoice) throw new MissingResourceError(invoiceId);
    invoice.status = "paid";
    invoice.attempt_count += 1;
    invoice.paid_at = invoice.periodStart;
    this.subscriptionStore.get(invoice.subscriptionId)!.status = "active";
    return this.asInvoice(invoice);
  }

  /**
   * Intentos de cobro de una renovación (DECISIONS A32): el del día y un reintento diario. Después
   * del último, Stripe ya no programa otro (`next_payment_attempt = null`).
   */
  maxPaymentAttempts = 3;

  /** Un intento de cobro falla: la suscripción queda `past_due` (o `unpaid`). */
  failInvoice(invoiceId: string, status: Stripe.Subscription.Status = "past_due"): Stripe.Invoice {
    const invoice = this.invoices.get(invoiceId);
    if (!invoice) throw new MissingResourceError(invoiceId);
    invoice.attempt_count += 1;
    invoice.next_payment_attempt =
      invoice.billing_reason !== "subscription_create" &&
      invoice.attempt_count < this.maxPaymentAttempts
        ? invoice.periodStart + invoice.attempt_count * 86_400
        : null;
    this.subscriptionStore.get(invoice.subscriptionId)!.status = status;
    return this.asInvoice(invoice);
  }

  /**
   * Stripe cancela la suscripción: al agotarse los reintentos (`payment_failed`, el valor por
   * defecto), al final del periodo de una cancelación pedida (`cancellation_requested`), etc.
   */
  cancelSubscription(
    subscriptionId: string,
    reason: Stripe.Subscription.CancellationDetails.Reason = "payment_failed",
  ): Stripe.Subscription {
    const subscription = this.subscriptionStore.get(subscriptionId);
    if (!subscription) throw new MissingResourceError(subscriptionId);
    subscription.status = "canceled";
    subscription.cancellation_reason = reason;
    return this.asSubscription(subscription);
  }

  // ─── Customer Portal (lo que hace el cliente ahí) ──────────────────────────

  /** Cancela en el portal: al final del periodo (`cancel_at_period_end`, o `cancel_at` si se pide). */
  scheduleCancellation(subscriptionId: string, options: { useCancelAt?: boolean } = {}) {
    const subscription = this.subscriptionStore.get(subscriptionId);
    if (!subscription) throw new MissingResourceError(subscriptionId);
    if (options.useCancelAt) subscription.cancel_at = subscription.periodEnd;
    else subscription.cancel_at_period_end = true;
    subscription.cancellation_reason = "cancellation_requested";
    return this.asSubscription(subscription);
  }

  /** Deshace la cancelación en el portal. */
  undoCancellation(subscriptionId: string) {
    const subscription = this.subscriptionStore.get(subscriptionId);
    if (!subscription) throw new MissingResourceError(subscriptionId);
    subscription.cancel_at_period_end = false;
    subscription.cancel_at = null;
    subscription.cancellation_reason = null;
    return this.asSubscription(subscription);
  }

  /** Cambia de Price en el portal, sin prorrateo: se cobra en la siguiente renovación. */
  changePrice(subscriptionId: string, priceId: string) {
    const subscription = this.subscriptionStore.get(subscriptionId);
    if (!subscription) throw new MissingResourceError(subscriptionId);
    subscription.priceId = priceId;
    return this.asSubscription(subscription);
  }

  /** Llega el fin del periodo de una suscripción con la cancelación programada. */
  endScheduledCancellation(subscriptionId: string) {
    return this.cancelSubscription(subscriptionId, "cancellation_requested");
  }

  asSubscription(subscription: FakeSubscription): Stripe.Subscription {
    return {
      id: subscription.id,
      object: "subscription",
      status: subscription.status,
      customer: subscription.customer,
      metadata: { ...subscription.metadata },
      cancel_at_period_end: subscription.cancel_at_period_end,
      cancel_at: subscription.cancel_at,
      cancellation_details: {
        comment: null,
        feedback: null,
        reason: subscription.cancellation_reason,
      },
      // La app la lee con `expand: ["discounts"]`: objetos Discount con el ID del código.
      discounts: subscription.discount
        ? [
            {
              id: subscription.discount.id,
              object: "discount",
              promotion_code: subscription.discount.promotionCodeId,
            },
          ]
        : [],
      items: {
        object: "list",
        data: [
          {
            id: `si_${subscription.id}`,
            price: { id: subscription.priceId },
            current_period_start: subscription.periodStart,
            current_period_end: subscription.periodEnd,
          },
        ],
      },
    } as unknown as Stripe.Subscription;
  }

  asInvoice(invoice: FakeInvoice): Stripe.Invoice {
    const subscription = this.subscriptionStore.get(invoice.subscriptionId)!;
    const price = this.prices.get(invoice.priceId);
    return {
      id: invoice.id,
      object: "invoice",
      status: invoice.status,
      billing_reason: invoice.billing_reason,
      currency: price?.currency ?? "mxn",
      amount_due: invoice.amount,
      amount_paid: invoice.status === "paid" ? invoice.amount : 0,
      subtotal: invoice.subtotal,
      total: invoice.amount,
      // En los webhooks los descuentos de la factura vienen como IDs (no expandidos).
      discounts: invoice.discountId ? [invoice.discountId] : [],
      total_discount_amounts: invoice.discountId
        ? [{ amount: invoice.discountAmount, discount: invoice.discountId }]
        : [],
      attempt_count: invoice.attempt_count,
      next_payment_attempt: invoice.next_payment_attempt,
      hosted_invoice_url: `https://invoice.stripe.test/i/${invoice.id}`,
      status_transitions: { paid_at: invoice.paid_at },
      period_start: invoice.periodStart,
      period_end: invoice.periodStart,
      parent: {
        type: "subscription_details",
        quote_details: null,
        subscription_details: {
          subscription: invoice.subscriptionId,
          metadata: { ...subscription.metadata },
        },
      },
      lines: {
        object: "list",
        has_more: false,
        data: [
          {
            id: `il_${invoice.id}`,
            object: "line_item",
            amount: invoice.subtotal,
            period: { start: invoice.periodStart, end: invoice.periodEnd },
            parent: { type: "subscription_item_details" },
            pricing: { price_details: { price: invoice.priceId, product: price?.product } },
          },
        ],
      },
      payments: {
        object: "list",
        data: [
          {
            status: invoice.status === "paid" ? "paid" : "open",
            payment: { type: "payment_intent", payment_intent: invoice.payment_intent },
          },
        ],
      },
    } as unknown as Stripe.Invoice;
  }

  readonly subscriptionsApi = {
    retrieve: async (id: string) => {
      this.calls.subscriptionRetrieve += 1;
      const subscription = this.subscriptionStore.get(id);
      if (!subscription) throw new MissingResourceError(id);
      return this.asSubscription(subscription);
    },
    cancel: async (id: string) => {
      this.calls.subscriptionCancel += 1;
      // Una cancelación por la API (la app, al agotarse los reintentos) es "pedida".
      return this.cancelSubscription(id, "cancellation_requested");
    },
  };

  readonly billingPortal = {
    sessions: {
      create: async (params: Stripe.BillingPortal.SessionCreateParams) => {
        this.calls.portalSessionCreate += 1;
        if (this.failPortalCreate) throw this.failPortalCreate;
        this.portalSessions.push(params);
        const id = this.nextId("bps");
        return {
          id,
          object: "billing_portal.session",
          customer: params.customer,
          return_url: params.return_url ?? null,
          url: `https://billing.stripe.test/p/session/${id}`,
        } as unknown as Stripe.BillingPortal.Session;
      },
    },
  };

  asSession(session: FakeSession): Stripe.Checkout.Session {
    const { params: _params, line_items: _items, promotionCodeId, subtotal, ...rest } = session;
    void _params;
    void _items;
    const promo = promotionCodeId ? this.promotionCodes.get(promotionCodeId) : null;
    return {
      ...rest,
      amount_subtotal: subtotal,
      total_details: {
        amount_discount: subtotal - (session.amount_total ?? subtotal),
        amount_shipping: 0,
        amount_tax: 0,
      },
      discounts: promo ? [{ coupon: promo.couponId, promotion_code: promo.id }] : [],
    } as unknown as Stripe.Checkout.Session;
  }

  // ─── Cupones y códigos promocionales (Fase 7B) ─────────────────────────────

  /** Ferro crea un cupón y su código en el Dashboard. Devuelve el código promocional. */
  addPromotionCode(input: {
    code: string;
    percentOff?: number;
    amountOff?: number;
    duration?: FakePromotionCode["duration"];
    durationInMonths?: number;
  }): FakePromotionCode {
    const promo: FakePromotionCode = {
      id: this.nextId("promo"),
      code: input.code,
      couponId: this.nextId("coupon"),
      percentOff: input.percentOff ?? null,
      amountOff: input.amountOff ?? null,
      duration: input.duration ?? "once",
      durationInMonths: input.durationInMonths ?? null,
    };
    this.promotionCodes.set(promo.id, promo);
    return promo;
  }

  private discountFor(promo: FakePromotionCode, subtotal: number): number {
    if (promo.percentOff !== null) return Math.round((subtotal * promo.percentOff) / 100);
    return Math.min(subtotal, promo.amountOff ?? 0);
  }

  private newDiscount(promotionCodeId: string): FakeDiscount {
    const promo = this.promotionCodes.get(promotionCodeId)!;
    return {
      id: this.nextId("di"),
      promotionCodeId,
      remaining:
        promo.duration === "forever"
          ? null
          : promo.duration === "repeating"
            ? (promo.durationInMonths ?? 1)
            : 1,
    };
  }

  /** El cliente escribe el código en el formulario de pago: Stripe recalcula el total. */
  applyPromotionCode(sessionId: string, promotionCodeId: string): Stripe.Checkout.Session {
    const session = this.sessions.get(sessionId);
    if (!session) throw new MissingResourceError(sessionId);
    if (!session.params.allow_promotion_codes) {
      throw new Error("La sesión no acepta códigos promocionales.");
    }
    const promo = this.promotionCodes.get(promotionCodeId);
    if (!promo) throw new MissingResourceError(promotionCodeId);
    session.promotionCodeId = promo.id;
    session.amount_total = session.subtotal - this.discountFor(promo, session.subtotal);
    return this.asSession(session);
  }

  /** Ferro quita el cupón de la suscripción en el Dashboard. */
  removeDiscount(subscriptionId: string): Stripe.Subscription {
    const subscription = this.subscriptionStore.get(subscriptionId);
    if (!subscription) throw new MissingResourceError(subscriptionId);
    subscription.discount = null;
    return this.asSubscription(subscription);
  }

  readonly promotionCodesApi = {
    retrieve: async (id: string) => {
      const promo = this.promotionCodes.get(id);
      if (!promo) throw new MissingResourceError(id);
      return { id: promo.id, object: "promotion_code", code: promo.code } as Stripe.PromotionCode;
    },
  };

  readonly checkout = {
    sessions: {
      create: async (params: Stripe.Checkout.SessionCreateParams) => {
        this.calls.sessionCreate += 1;
        if (this.failSessionCreate) throw this.failSessionCreate;
        const items = (params.line_items ?? []).map((item) => ({
          price: item.price!,
          quantity: item.quantity ?? 1,
        }));
        const amount = items.reduce(
          (sum, item) => sum + (this.prices.get(item.price)?.unit_amount ?? 0) * item.quantity,
          0,
        );
        const id = this.nextId("cs");
        const session: FakeSession = {
          id,
          object: "checkout.session",
          mode: params.mode!,
          ui_mode: params.ui_mode ?? "hosted_page",
          status: "open",
          payment_status: "unpaid",
          url: params.ui_mode === "form" ? null : `https://checkout.stripe.test/c/pay/${id}`,
          client_secret: params.ui_mode === "form" ? `${id}_secret_test` : null,
          customer: (params.customer as string | undefined) ?? null,
          client_reference_id: params.client_reference_id ?? null,
          metadata: { ...(params.metadata as Record<string, string>) },
          amount_total: amount,
          currency: this.prices.get(items[0]?.price ?? "")?.currency ?? "mxn",
          payment_intent: null,
          subscription: null,
          line_items: items,
          params,
          promotionCodeId: null,
          subtotal: amount,
        };
        this.sessions.set(id, session);
        return this.asSession(session);
      },
      retrieve: async (id: string) => {
        const session = this.sessions.get(id);
        if (!session) throw new MissingResourceError(id);
        return this.asSession(session);
      },
      expire: async (id: string) => {
        this.calls.sessionExpire += 1;
        const session = this.sessions.get(id);
        if (!session) throw new MissingResourceError(id);
        if (session.status !== "open") throw new Error("Only open sessions can be expired.");
        session.status = "expired";
        session.url = null;
        session.client_secret = null;
        return this.asSession(session);
      },
      listLineItems: async (id: string) => {
        const session = this.sessions.get(id);
        if (!session) throw new MissingResourceError(id);
        return {
          object: "list",
          has_more: false,
          data: session.line_items.map((item) => ({
            price: { id: item.price },
            quantity: item.quantity,
          })),
        };
      },
    },
  };

  readonly customers = {
    create: async (params: Stripe.CustomerCreateParams, options?: { idempotencyKey?: string }) => {
      const key = options?.idempotencyKey;
      if (key && this.idempotency.has(key)) {
        return { id: this.idempotency.get(key)!, object: "customer" };
      }
      this.calls.customerCreate += 1;
      const id = this.nextId("cus");
      this.customersById.set(id, { ...params, id });
      if (key) this.idempotency.set(key, id);
      return { id, object: "customer" };
    },
  };

  readonly productsApi = {
    retrieve: async (id: string) => {
      const product = this.productStore.get(id);
      if (!product) throw new MissingResourceError(id);
      return { object: "product", ...product };
    },
    create: async (params: Stripe.ProductCreateParams) => {
      const product = {
        id: params.id!,
        name: params.name,
        description: params.description ?? null,
        active: true,
      };
      this.productStore.set(product.id, product);
      return { object: "product", ...product };
    },
    update: async (id: string, params: Stripe.ProductUpdateParams) => {
      const product = this.productStore.get(id);
      if (!product) throw new MissingResourceError(id);
      Object.assign(product, {
        name: params.name ?? product.name,
        description: (params.description as string | undefined) ?? product.description,
        active: params.active ?? product.active,
      });
      return { object: "product", ...product };
    },
  };

  readonly pricesApi = {
    retrieve: async (id: string) => {
      const price = this.prices.get(id);
      if (!price) throw new MissingResourceError(id);
      return { ...price };
    },
    list: async (params: Stripe.PriceListParams) => {
      const keys = params.lookup_keys ?? [];
      return {
        object: "list",
        has_more: false,
        data: [...this.prices.values()].filter(
          (price) => price.lookup_key !== null && keys.includes(price.lookup_key),
        ),
      };
    },
    create: async (params: Stripe.PriceCreateParams) => {
      if (params.lookup_key && params.transfer_lookup_key) {
        for (const price of this.prices.values()) {
          if (price.lookup_key === params.lookup_key) price.lookup_key = null;
        }
      }
      return this.addPrice({
        product: params.product!,
        unit_amount: params.unit_amount!,
        currency: params.currency,
        type: params.recurring ? "recurring" : "one_time",
        recurring: params.recurring
          ? ({
              interval: params.recurring.interval,
              interval_count: params.recurring.interval_count ?? 1,
            } as Stripe.Price.Recurring)
          : null,
        lookup_key: params.lookup_key ?? null,
      });
    },
    update: async (id: string, params: Stripe.PriceUpdateParams) => {
      const price = this.prices.get(id);
      if (!price) throw new MissingResourceError(id);
      if (params.active !== undefined) price.active = params.active;
      return { ...price };
    },
  };

  /** El cliente tal como lo usa la app (`Stripe`). */
  asStripe(): Stripe {
    return {
      checkout: this.checkout,
      customers: this.customers,
      products: this.productsApi,
      prices: this.pricesApi,
      subscriptions: this.subscriptionsApi,
      billingPortal: this.billingPortal,
      promotionCodes: this.promotionCodesApi,
    } as unknown as Stripe;
  }
}
