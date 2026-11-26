import type Stripe from "stripe";

/**
 * Stripe en memoria para las pruebas (sin red). Implementa solo lo que usa la app: Products,
 * Prices, Customers y sesiones de Checkout. Las firmas de los webhooks se prueban con el SDK real
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
  line_items: Array<{ price: string; quantity: number }>;
  params: Stripe.Checkout.SessionCreateParams;
};

class MissingResourceError extends Error {
  code = "resource_missing";
  constructor(id: string) {
    super(`No such resource: ${id}`);
    this.name = "StripeInvalidRequestError";
  }
}

export class FakeStripe {
  productStore = new Map<
    string,
    { id: string; name: string; description: string | null; active: boolean }
  >();
  prices = new Map<string, FakePrice>();
  customersById = new Map<string, Stripe.CustomerCreateParams & { id: string }>();
  sessions = new Map<string, FakeSession>();
  /** Si se define, `checkout.sessions.create` lanza este error. */
  failSessionCreate: Error | null = null;
  calls = { sessionCreate: 0, sessionExpire: 0, customerCreate: 0 };
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
    session.payment_status = paymentStatus;
    session.url = null;
    session.client_secret = null;
    session.payment_intent ??= this.nextId("pi");
    return this.asSession(session);
  }

  asSession(session: FakeSession): Stripe.Checkout.Session {
    const { params: _params, line_items: _items, ...rest } = session;
    void _params;
    void _items;
    return rest as unknown as Stripe.Checkout.Session;
  }

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
          line_items: items,
          params,
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
    } as unknown as Stripe;
  }
}
