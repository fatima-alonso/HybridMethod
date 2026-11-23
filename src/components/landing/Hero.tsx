import Link from "next/link";

import { HERO, SECTION_IDS, applicationHref } from "@/content/landing";
import { Container } from "@/components/shared/Container";
import { ImagePlaceholder } from "@/components/shared/ImagePlaceholder";
import { buttonPrimary, buttonSecondary } from "@/components/shared/styles";

export function Hero() {
  return (
    <section id={SECTION_IDS.home} aria-labelledby="hero-title" className="relative scroll-mt-16">
      <Container className="grid items-center gap-10 py-14 sm:py-20 lg:grid-cols-[1.1fr_1fr] lg:py-28">
        <div>
          <p className="text-sm font-semibold tracking-[0.3em] text-volt uppercase">
            {HERO.eyebrow}
          </p>
          <h1 id="hero-title" className="mt-4 text-[clamp(3.5rem,13vw,8.5rem)] leading-[0.88]">
            <span className="sr-only">THE HYBRID METHOD: </span>
            {HERO.title.map((line, index) => (
              <span
                key={line}
                className={`block ${index === HERO.title.length - 1 ? "text-volt" : ""}`}
              >
                {line}
              </span>
            ))}
          </h1>
          <p className="mt-6 max-w-xl text-lg text-bone/80 sm:text-xl">{HERO.lead}</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href={`/#${SECTION_IDS.programs}`} className={buttonPrimary}>
              {HERO.primaryCta}
            </Link>
            <Link href={`/#${SECTION_IDS.howItWorks}`} className={buttonSecondary}>
              {HERO.secondaryCta}
            </Link>
          </div>
          <p className="mt-6 text-sm text-bone/60">
            ¿Ya sabes qué quieres?{" "}
            <Link
              href={applicationHref()}
              className="font-semibold text-bone underline underline-offset-4 hover:text-volt"
            >
              Ve directo al registro
            </Link>
          </p>
        </div>
        <ImagePlaceholder label={HERO.imageLabel} className="aspect-[4/5] w-full lg:aspect-[4/5]" />
      </Container>
    </section>
  );
}
