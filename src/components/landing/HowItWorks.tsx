import { HOW_IT_WORKS, SECTION_IDS } from "@/content/landing";
import { Container } from "@/components/shared/Container";
import { SectionHeading } from "@/components/shared/SectionHeading";

/** Sección clara (bone) para el ritmo visual 70/20/10. */
export function HowItWorks() {
  return (
    <section
      id={SECTION_IDS.howItWorks}
      aria-labelledby="how-title"
      className="scroll-mt-16 bg-bone py-20 text-ink sm:py-28"
    >
      <Container>
        <SectionHeading
          id="how-title"
          title={HOW_IT_WORKS.title}
          lead={HOW_IT_WORKS.lead}
          tone="light"
        />
        <ol className="mt-12 grid gap-px bg-ink/15 sm:grid-cols-2 lg:grid-cols-5">
          {HOW_IT_WORKS.steps.map((step, index) => (
            <li key={step.title} className="bg-bone p-6 lg:pt-8">
              <span
                aria-hidden="true"
                className="font-display text-6xl leading-none font-extrabold text-ink/55"
              >
                {String(index + 1).padStart(2, "0")}
              </span>
              <h3 className="mt-4 text-2xl">{step.title}</h3>
              <p className="mt-2 text-ink/75">{step.body}</p>
            </li>
          ))}
        </ol>
      </Container>
    </section>
  );
}
