"use client";

import { useEffect, useRef } from "react";

/**
 * Encabezado de un paso del flujo. Al aparecer recibe el foco, para que los lectores de pantalla
 * anuncien el cambio de paso y el teclado siga desde ahí.
 */
export function StepHeading({ title }: { title: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <h3
      ref={ref}
      tabIndex={-1}
      className="scroll-mt-24 font-display text-3xl font-extrabold uppercase focus:outline-none sm:text-4xl"
    >
      {title}
    </h3>
  );
}
