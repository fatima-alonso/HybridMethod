"use client";

import { useSearchParams } from "next/navigation";

import { PROGRAM_QUERY_PARAM } from "@/content/landing";
import { isProgramSlug } from "@/content/programs";
import type { PhoneCountryOption } from "@/lib/phone";
import type { ProgramOption } from "@/types/program";

import { ApplicationFlow } from "@/components/checkout/ApplicationFlow";

/** Lee `?programa=<slug>` de la URL y lo preselecciona en el flujo de contratación (RF-03). */
type Props = {
  programs: readonly ProgramOption[];
  countries: readonly PhoneCountryOption[];
};

export function ApplicationFormFromUrl({ programs, countries }: Props) {
  const value = useSearchParams().get(PROGRAM_QUERY_PARAM);
  const available = isProgramSlug(value) && programs.some((p) => p.slug === value);
  return (
    <ApplicationFlow
      programs={programs}
      countries={countries}
      preselectedProgram={available ? value : undefined}
    />
  );
}
