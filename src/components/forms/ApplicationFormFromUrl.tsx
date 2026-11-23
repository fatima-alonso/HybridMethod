"use client";

import { useSearchParams } from "next/navigation";

import { PROGRAM_QUERY_PARAM } from "@/content/landing";
import { isProgramSlug } from "@/content/programs";
import type { ProgramOption } from "@/types/program";

import { ApplicationForm } from "./ApplicationForm";

/** Lee `?programa=<slug>` de la URL y lo preselecciona en el formulario (RF-03). */
export function ApplicationFormFromUrl({ programs }: { programs: readonly ProgramOption[] }) {
  const value = useSearchParams().get(PROGRAM_QUERY_PARAM);
  const available = isProgramSlug(value) && programs.some((p) => p.slug === value);
  return <ApplicationForm programs={programs} preselectedProgram={available ? value : undefined} />;
}
