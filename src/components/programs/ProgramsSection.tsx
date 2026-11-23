import { PROGRAMS } from "@/content/programs";
import { PROGRAMS_SECTION, SECTION_IDS } from "@/content/landing";
import { Container } from "@/components/shared/Container";
import { SectionHeading } from "@/components/shared/SectionHeading";

import { ProgramCard } from "./ProgramCard";

export function ProgramsSection() {
  return (
    <section
      id={SECTION_IDS.programs}
      aria-labelledby="programs-title"
      className="scroll-mt-16 border-t border-bone/10 py-20 sm:py-28"
    >
      <Container>
        <SectionHeading
          id="programs-title"
          title={PROGRAMS_SECTION.title}
          lead={PROGRAMS_SECTION.lead}
        />
        <div className="mt-12 grid gap-6 lg:grid-cols-3">
          {PROGRAMS.map((program) => (
            <ProgramCard key={program.slug} program={program} />
          ))}
        </div>
      </Container>
    </section>
  );
}
