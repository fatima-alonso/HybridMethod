import { ABOUT, SECTION_IDS } from "@/content/landing";
import { Container } from "@/components/shared/Container";
import { ImagePlaceholder } from "@/components/shared/ImagePlaceholder";
import { SectionHeading } from "@/components/shared/SectionHeading";

export function About() {
  return (
    <section
      id={SECTION_IDS.about}
      aria-labelledby="about-title"
      className="scroll-mt-16 border-t border-bone/10 py-20 sm:py-28"
    >
      <Container className="grid gap-12 lg:grid-cols-[1fr_1.2fr] lg:items-center">
        <ImagePlaceholder
          label={ABOUT.imageLabel}
          className="order-last aspect-[4/5] w-full lg:order-first"
        />
        <div>
          <SectionHeading id="about-title" title={ABOUT.title} />
          <p className="mt-6 font-display text-3xl font-bold text-volt uppercase">{ABOUT.kicker}</p>
          {ABOUT.paragraphs.map((paragraph) => (
            <p key={paragraph} className="mt-4 text-lg text-bone/80">
              {paragraph}
            </p>
          ))}
          <dl className="mt-10 grid grid-cols-3 gap-4 border-t border-bone/15 pt-6">
            {ABOUT.stats.map((stat) => (
              <div key={stat.label} className="flex flex-col-reverse">
                <dt className="text-sm text-bone/65">{stat.label}</dt>
                <dd className="font-display text-4xl font-extrabold sm:text-5xl">{stat.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Container>
    </section>
  );
}
