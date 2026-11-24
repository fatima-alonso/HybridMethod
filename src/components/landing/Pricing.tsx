import Link from "next/link";

import { PRICING, SECTION_IDS, applicationHref } from "@/content/landing";
import { Container } from "@/components/shared/Container";
import { SectionHeading } from "@/components/shared/SectionHeading";
import type { LandingProgram } from "@/types/program";
import { formatPrice } from "@/utils/format";

export function Pricing({ programs }: { programs: readonly LandingProgram[] }) {
  return (
    <section
      id={SECTION_IDS.pricing}
      aria-labelledby="pricing-title"
      className="scroll-mt-16 py-20 sm:py-28"
    >
      <Container>
        <SectionHeading id="pricing-title" title={PRICING.title} lead={PRICING.lead} />

        <ul className="mt-12 divide-y divide-bone/15 border-y border-bone/15">
          {programs.map((program) => (
            <li
              key={program.slug}
              className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-3 py-6 sm:grid-cols-[1fr_auto_auto] sm:gap-x-8"
            >
              <div>
                <p className="font-display text-3xl font-bold uppercase">{program.name}</p>
                <p className="text-bone/70">{program.summary}</p>
              </div>
              <p className="text-right">
                <span className="font-display text-3xl font-extrabold sm:text-4xl">
                  {formatPrice(program.monthlyPrice, program.currency)}
                </span>{" "}
                <span className="text-bone/65">{PRICING.perMonth}</span>
              </p>
              <Link
                href={applicationHref(program.slug)}
                aria-label={`${PRICING.cta} ${program.name}`}
                className="col-span-2 inline-flex items-center justify-center border-2 border-volt px-5 py-2 font-display text-lg font-bold tracking-wide text-volt uppercase transition-colors hover:bg-volt hover:text-ink sm:col-span-1"
              >
                {PRICING.cta}
              </Link>
            </li>
          ))}
        </ul>

        <h3 className="mt-14 text-3xl">Modalidades de pago</h3>
        <ul className="mt-6 grid gap-4 md:grid-cols-3">
          {PRICING.methods.map((method) => (
            <li key={method.name} className="border border-bone/15 p-5">
              <p className="font-display text-2xl font-bold uppercase">{method.name}</p>
              <p className="mt-2 text-bone/75">{method.body}</p>
            </li>
          ))}
        </ul>

        <ul className="mt-8 space-y-1 text-sm text-bone/65">
          {PRICING.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
