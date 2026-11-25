import Link from "next/link";

import { PROGRAMS_SECTION, PRICING, applicationHref } from "@/content/landing";
import { buttonPrimary, buttonSecondary } from "@/components/shared/styles";
import type { LandingProgram } from "@/types/program";
import { formatPrice } from "@/utils/format";

export function ProgramCard({ program }: { program: LandingProgram }) {
  const titleId = `program-${program.slug}`;
  return (
    <article
      aria-labelledby={titleId}
      className={`flex flex-col border p-6 sm:p-8 ${program.featured ? "border-volt bg-ink-soft" : "border-bone/15"}`}
    >
      {program.featured ? (
        <p className="mb-4 w-fit bg-volt px-2 py-0.5 text-xs font-bold tracking-widest text-ink uppercase">
          Método completo
        </p>
      ) : null}
      <h3 id={titleId} className="text-4xl">
        {program.name}
      </h3>
      <p className="mt-2 font-semibold text-volt">{program.summary}</p>
      <p className="mt-4 text-bone/75">{program.description}</p>
      <ul className="mt-6 space-y-2">
        {program.highlights.map((item) => (
          <li key={item} className="flex gap-3 text-bone/85">
            <span aria-hidden="true" className="mt-2 block size-1.5 shrink-0 bg-volt" />
            {item}
          </li>
        ))}
      </ul>
      <p className="mt-8 flex items-baseline gap-2">
        <span className="font-display text-4xl font-extrabold">
          {formatPrice(program.monthlyPrice, program.currency)}
        </span>
        <span className="text-bone/65">{PRICING.perMonth}</span>
      </p>
      <p className="mt-1 text-sm font-semibold text-volt">
        {PRICING.withSubscription(formatPrice(program.subscriptionPrice, program.currency))}
      </p>
      <Link
        href={applicationHref(program.slug)}
        className={`mt-6 ${program.featured ? buttonPrimary : buttonSecondary}`}
        aria-label={`${PROGRAMS_SECTION.cta}: ${program.name}`}
      >
        {PROGRAMS_SECTION.cta}
      </Link>
    </article>
  );
}
