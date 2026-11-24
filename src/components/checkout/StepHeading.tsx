"use client";

import { useLayoutEffect, useRef } from "react";

/**
 * Encabezado de un paso del flujo. Al aparecer recibe el foco, para que los lectores de pantalla
 * anuncien el cambio de paso y el teclado siga desde ahí. Se usa `useLayoutEffect` para que el foco
 * se aplique en el mismo commit en que aparece el encabezado (con `useEffect` hay un instante en
 * que el paso ya se ve pero el foco sigue en el elemento anterior).
 */
export function StepHeading({ title }: { title: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
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
