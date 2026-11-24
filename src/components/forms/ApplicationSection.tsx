import { Suspense } from "react";

import { APPLICATION, SECTION_IDS } from "@/content/landing";
import { Container } from "@/components/shared/Container";
import { SectionHeading } from "@/components/shared/SectionHeading";
import { getPhoneCountryOptions } from "@/lib/phone";
import type { ProgramOption } from "@/types/program";

import { ApplicationFlow } from "@/components/checkout/ApplicationFlow";

import { ApplicationFormFromUrl } from "./ApplicationFormFromUrl";

export function ApplicationSection({ programs }: { programs: readonly ProgramOption[] }) {
  // Solo se pasan al cliente los campos que usa el formulario.
  const options = programs.map(({ slug, name, monthlyPrice, currency }) => ({
    slug,
    name,
    monthlyPrice,
    currency,
  }));
  const countries = getPhoneCountryOptions();
  return (
    <section
      id={SECTION_IDS.application}
      aria-labelledby="application-title"
      className="scroll-mt-16 border-t border-bone/10 bg-ink-soft py-20 sm:py-28"
    >
      <Container className="grid gap-12 lg:grid-cols-[1fr_1.6fr]">
        <SectionHeading id="application-title" title={APPLICATION.title} lead={APPLICATION.lead} />
        {/* useSearchParams necesita un límite de Suspense para poder prerenderizar la página. */}
        <Suspense fallback={<ApplicationFlow programs={options} countries={countries} />}>
          <ApplicationFormFromUrl programs={options} countries={countries} />
        </Suspense>
      </Container>
    </section>
  );
}
