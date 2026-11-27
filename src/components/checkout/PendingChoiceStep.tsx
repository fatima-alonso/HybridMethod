"use client";

import { PAYMENT_TYPE_LABELS, PENDING_STEP } from "@/content/checkout";
import { buttonPrimary, buttonSecondary } from "@/components/shared/styles";
import { formatPrice } from "@/utils/format";

import type { PendingSummary } from "./api";
import { StepHeading } from "./StepHeading";

type Props = {
  pending: PendingSummary;
  /** Lo que el cliente pidió ahora, p. ej. "HM STRENGTH · Transferencia". */
  requested: string;
  busy?: boolean;
  error?: string | null;
  onChoose: (action: "continue" | "change") => void;
  onBack: () => void;
};

/**
 * El cliente ya tiene un contrato pendiente de otro programa o modalidad (DECISIONS A20).
 * Solo lo ve su dueño: el servidor exige la sesión de verificación de ese correo (RF-15).
 */
export function PendingChoiceStep({
  pending,
  requested,
  busy = false,
  error = null,
  onChoose,
  onBack,
}: Props) {
  const pendingPlan = `${pending.programName} · ${
    PAYMENT_TYPE_LABELS[pending.paymentType] ?? pending.paymentType
  }`;
  const summary = [
    pendingPlan,
    formatPrice(pending.amount, pending.currency),
    pending.reference,
  ].join(" · ");

  return (
    <div className="space-y-6">
      <StepHeading title={PENDING_STEP.title} />
      <p className="text-bone/85">{PENDING_STEP.found(summary)}</p>
      <p className="font-semibold">{PENDING_STEP.question(requested)}</p>
      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          disabled={busy}
          aria-busy={busy}
          onClick={() => onChoose("continue")}
          className={`w-full sm:w-auto ${buttonSecondary}`}
        >
          {PENDING_STEP.continue(pendingPlan)}
        </button>
        <button
          type="button"
          disabled={busy}
          aria-busy={busy}
          onClick={() => onChoose("change")}
          className={`w-full sm:w-auto ${buttonPrimary}`}
        >
          {PENDING_STEP.change(requested)}
        </button>
      </div>
      <p role="alert" className="min-h-6 font-semibold text-volt">
        {error ?? ""}
      </p>
      <button
        type="button"
        onClick={onBack}
        className="text-sm font-semibold text-bone/70 underline underline-offset-4 hover:text-volt"
      >
        {PENDING_STEP.back}
      </button>
    </div>
  );
}
