"use client";

import { EmbeddedCheckout, EmbeddedCheckoutProvider } from "@stripe/react-stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";

import { CARD_STEP } from "@/content/checkout";
import { formatPrice } from "@/utils/format";

import type { CheckoutCreated } from "./api";
import { StepHeading } from "./StepHeading";

/** Stripe.js se carga una sola vez por clave publicable (lo pide la documentación de Stripe). */
const stripeByKey = new Map<string, Promise<Stripe | null>>();
function getStripeJs(publishableKey: string): Promise<Stripe | null> {
  let promise = stripeByKey.get(publishableKey);
  if (!promise) {
    promise = loadStripe(publishableKey);
    stripeByKey.set(publishableKey, promise);
  }
  return promise;
}

type Props = {
  checkout: CheckoutCreated;
  /** Regresa a elegir la forma de pago. La sesión sigue abierta y se reutiliza si vuelve. */
  onBack: () => void;
};

/**
 * Paso 4 con tarjeta: formulario de Stripe Embedded Checkout dentro de la landing (RF-07,
 * DECISIONS A27). La tarjeta la captura Stripe en su propio iframe (RN-10). Al pagar, Stripe lleva
 * al cliente a `/pago/exito`; el servicio se activa solo con el webhook.
 */
export function CardPaymentStep({ checkout, onBack }: Props) {
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

      {/* El formulario de Stripe es claro: va sobre fondo blanco para que se lea bien. */}
      <div className="min-h-96 bg-white p-2 sm:p-4" data-testid="stripe-embedded-checkout">
        <EmbeddedCheckoutProvider
          key={checkout.clientSecret}
          stripe={getStripeJs(checkout.publishableKey)}
          options={{ clientSecret: checkout.clientSecret }}
        >
          <EmbeddedCheckout />
        </EmbeddedCheckoutProvider>
      </div>

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
