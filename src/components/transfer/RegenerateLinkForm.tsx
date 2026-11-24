"use client";

import { useId, useState, type FormEvent } from "react";

import { postJson } from "@/components/checkout/api";
import { useHydrated } from "@/components/shared/useHydrated";
import { buttonPrimary } from "@/components/shared/styles";
import { CONFIRM_PAGE } from "@/content/transfer-approval";
import { transferRegenerateSchema } from "@/lib/validations";

import { inputClass } from "./styles";

type Props = {
  /** Referencia conocida (del enlace vencido). Si falta, Ferro la escribe. */
  reference?: string | null;
};

/**
 * Regenera el enlace de confirmación (RF-20): `POST /api/transfers/regenerate` con la referencia
 * y el PIN. El enlace nuevo llega solo al correo de Ferro.
 */
export function RegenerateLinkForm({ reference = null }: Props) {
  const [referenceValue, setReferenceValue] = useState(reference ?? "");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const id = useId();
  const hydrated = useHydrated();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const parsed = transferRegenerateSchema.safeParse({ reference: referenceValue, pin });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? CONFIRM_PAGE.genericError);
      return;
    }
    setBusy(true);
    setError(null);
    const result = await postJson<{ message: string }>("/api/transfers/regenerate", parsed.data);
    setBusy(false);
    setPin("");
    if (result.ok) {
      setDone(result.data.message);
      return;
    }
    setError(
      result.status === 0 ? CONFIRM_PAGE.networkError : result.message || CONFIRM_PAGE.genericError,
    );
  }

  if (done) {
    return (
      <p role="status" className="border-2 border-volt p-5 font-semibold">
        {done}
      </p>
    );
  }

  return (
    <form
      method="post"
      noValidate
      onSubmit={onSubmit}
      aria-labelledby={`${id}-title`}
      className="space-y-5 border-t border-bone/15 pt-8"
    >
      <h2 id={`${id}-title`} className="font-display text-3xl font-extrabold uppercase">
        {CONFIRM_PAGE.regenerateTitle}
      </h2>
      <p className="text-bone/85">{CONFIRM_PAGE.regenerateLead}</p>

      {reference ? (
        <p>
          <span className="text-bone/70">{CONFIRM_PAGE.referenceLabel}: </span>
          <span className="font-mono font-bold text-volt">{reference}</span>
        </p>
      ) : (
        <div>
          <label htmlFor={`${id}-reference`} className="font-semibold">
            {CONFIRM_PAGE.referenceLabel}
          </label>
          <input
            id={`${id}-reference`}
            name="reference"
            type="text"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="HM-2026-000001"
            value={referenceValue}
            onChange={(e) => setReferenceValue(e.target.value)}
            className={`${inputClass} max-w-80 font-mono`}
          />
        </div>
      )}

      <div>
        <label htmlFor={`${id}-pin`} className="font-semibold">
          {CONFIRM_PAGE.pinLabel}
        </label>
        <input
          id={`${id}-pin`}
          name="pin"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={12}
          value={pin}
          onChange={(e) => {
            setPin(e.target.value);
            setError(null);
          }}
          aria-invalid={Boolean(error)}
          aria-describedby={`${id}-error`}
          className={`${inputClass} max-w-60 font-mono tracking-[0.3em]`}
        />
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
        {busy ? CONFIRM_PAGE.regenerating : CONFIRM_PAGE.regenerate}
      </button>
    </form>
  );
}
