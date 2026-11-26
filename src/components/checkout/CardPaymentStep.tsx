"use client";

import {
  loadStripe,
  type Stripe,
  type StripeCheckoutForm,
  type StripeCheckoutFormSdkOptions,
} from "@stripe/stripe-js";
import { useEffect, useRef, useState } from "react";

import { CARD_STEP } from "@/content/checkout";
import { formatPrice } from "@/utils/format";

import type { CheckoutCreated } from "./api";
import { StepHeading } from "./StepHeading";

/** Stripe.js se carga una sola vez por clave publicable, siempre desde js.stripe.com (PCI). */
const stripeByKey = new Map<string, Promise<Stripe | null>>();
function getStripeJs(publishableKey: string): Promise<Stripe | null> {
  let promise = stripeByKey.get(publishableKey);
  if (!promise) {
    promise = loadStripe(publishableKey);
    stripeByKey.set(publishableKey, promise);
  }
  return promise;
}

/**
 * Apariencia del formulario (Checkout Studio, DECISIONS A29), ajustada a la marca: fondo negro,
 * texto off-white y Volt Orange para la acción principal.
 */
export const CHECKOUT_APPEARANCE: NonNullable<StripeCheckoutFormSdkOptions["appearance"]> = {
  theme: "night",
  labels: "auto",
  inputs: "spaced",
  variables: {
    borderRadius: "4px",
    colorBackground: "#111111",
    colorDanger: "#ff5c5c",
    colorPrimary: "#FF6A00",
    colorSuccess: "#00c853",
    colorText: "#F5F3EE",
    fontFamily: "Inter, system-ui, sans-serif",
    fontSizeBase: "16px",
    spacingUnit: "4px",
  },
};

const CHECKOUT_FONTS: StripeCheckoutFormSdkOptions["fonts"] = [
  { cssSrc: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" },
];

type Props = {
  checkout: CheckoutCreated;
  /** Regresa a elegir la forma de pago. La sesión sigue abierta y se reutiliza si vuelve. */
  onBack: () => void;
};

type LoadState = "loading" | "ready" | "error";

/**
 * Paso 4 con tarjeta: formulario de pago de Stripe incrustado en la landing (`ui_mode: form`,
 * RF-07, DECISIONS A27, A29). La tarjeta la captura Stripe en su propio iframe (RN-10). Al pagar,
 * el formulario lleva al cliente a `/pago/exito`; el servicio se activa solo con el webhook.
 */
export function CardPaymentStep({ checkout, onBack }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);
  const { clientSecret, publishableKey, returnUrl } = checkout;

  useEffect(() => {
    let cancelled = false;
    let form: StripeCheckoutForm | null = null;
    const fail = () => {
      if (!cancelled) setState("error");
    };

    async function mount() {
      const stripe = await getStripeJs(publishableKey);
      if (cancelled) return;
      if (!stripe || !containerRef.current) return fail();

      const sdk = stripe.initCheckoutFormSdk({
        clientSecret,
        appearance: CHECKOUT_APPEARANCE,
        fonts: CHECKOUT_FONTS,
      });
      form = sdk.createForm({ layout: "expanded" });
      form.on("ready", () => {
        if (!cancelled) setState("ready");
      });
      form.on("loaderror", fail);
      form.mount(containerRef.current);

      const loaded = await sdk.loadActions();
      if (cancelled) return;
      if (loaded.type !== "success") return fail();
      const { actions } = loaded;
      form.on("confirm", async (event) => {
        setError(null);
        // Con éxito, Stripe lleva al cliente a `returnUrl`; si falla (tarjeta rechazada), se queda.
        const result = await actions.confirm({ formConfirmEvent: event, returnUrl });
        if (!cancelled && result.type === "error") {
          setError(result.error.message || CARD_STEP.confirmError);
        }
      });
    }

    mount().catch(fail);
    return () => {
      cancelled = true;
      form?.destroy();
    };
  }, [clientSecret, publishableKey, returnUrl]);

  return (
    <div className="space-y-6">
      <StepHeading title={CARD_STEP.title} />
      <p className="text-bone/85">{CARD_STEP.lead}</p>

      <div className="border-2 border-bone/25 p-4">
        <p className="font-display text-2xl font-bold uppercase">{checkout.program.name}</p>
        <p className="text-bone/85">
          {formatPrice(checkout.amount, checkout.currency)} · {CARD_STEP.referenceLabel}{" "}
          <span className="font-mono font-semibold">{checkout.reference}</span>
        </p>
      </div>

      {state === "loading" ? (
        <p role="status" className="text-bone/70">
          {CARD_STEP.loading}
        </p>
      ) : null}
      {state === "error" ? (
        <p role="alert" className="font-semibold text-volt">
          {CARD_STEP.loadError}
        </p>
      ) : null}
      <div ref={containerRef} className="min-h-24" data-testid="stripe-checkout-form" />
      <p role="alert" className="min-h-6 font-semibold text-volt">
        {error ?? ""}
      </p>

      <button
        type="button"
        onClick={onBack}
        className="text-sm font-semibold text-bone/70 underline underline-offset-4 hover:text-volt"
      >
        {CARD_STEP.back}
      </button>
    </div>
  );
}
