"use client";

import Link from "next/link";
import { useId, useRef, useState, type FormEvent } from "react";

import { APPLICATION } from "@/content/landing";
import type { ProgramSlug } from "@/content/programs";
import { DEFAULT_PHONE_COUNTRY, type PhoneCountryOption } from "@/lib/phone";
import { applicationSchema } from "@/lib/validations";
import { buttonPrimary } from "@/components/shared/styles";
import type { ProgramOption } from "@/types/program";
import { formatPrice } from "@/utils/format";

type FieldName = "fullName" | "email" | "whatsapp" | "program" | "privacyAccepted";
type Values = {
  fullName: string;
  email: string;
  whatsappCountry: string;
  whatsapp: string;
  program: ProgramSlug | "";
  privacyAccepted: boolean;
};
type Errors = Partial<Record<FieldName, string>>;

const FIELD_ORDER: FieldName[] = ["fullName", "email", "whatsapp", "program", "privacyAccepted"];

function validate(values: Values): Errors {
  const { whatsappCountry, whatsapp, ...rest } = values;
  const result = applicationSchema.safeParse({
    ...rest,
    whatsapp: { country: whatsappCountry, number: whatsapp },
  });
  if (result.success) return {};
  const errors: Errors = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0] as FieldName;
    errors[field] ??= issue.message;
  }
  return errors;
}

type Props = {
  /** Programas activos (de la BD, DECISIONS A14). */
  programs: readonly ProgramOption[];
  /** Países para la lada del WhatsApp (se calculan en el servidor, `getPhoneCountryOptions`). */
  countries: readonly PhoneCountryOption[];
  /** Programa preseleccionado desde el CTA de un programa (RF-03). */
  preselectedProgram?: ProgramSlug;
};

/**
 * Formulario Athlete Application (RF-04, RF-05). Fase 1: solo UI y validación en cliente.
 * En la Fase 3 el envío pedirá el código OTP (`POST /api/verification/request`) con el mismo
 * esquema Zod validado también en el servidor.
 */
export function ApplicationForm({ programs, countries, preselectedProgram }: Props) {
  const [values, setValues] = useState<Values>({
    fullName: "",
    email: "",
    whatsappCountry: DEFAULT_PHONE_COUNTRY,
    whatsapp: "",
    program: preselectedProgram ?? "",
    privacyAccepted: false,
  });
  const [errors, setErrors] = useState<Errors>({});
  const [submitted, setSubmitted] = useState(false);
  const [done, setDone] = useState(false);

  // Si el usuario pulsa el CTA de otro programa con el formulario ya montado, se actualiza
  // la selección sin borrar lo que ya escribió (ajuste de estado durante el render).
  const [lastPreselected, setLastPreselected] = useState(preselectedProgram);
  if (preselectedProgram !== lastPreselected) {
    setLastPreselected(preselectedProgram);
    if (preselectedProgram) {
      const next = { ...values, program: preselectedProgram };
      setValues(next);
      if (submitted) setErrors(validate(next));
    }
  }

  const formRef = useRef<HTMLFormElement>(null);
  const uid = useId();
  const ids = Object.fromEntries(FIELD_ORDER.map((f) => [f, `${uid}-${f}`])) as Record<
    FieldName,
    string
  >;
  const errorId = (field: FieldName) => `${ids[field]}-error`;

  function update<K extends keyof Values>(field: K, value: Values[K]) {
    const next = { ...values, [field]: value };
    setValues(next);
    setDone(false);
    if (submitted) setErrors(validate(next));
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    const nextErrors = validate(values);
    setErrors(nextErrors);
    const firstInvalid = FIELD_ORDER.find((field) => nextErrors[field]);
    if (firstInvalid) {
      setDone(false);
      const target =
        firstInvalid === "program"
          ? formRef.current?.querySelector<HTMLInputElement>(`input[name="program"]`)
          : document.getElementById(ids[firstInvalid]);
      target?.focus();
      return;
    }
    // Fase 1: no se envía nada al servidor (ver comentario del componente).
    setDone(true);
  }

  const inputClass = (field: FieldName, size = "block w-full px-4 text-lg") =>
    `mt-2 ${size} border-2 bg-ink py-3 text-bone placeholder:text-bone/45 focus:border-volt focus:outline-none ${
      errors[field] ? "border-volt" : "border-bone/25"
    }`;

  const fieldError = (field: FieldName) =>
    errors[field] ? (
      <p id={errorId(field)} className="mt-2 text-sm font-semibold text-volt">
        {errors[field]}
      </p>
    ) : null;

  const describedBy = (field: FieldName) => (errors[field] ? errorId(field) : undefined);

  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={onSubmit}
      aria-label="Athlete Application"
      className="space-y-6"
    >
      <div>
        <label htmlFor={ids.fullName} className="font-semibold">
          Nombre completo
        </label>
        <input
          id={ids.fullName}
          name="fullName"
          type="text"
          autoComplete="name"
          required
          value={values.fullName}
          onChange={(e) => update("fullName", e.target.value)}
          aria-invalid={Boolean(errors.fullName)}
          aria-describedby={describedBy("fullName")}
          className={inputClass("fullName")}
        />
        {fieldError("fullName")}
      </div>

      <div className="grid gap-6">
        <div>
          <label htmlFor={ids.email} className="font-semibold">
            Correo electrónico
          </label>
          <input
            id={ids.email}
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            value={values.email}
            onChange={(e) => update("email", e.target.value)}
            aria-invalid={Boolean(errors.email)}
            aria-describedby={describedBy("email")}
            className={inputClass("email")}
          />
          {fieldError("email")}
        </div>
        <div>
          <label htmlFor={ids.whatsapp} className="font-semibold">
            WhatsApp
          </label>
          <div className="flex gap-2">
            <select
              name="whatsappCountry"
              autoComplete="tel-country-code"
              aria-label="País de tu número de WhatsApp"
              value={values.whatsappCountry}
              onChange={(e) => update("whatsappCountry", e.target.value)}
              className={inputClass("whatsapp", "w-36 shrink-0 px-2 text-base sm:w-60")}
            >
              {countries.map((country) => (
                <option key={country.code} value={country.code}>
                  {country.label}
                </option>
              ))}
            </select>
            <input
              id={ids.whatsapp}
              name="whatsapp"
              type="tel"
              autoComplete="tel-national"
              inputMode="tel"
              placeholder="55 1234 5678"
              required
              value={values.whatsapp}
              onChange={(e) => update("whatsapp", e.target.value)}
              aria-invalid={Boolean(errors.whatsapp)}
              aria-describedby={[`${ids.whatsapp}-hint`, describedBy("whatsapp")]
                .filter(Boolean)
                .join(" ")}
              className={inputClass("whatsapp", "min-w-0 flex-1 px-4 text-lg")}
            />
          </div>
          <p id={`${ids.whatsapp}-hint`} className="mt-2 text-sm text-bone/65">
            Selecciona el país y escribe tu número sin la lada. Aceptamos números de cualquier país.
          </p>
          {fieldError("whatsapp")}
        </div>
      </div>

      <fieldset aria-describedby={describedBy("program")}>
        <legend className="font-semibold">Programa</legend>
        <div className="mt-2 grid gap-3 sm:grid-cols-3">
          {programs.map((program) => {
            const checked = values.program === program.slug;
            return (
              <label
                key={program.slug}
                className={`flex cursor-pointer flex-col border-2 p-4 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-volt ${
                  checked
                    ? "border-volt bg-volt/10"
                    : errors.program
                      ? "border-volt/60"
                      : "border-bone/25 hover:border-bone/60"
                }`}
              >
                <input
                  type="radio"
                  name="program"
                  value={program.slug}
                  checked={checked}
                  onChange={() => update("program", program.slug)}
                  className="sr-only"
                />
                <span className="font-display text-2xl font-bold uppercase">{program.name}</span>
                <span className="text-sm text-bone/70">
                  {formatPrice(program.monthlyPrice, program.currency)} / mes
                </span>
              </label>
            );
          })}
        </div>
        {fieldError("program")}
      </fieldset>

      <div>
        <div className="flex items-start gap-3">
          <input
            id={ids.privacyAccepted}
            name="privacyAccepted"
            type="checkbox"
            required
            checked={values.privacyAccepted}
            onChange={(e) => update("privacyAccepted", e.target.checked)}
            aria-invalid={Boolean(errors.privacyAccepted)}
            aria-describedby={describedBy("privacyAccepted")}
            className="mt-1 size-5 shrink-0 accent-volt"
          />
          <label htmlFor={ids.privacyAccepted} className="text-bone/85">
            Acepto la{" "}
            <Link
              href="/privacidad"
              target="_blank"
              className="font-semibold text-bone underline underline-offset-4 hover:text-volt"
            >
              política de privacidad
              <span className="sr-only"> (se abre en una pestaña nueva)</span>
            </Link>
            .
          </label>
        </div>
        {fieldError("privacyAccepted")}
      </div>

      <button type="submit" className={`w-full sm:w-auto ${buttonPrimary}`}>
        {APPLICATION.submit}
      </button>

      <p role="status" className="min-h-6 font-semibold text-bone">
        {done ? APPLICATION.pendingNotice : ""}
      </p>
    </form>
  );
}
