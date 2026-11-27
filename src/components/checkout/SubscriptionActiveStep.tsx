"use client";

import Link from "next/link";
import { useState } from "react";

import { CONTRACT_RULE_MESSAGES, FLOW_ERRORS, SUBSCRIPTION_ACTIVE_STEP } from "@/content/checkout";
import { SUBSCRIPTION_PAGE_PATH } from "@/content/subscription";
import { buttonPrimary } from "@/components/shared/styles";
import { navigation } from "@/utils/navigation";

import { openPortalSession } from "./api";
import { StepHeading } from "./StepHeading";

/**
 * El cliente ya tiene una suscripción activa y no puede contratar otra cosa (SDD §7.3 regla 2,
 * `409 subscription_active`). Como su correo ya está verificado, el botón lo lleva directo al
 * Stripe Customer Portal, donde cambia de programa (DECISIONS A21, A33).
 */
export function SubscriptionActiveStep({ onBack }: { onBack: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openPortal() {
    setBusy(true);
    setError(null);
    const result = await openPortalSession();
    if (result.ok) {
      navigation.assign(result.data.url);
      return;
    }
    setBusy(false);
    setError(result.status === 0 ? FLOW_ERRORS.network : result.message || FLOW_ERRORS.generic);
  }

  return (
    <div className="space-y-6">
      <StepHeading title={SUBSCRIPTION_ACTIVE_STEP.title} />
      <p className="text-bone/85">{CONTRACT_RULE_MESSAGES.subscriptionActive}</p>
      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          disabled={busy}
          aria-busy={busy}
          onClick={openPortal}
          className={`w-full sm:w-auto ${buttonPrimary}`}
        >
          {SUBSCRIPTION_ACTIVE_STEP.manage}
        </button>
      </div>
      <p role="alert" className="min-h-6 font-semibold text-volt">
        {error ?? ""}
      </p>
      {error ? (
        <Link
          href={SUBSCRIPTION_PAGE_PATH}
          className="block text-sm font-semibold underline underline-offset-4 hover:text-volt"
        >
          {SUBSCRIPTION_ACTIVE_STEP.managePage}
        </Link>
      ) : null}
      <button
        type="button"
        onClick={onBack}
        className="text-sm font-semibold text-bone/70 underline underline-offset-4 hover:text-volt"
      >
        {SUBSCRIPTION_ACTIVE_STEP.back}
      </button>
    </div>
  );
}
