import Link from "next/link";

import { Container } from "@/components/shared/Container";
import type { LegalDocument } from "@/content/legal";

/** Muestra un documento legal de `src/content/legal.ts`. Hoy es un borrador (DECISIONS A22). */
export function LegalDocumentView({ document }: { document: LegalDocument }) {
  return (
    <Container className="py-20 sm:py-28">
      <article className="max-w-3xl">
        <h1 className="text-5xl sm:text-7xl">{document.title}</h1>
        <p className="mt-4 text-sm text-bone/70">
          Borrador · Última actualización: {document.updatedAt}
        </p>
        <p className="mt-8 text-lg text-bone/90">{document.intro}</p>
        {document.sections.map((section) => (
          <section key={section.heading} className="mt-10">
            <h2 className="text-3xl sm:text-4xl">{section.heading}</h2>
            {section.items ? (
              <ul className="mt-4 list-disc space-y-2 pl-6 text-bone/90">
                {section.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : null}
            {section.paragraphs?.map((paragraph) => (
              <p key={paragraph} className="mt-4 text-bone/90">
                {paragraph}
              </p>
            ))}
          </section>
        ))}
        <Link
          href="/"
          className="mt-12 inline-block font-semibold underline underline-offset-4 hover:text-volt"
        >
          Volver al inicio
        </Link>
      </article>
    </Container>
  );
}
