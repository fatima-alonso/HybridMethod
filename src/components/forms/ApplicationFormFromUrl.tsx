"use client";

import { useSearchParams } from "next/navigation";

import { PROGRAM_QUERY_PARAM } from "@/content/landing";
import { isProgramSlug } from "@/content/programs";

import { ApplicationForm } from "./ApplicationForm";

/** Lee `?programa=<slug>` de la URL y lo preselecciona en el formulario (RF-03). */
export function ApplicationFormFromUrl() {
  const value = useSearchParams().get(PROGRAM_QUERY_PARAM);
  return <ApplicationForm preselectedProgram={isProgramSlug(value) ? value : undefined} />;
}
