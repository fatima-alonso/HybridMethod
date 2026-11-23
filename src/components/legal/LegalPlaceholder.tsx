import Link from "next/link";

import { Container } from "@/components/shared/Container";

/**
 * PLACEHOLDER de documento legal. Existe para que los enlaces del formulario y del footer
 * funcionen desde la Fase 1. El texto definitivo se publica en la Fase 8 (DECISIONS B12).
 */
export function LegalPlaceholder({ title }: { title: string }) {
  return (
    <Container className="py-20 sm:py-28">
      <h1 className="text-5xl sm:text-7xl">{title}</h1>
      <p className="mt-6 max-w-2xl text-lg text-bone/80">
        [Documento pendiente] El texto definitivo de este documento se publicará antes del
        lanzamiento.
      </p>
      <Link
        href="/"
        className="mt-10 inline-block font-semibold underline underline-offset-4 hover:text-volt"
      >
        Volver al inicio
      </Link>
    </Container>
  );
}
