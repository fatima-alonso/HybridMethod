"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";

import { postJson } from "@/components/checkout/api";
import { useHydrated } from "@/components/shared/useHydrated";
import { buttonPrimary, buttonSecondary } from "@/components/shared/styles";
import { CONFIRM_PAGE } from "@/content/transfer-approval";
import { approvalPinSchema } from "@/lib/validations";
import { formatBusinessDate, formatBusinessDateTime } from "@/utils/format";

import { RegenerateLinkForm } from "./RegenerateLinkForm";
import { inputClass } from "./styles";

type Props = {
  token: string;
  reference: string;
};

type Confirmed = {
  reference: string;
  status: string;
  serviceStartDate: string;
  serviceEndDate: string;
};

/**
 * PIN + "Sí, confirmar pago" / "No, regresar" (RF-11, DECISIONS A5, A7).
 *
 * Solo "Sí, confirmar pago" llama al servidor (`POST /api/transfers/confirm`). "No, regresar"
 * no envía nada: regresa a la página anterior o al inicio, y el contrato sigue pendiente.
 */
export function ConfirmTransferForm({ token, reference }: Props) {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkGone, setLinkGone] = useState(false);
  const [confirmed, setConfirmed] = useState<Confirmed | null>(null);
  const id = useId();
  const hydrated = useHydrated();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const parsed = approvalPinSchema.safeParse(pin);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? CONFIRM_PAGE.genericError);
      return;
    }
    setBusy(true);
    setError(null);
    const result = await postJson<Confirmed>("/api/transfers/confirm", {
      token,
      pin: parsed.data,
    });
    setBusy(false);
    setPin("");
    if (result.ok) {
      setConfirmed(result.data);
      return;
    }
    setError(
      result.status === 0 ? CONFIRM_PAGE.networkError : result.message || CONFIRM_PAGE.genericError,
    );
    if (result.error === "link_unavailable" || result.error === "contract_not_pending") {
      setLinkGone(true);
    }
  }

  function goBack() {
    // Sin solicitudes al servidor: solo navegación (DECISIONS A5).
    if (window.history.length > 1) router.back();
    else router.push("/");
  }

  if (confirmed) {
    return (
      <div role="status" className="space-y-3 border-2 border-volt p-5">
        <h2 className="font-display text-3xl font-extrabold text-volt uppercase">
          {CONFIRM_PAGE.confirmedTitle}
        </h2>
        <p>
          {confirmed.status === "scheduled"
            ? CONFIRM_PAGE.confirmedScheduled(
                confirmed.reference,
                formatBusinessDate(confirmed.serviceStartDate),
                formatBusinessDate(confirmed.serviceEndDate),
              )
            : CONFIRM_PAGE.confirmed(confirmed.reference)}
        </p>
        <p className="text-bone/85">
          {CONFIRM_PAGE.period(
            formatBusinessDateTime(confirmed.serviceStartDate),
            formatBusinessDateTime(confirmed.serviceEndDate),
          )}
        </p>
      </div>
    );
  }

  if (linkGone) {
    return (
      <div className="space-y-8">
        <p role="alert" className="border-2 border-volt p-5 font-semibold">
          {error}
        </p>
        <RegenerateLinkForm reference={reference} />
      </div>
    );
  }

  return (
    <form
      method="post"
      noValidate
      onSubmit={onSubmit}
      className="space-y-5"
      aria-labelledby={`${id}-question`}
    >
      <h2 id={`${id}-question`} className="font-display text-3xl font-extrabold uppercase">
        {CONFIRM_PAGE.question}
      </h2>
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

      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          type="submit"
          disabled={busy || !hydrated}
          aria-busy={busy}
          className={`w-full sm:w-auto ${buttonPrimary}`}
        >
          {busy ? CONFIRM_PAGE.confirming : CONFIRM_PAGE.confirm}
        </button>
        <button type="button" onClick={goBack} className={`w-full sm:w-auto ${buttonSecondary}`}>
          {CONFIRM_PAGE.back}
        </button>
      </div>
      <p className="text-sm text-bone/70">{CONFIRM_PAGE.backNote}</p>
    </form>
  );
}
