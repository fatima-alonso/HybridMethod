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
      <Container>
        <div className="grid gap-12 lg:grid-cols-[1fr_1.2fr] lg:items-center">
          <ImagePlaceholder
            label={ABOUT.imageLabel}
            className="order-last aspect-[4/5] w-full lg:order-first"
          />
          <div>
            <SectionHeading id="about-title" title={ABOUT.title} />
            <p className="mt-6 font-display text-3xl font-bold text-volt uppercase sm:text-4xl">
              {ABOUT.kicker}
            </p>
            {ABOUT.paragraphs.map((paragraph) => (
              <p key={paragraph} className="mt-4 text-lg text-bone/80">
                {paragraph}
              </p>
            ))}
            <p className="mt-6 text-xl font-semibold text-bone">{ABOUT.closing}</p>
            <p className="mt-6 font-display text-xl font-bold tracking-wide uppercase">
              — {ABOUT.signature.name}{" "}
              <span className="text-bone/60">| {ABOUT.signature.role}</span>
            </p>
          </div>
        </div>

        {/* Indicadores de autoridad, debajo de la fotografía. */}
        <dl className="mt-12 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {ABOUT.stats.map((stat) => (
            <div key={stat.label} className="flex flex-col border border-bone/15 p-4 sm:p-6">
              <dt className="mt-3 text-lg leading-tight font-bold sm:text-xl">{stat.label}</dt>
              <dd className="order-first font-display text-5xl font-extrabold text-volt sm:text-6xl">
                {stat.value}
              </dd>
              <dd className="mt-2 text-sm text-bone/65 sm:text-base">{stat.detail}</dd>
            </div>
          ))}
        </dl>
      </Container>
    </section>
  );
}
