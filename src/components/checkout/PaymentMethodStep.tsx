"use client";

import { useState, type FormEvent } from "react";

import { PAYMENT_STEP } from "@/content/checkout";
import { buttonPrimary } from "@/components/shared/styles";
import type { ProgramOption } from "@/types/program";
import { formatPrice } from "@/utils/format";

import { StepHeading } from "./StepHeading";

export type PaymentMethodId = (typeof PAYMENT_STEP.methods)[number]["id"];

type Props = {
  program: ProgramOption;
  busy?: boolean;
  error?: string | null;
  onConfirm: (method: PaymentMethodId) => void;
  onBack: () => void;
};

/**
 * Paso 3: método de pago (RF-06). En la Fase 3 solo está disponible la transferencia; los pagos con
 * Stripe se muestran deshabilitados hasta las Fases 5 y 6.
 */
export function PaymentMethodStep({
  program,
  busy = false,
  error = null,
  onConfirm,
  onBack,
}: Props) {
  const [method, setMethod] = useState<PaymentMethodId>("transfer");

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!busy) onConfirm(method);
  }

  return (
    <div className="space-y-6">
      <StepHeading title={PAYMENT_STEP.title} />
      <p className="text-bone/85">{PAYMENT_STEP.lead}</p>

      <div className="flex items-baseline justify-between gap-4 border-2 border-bone/25 p-4">
        <span className="font-display text-2xl font-bold uppercase">{program.name}</span>
        <span className="font-semibold">
          {formatPrice(program.monthlyPrice, program.currency)} / mes
        </span>
      </div>

      <form
        method="post"
        noValidate
        onSubmit={onSubmit}
        className="space-y-6"
        aria-label={PAYMENT_STEP.title}
      >
        <fieldset>
          <legend className="sr-only">{PAYMENT_STEP.title}</legend>
          <div className="grid gap-3">
            {PAYMENT_STEP.methods.map((option) => {
              const checked = method === option.id;
              return (
                <label
                  key={option.id}
                  className={`flex gap-4 border-2 p-4 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-volt ${
                    !option.available
                      ? "cursor-not-allowed border-bone/10 text-bone/50"
                      : checked
                        ? "cursor-pointer border-volt bg-volt/10"
                        : "cursor-pointer border-bone/25 hover:border-bone/60"
                  }`}
                >
                  <input
                    type="radio"
                    name="paymentMethod"
                    value={option.id}
                    checked={checked}
                    disabled={!option.available}
                    onChange={() => setMethod(option.id)}
                    className="mt-1 size-5 shrink-0 accent-volt"
                  />
                  <span>
                    <span className="block font-semibold">{option.name}</span>
                    <span className="block text-sm text-bone/70">
                      {option.available ? option.description : PAYMENT_STEP.unavailable}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <button
          type="submit"
          disabled={busy}
          aria-busy={busy}
          className={`w-full sm:w-auto ${buttonPrimary}`}
        >
          {PAYMENT_STEP.submit}
        </button>
        <p role="alert" className="min-h-6 font-semibold text-volt">
          {error ?? ""}
        </p>
      </form>

      <button
        type="button"
        onClick={onBack}
        className="text-sm font-semibold text-bone/70 underline underline-offset-4 hover:text-volt"
      >
        {PAYMENT_STEP.back}
      </button>
    </div>
  );
}
