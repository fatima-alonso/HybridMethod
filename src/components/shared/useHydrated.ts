"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * `true` cuando React ya hidrató el componente en el navegador. Sirve para deshabilitar un envío
 * antes de que exista el `onSubmit` de React: sin él, el navegador enviaría el formulario por su
 * cuenta (p. ej. con el PIN en la URL).
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
