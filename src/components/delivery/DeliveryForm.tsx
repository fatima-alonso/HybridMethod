"use client";

import { useId, useState, type FormEvent } from "react";

import { postJson } from "@/components/checkout/api";
import { buttonPrimary } from "@/components/shared/styles";
import { useHydrated } from "@/components/shared/useHydrated";
import { inputClass } from "@/components/transfer/styles";
import { DELIVERY_PAGE, formatDateString } from "@/content/plan-delivery";

type Props = {
  token: string;
  defaultDate: string;
  minDate: string;
  maxDate: string;
};

type Confirmed = { deliveredOn: string; alreadyRecorded: boolean };

/**
 * Fecha de entrega (hoy por defecto) + "Confirmar entrega" (SDD §7.8). Solo el botón envía algo
 * al servidor; abrir la página no registra nada.
 */
export function DeliveryForm({ token, defaultDate, minDate, maxDate }: Props) {
  const [date, setDate] = useState(defaultDate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<Confirmed | null>(null);
  const hydrated = useHydrated();
  const id = useId();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!date) {
      setError(DELIVERY_PAGE.dateLabel);
      return;
    }
    setBusy(true);
    setError(null);
    const result = await postJson<Confirmed>("/api/plan-delivery/confirm", {
      token,
      deliveredOn: date,
    });
    setBusy(false);
    if (result.ok) {
      setConfirmed(result.data);
      return;
    }
    setError(
      result.status === 0
        ? DELIVERY_PAGE.networkError
        : result.message || DELIVERY_PAGE.genericError,
    );
  }

  if (confirmed) {
    return (
      <div role="status" className="space-y-2 border-2 border-volt p-5">
        <h2 className="font-display text-3xl font-extrabold text-volt uppercase">
          {confirmed.alreadyRecorded ? DELIVERY_PAGE.alreadyTitle : DELIVERY_PAGE.confirmedTitle}
        </h2>
        <p>{DELIVERY_PAGE.confirmed(formatDateString(confirmed.deliveredOn))}</p>
      </div>
    );
  }

  return (
    <form method="post" noValidate onSubmit={onSubmit} className="space-y-5">
      <div>
        <label htmlFor={`${id}-date`} className="font-semibold">
          {DELIVERY_PAGE.dateLabel}
        </label>
        <input
          id={`${id}-date`}
          name="deliveredOn"
          type="date"
          value={date}
          min={minDate}
          max={maxDate}
          onChange={(e) => {
            setDate(e.target.value);
            setError(null);
          }}
          aria-invalid={Boolean(error)}
          aria-describedby={`${id}-hint ${id}-error`}
          className={`${inputClass} max-w-64 [color-scheme:dark]`}
        />
        <p id={`${id}-hint`} className="mt-2 text-sm text-bone/70">
          {DELIVERY_PAGE.dateHint}
        </p>
        <p id={`${id}-error`} role="alert" className="mt-2 min-h-5 text-sm font-semibold text-volt">
          {error ?? ""}
        </p>
      </div>
      <button
        type="submit"
        disabled={busy || !hydrated}
        aria-busy={busy}
        className={`w-full sm:w-auto ${buttonPrimary}`}
      >
        {busy ? DELIVERY_PAGE.confirming : DELIVERY_PAGE.confirm}
      </button>
    </form>
  );
}
