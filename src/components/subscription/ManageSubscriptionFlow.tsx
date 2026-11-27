"use client";

import Link from "next/link";
import { useId, useState, type FormEvent } from "react";

import { FLOW_ERRORS } from "@/content/checkout";
import { SUBSCRIPTION_PAGE } from "@/content/subscription";
import { buttonPrimary, buttonSecondary } from "@/components/shared/styles";
import { emailSchema } from "@/lib/validations";
import { navigation } from "@/utils/navigation";

import { openPortalSession, postJson, type ApiFailure } from "../checkout/api";
import { StepHeading } from "../checkout/StepHeading";
import { VerifyCodeStep } from "../checkout/VerifyCodeStep";

type Step =
  | { name: "email" }
  /** `attempt` cambia con cada código nuevo, para que el paso empiece de cero. */
  | { name: "verify"; notice: string | null; attempt: number }
  | { name: "redirecting"; url: string }
  | { name: "notFound" };

type Props = {
  /** Enlace `wa.me` con Ferro, o `null` si no está configurado. */
  whatsappUrl: string | null;
};

function failureMessage(result: ApiFailure): string {
  if (result.status === 0) return FLOW_ERRORS.network;
  return result.message || FLOW_ERRORS.generic;
}

/**
 * "Administrar mi suscripción" (RF-19, SRS §9.4, DECISIONS A21, A33): correo → código → Stripe
 * Customer Portal. El servidor toma el correo de la sesión de verificación, nunca del navegador, y
 * responde lo mismo exista o no el correo (RF-15).
 */
export function ManageSubscriptionFlow({ whatsappUrl }: Props) {
  const [step, setStep] = useState<Step>({ name: "email" });
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputId = useId();
  const errorId = `${inputId}-error`;

  const nextAttempt = () => (step.name === "verify" ? step.attempt + 1 : 1);
  const requestCode = (to: string) => postJson("/api/verification/request", { email: to });

  async function onEmailSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? SUBSCRIPTION_PAGE.emailLabel);
      return;
    }
    setBusy(true);
    setError(null);
    const result = await requestCode(parsed.data);
    setBusy(false);
    if (!result.ok) {
      setError(failureMessage(result));
      return;
    }
    setEmail(parsed.data);
    setStep({ name: "verify", notice: null, attempt: nextAttempt() });
  }

  async function openPortal() {
    setBusy(true);
    setError(null);
    const result = await openPortalSession();
    setBusy(false);
    if (result.ok) {
      setStep({ name: "redirecting", url: result.data.url });
      navigation.assign(result.data.url);
      return;
    }
    if (result.error === "subscription_not_found") {
      setStep({ name: "notFound" });
      return;
    }
    if (result.error === "verification_required") {
      // La sesión de 30 minutos venció: se pide otro código.
      const resent = await requestCode(email);
      if (resent.ok) {
        setStep({ name: "verify", notice: FLOW_ERRORS.sessionExpired, attempt: nextAttempt() });
        return;
      }
      setStep({ name: "email" });
      setError(failureMessage(resent));
      return;
    }
    setStep({ name: "email" });
    setError(failureMessage(result));
  }

  function restart() {
    setError(null);
    setStep({ name: "email" });
  }

  switch (step.name) {
    case "email":
      return (
        <div className="space-y-6">
          <p className="text-lg text-bone/85">{SUBSCRIPTION_PAGE.lead}</p>
          <form
            method="post"
            noValidate
            onSubmit={onEmailSubmit}
            className="space-y-4"
            aria-label={SUBSCRIPTION_PAGE.title}
          >
            <div>
              <label htmlFor={inputId} className="font-semibold">
                {SUBSCRIPTION_PAGE.emailLabel}
              </label>
              <input
                id={inputId}
                name="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                required
                placeholder={SUBSCRIPTION_PAGE.emailPlaceholder}
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError(null);
                }}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? errorId : undefined}
                className={`mt-2 block w-full max-w-md border-2 bg-ink px-4 py-3 text-lg text-bone placeholder:text-bone/45 focus:border-volt focus:outline-none ${
                  error ? "border-volt" : "border-bone/25"
                }`}
              />
              <p id={errorId} role="alert" className="mt-2 min-h-5 text-sm font-semibold text-volt">
                {error ?? ""}
              </p>
            </div>
            <button
              type="submit"
              disabled={busy}
              aria-busy={busy}
              className={`w-full sm:w-auto ${buttonPrimary}`}
            >
              {SUBSCRIPTION_PAGE.submit}
            </button>
          </form>
          <p className="max-w-2xl text-sm text-bone/65">{SUBSCRIPTION_PAGE.portalIntro}</p>
        </div>
      );
    case "verify":
      return (
        <div className="space-y-4">
          <VerifyCodeStep
            key={step.attempt}
            email={email}
            notice={step.notice}
            onVerified={openPortal}
            onBack={restart}
            onResend={() => requestCode(email)}
            backLabel={SUBSCRIPTION_PAGE.tryOtherEmail}
          />
          {busy ? (
            <p role="status" className="text-bone/80">
              {SUBSCRIPTION_PAGE.redirecting}
            </p>
          ) : null}
        </div>
      );
    case "redirecting":
      return (
        <div className="space-y-6">
          <p role="status" className="text-lg text-bone/85">
            {SUBSCRIPTION_PAGE.redirecting}
          </p>
          <a href={step.url} className={buttonPrimary}>
            {SUBSCRIPTION_PAGE.openPortal}
          </a>
        </div>
      );
    case "notFound":
      return (
        <div className="space-y-6">
          <StepHeading title={SUBSCRIPTION_PAGE.noSubscriptionTitle} />
          <p className="text-lg text-bone/85">{SUBSCRIPTION_PAGE.noSubscription}</p>
          <p className="text-bone/75">{SUBSCRIPTION_PAGE.noSubscriptionHelp}</p>
          <div className="flex flex-col gap-3 sm:flex-row">
            {whatsappUrl ? (
              <a
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonPrimary}
              >
                {SUBSCRIPTION_PAGE.whatsappCta}
              </a>
            ) : null}
            <button type="button" onClick={restart} className={buttonSecondary}>
              {SUBSCRIPTION_PAGE.tryOtherEmail}
            </button>
          </div>
          <Link
            href="/"
            className="inline-block font-semibold underline underline-offset-4 hover:text-volt"
          >
            {SUBSCRIPTION_PAGE.backHome}
          </Link>
        </div>
      );
  }
}
