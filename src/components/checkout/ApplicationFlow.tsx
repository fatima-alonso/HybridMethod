"use client";

import { useState } from "react";

import { FLOW_ERRORS, PAYMENT_TYPE_LABELS } from "@/content/checkout";
import type { ProgramSlug } from "@/content/programs";
import { ApplicationForm, type ApplicationFormValues } from "@/components/forms/ApplicationForm";
import type { PhoneCountryOption } from "@/lib/phone";
import type { TransferRequestBody } from "@/lib/validations";
import type { ProgramOption } from "@/types/program";

import {
  isPendingSummary,
  postJson,
  type ApiFailure,
  type PendingSummary,
  type TransferCreated,
} from "./api";
import { PaymentMethodStep } from "./PaymentMethodStep";
import { PendingChoiceStep } from "./PendingChoiceStep";
import { TransferPendingStep } from "./TransferPendingStep";
import { VerifyCodeStep } from "./VerifyCodeStep";

type Step =
  | { name: "form" }
  | { name: "verify"; notice: string | null }
  | { name: "payment" }
  | { name: "pendingChoice"; pending: PendingSummary }
  | { name: "pending"; transfer: TransferCreated };

type Props = {
  programs: readonly ProgramOption[];
  countries: readonly PhoneCountryOption[];
  preselectedProgram?: ProgramSlug;
};

function failureMessage(result: ApiFailure): string {
  if (result.status === 0) return FLOW_ERRORS.network;
  return result.message || FLOW_ERRORS.generic;
}

/**
 * Flujo de contratación (SDD §8.1, §8.4, DECISIONS A4):
 * formulario → código de verificación → método de pago → transferencia pendiente.
 *
 * Los datos del formulario se quedan en el navegador hasta crear la contratación; el servidor los
 * vuelve a validar y toma el correo de la sesión de verificación, no del body.
 */
export function ApplicationFlow({ programs, countries, preselectedProgram }: Props) {
  const [step, setStep] = useState<Step>({ name: "form" });
  const [values, setValues] = useState<ApplicationFormValues | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestCode = (email: string) => postJson("/api/verification/request", { email });

  async function onFormSubmit(next: ApplicationFormValues) {
    setValues(next);
    setBusy(true);
    setError(null);
    const result = await requestCode(next.email);
    setBusy(false);
    if (!result.ok) {
      setError(failureMessage(result));
      return;
    }
    setStep({ name: "verify", notice: null });
  }

  /** Al terminar: formulario vacío y regreso al inicio de la página. */
  function finish() {
    setValues(undefined);
    setError(null);
    setStep({ name: "form" });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function backToForm() {
    setError(null);
    setStep({ name: "form" });
  }

  async function onConfirmPayment(pendingAction?: "continue" | "change") {
    if (!values || values.program === "") return;
    setBusy(true);
    setError(null);
    const body: TransferRequestBody = {
      fullName: values.fullName,
      whatsapp: { country: values.whatsappCountry, number: values.whatsapp },
      program: values.program,
      privacyAccepted: values.privacyAccepted as true,
      ...(pendingAction ? { pendingAction } : {}),
    };
    const result = await postJson<TransferCreated>("/api/transfers", body);
    if (result.ok) {
      setBusy(false);
      setStep({ name: "pending", transfer: result.data });
      return;
    }
    if (result.error === "pending_contract_exists" && isPendingSummary(result.body?.pending)) {
      // Ya tiene un registro pendiente de otro programa o modalidad: se le pregunta (A20).
      setBusy(false);
      setStep({ name: "pendingChoice", pending: result.body.pending });
      return;
    }
    if (result.error === "verification_required") {
      // La sesión de 30 minutos venció: se pide otro código y se vuelve a verificar.
      const resent = await requestCode(values.email);
      setBusy(false);
      if (resent.ok) {
        setStep({ name: "verify", notice: FLOW_ERRORS.sessionExpired });
      } else {
        setError(failureMessage(resent));
      }
      return;
    }
    setBusy(false);
    setError(failureMessage(result));
  }

  switch (step.name) {
    case "form":
      return (
        <ApplicationForm
          programs={programs}
          countries={countries}
          preselectedProgram={preselectedProgram}
          initialValues={values}
          onSubmit={onFormSubmit}
          busy={busy}
          serverError={error}
        />
      );
    case "verify":
      return (
        <VerifyCodeStep
          email={values?.email ?? ""}
          notice={step.notice}
          onVerified={() => {
            setError(null);
            setStep({ name: "payment" });
          }}
          onBack={backToForm}
          onResend={() => requestCode(values?.email ?? "")}
        />
      );
    case "payment": {
      const program = programs.find((p) => p.slug === values?.program);
      if (!program) return null;
      return (
        <PaymentMethodStep
          program={program}
          busy={busy}
          error={error}
          onConfirm={() => onConfirmPayment()}
          onBack={backToForm}
        />
      );
    }
    case "pendingChoice": {
      const program = programs.find((p) => p.slug === values?.program);
      return (
        <PendingChoiceStep
          pending={step.pending}
          requested={`${program?.name ?? ""} · ${PAYMENT_TYPE_LABELS.transfer}`}
          busy={busy}
          error={error}
          onChoose={(action) => onConfirmPayment(action)}
          onBack={() => {
            setError(null);
            setStep({ name: "payment" });
          }}
        />
      );
    }
    case "pending":
      return <TransferPendingStep transfer={step.transfer} onDone={finish} />;
  }
}
