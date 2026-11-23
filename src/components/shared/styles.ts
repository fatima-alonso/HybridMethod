/** Clases reutilizables de botones (CTA). Volt solo para la acción principal (regla 70/20/10). */
const base =
  "inline-flex items-center justify-center gap-2 px-6 py-3 font-display text-lg font-bold tracking-wide uppercase transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60";

export const buttonPrimary = `${base} bg-volt text-ink hover:bg-bone focus-visible:outline-volt`;
export const buttonSecondary = `${base} border-2 border-bone text-bone hover:bg-bone hover:text-ink focus-visible:outline-volt`;
export const buttonDark = `${base} bg-ink text-bone hover:bg-volt hover:text-ink focus-visible:outline-ink`;
