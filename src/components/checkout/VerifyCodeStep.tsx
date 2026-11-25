"use client";

import { useEffect, useId, useState, type FormEvent } from "react";

import { FLOW_ERRORS, VERIFY_STEP } from "@/content/checkout";
import { buttonPrimary } from "@/components/shared/styles";
import { otpCodeSchema } from "@/lib/validations";

import { postJson, type ApiFailure, type ApiResult } from "./api";
import { StepHeading } from "./StepHeading";

export const RESEND_COOLDOWN_SECONDS = 60;

type Props = {
  email: string;
  /** Aviso al entrar (p. ej. la sesión venció y se envió otro código). */
  notice?: string | null;
  onVerified: () => void;
  onBack: () => void;
  /** Pide un código nuevo (`POST /api/verification/request`). */
  onResend: () => Promise<ApiResult<unknown>>;
};

function failureMessage(result: ApiFailure): string {
  if (result.status === 0) return FLOW_ERRORS.network;
  return result.message || FLOW_ERRORS.generic;
}

/** Paso 2: el cliente escribe el código OTP (DECISIONS A4, SDD §8.1). */
export function VerifyCodeStep({ email, notice = null, onVerified, onBack, onResend }: Props) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(notice);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);
  const inputId = useId();
  const errorId = `${inputId}-error`;

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const parsed = otpCodeSchema.safeParse(code);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? VERIFY_STEP.codeLabel);
      return;
    }
    setBusy(true);
    setError(null);
    const result = await postJson("/api/verification/confirm", { email, code: parsed.data });
    setBusy(false);
    if (result.ok) {
      onVerified();
      return;
    }
    if (result.retryAfterSeconds) setCooldown((s) => Math.max(s, result.retryAfterSeconds ?? 0));
    setError(failureMessage(result));
    if (result.error === "too_many_attempts" || result.error === "code_expired") setCode("");
  }

  async function resend() {
    if (busy || cooldown > 0) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    const result = await onResend();
    setBusy(false);
    if (result.ok) {
      setCode("");
      setInfo(VERIFY_STEP.resent);
      setCooldown(RESEND_COOLDOWN_SECONDS);
      return;
    }
    setCooldown(result.retryAfterSeconds ?? RESEND_COOLDOWN_SECONDS);
    setError(failureMessage(result));
  }

  return (
    <div className="space-y-6">
      <StepHeading title={VERIFY_STEP.title} />
      <p className="text-bone/85">{VERIFY_STEP.lead(email)}</p>

      <form
        method="post"
        noValidate
        onSubmit={onSubmit}
        className="space-y-4"
        aria-label={VERIFY_STEP.title}
      >
        <div>
          <label htmlFor={inputId} className="font-semibold">
            {VERIFY_STEP.codeLabel}
          </label>
          <input
            id={inputId}
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={9}
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              setError(null);
            }}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? errorId : undefined}
            className={`mt-2 block w-full max-w-60 border-2 bg-ink px-4 py-3 font-mono text-3xl tracking-[0.4em] text-bone focus:border-volt focus:outline-none ${
              error ? "border-volt" : "border-bone/25"
            }`}
          />
          <p id={errorId} role="alert" className="mt-2 min-h-5 text-sm font-semibold text-volt">
            {error ?? ""}
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <button
            type="submit"
            disabled={busy}
            aria-busy={busy}
            className={`w-full sm:w-auto ${buttonPrimary}`}
          >
            {VERIFY_STEP.submit}
          </button>
          <button
            type="button"
            onClick={resend}
            disabled={busy || cooldown > 0}
            className="px-2 py-3 font-semibold text-bone underline underline-offset-4 hover:text-volt disabled:cursor-not-allowed disabled:text-bone/50 disabled:no-underline"
          >
            {cooldown > 0 ? VERIFY_STEP.resendIn(cooldown) : VERIFY_STEP.resend}
          </button>
        </div>
      </form>

      <p role="status" className="min-h-6 text-sm text-bone/80">
        {info ?? ""}
      </p>

      <button
        type="button"
        onClick={onBack}
        className="text-sm font-semibold text-bone/70 underline underline-offset-4 hover:text-volt"
      >
        {VERIFY_STEP.changeEmail}
      </button>
    </div>
  );
}
