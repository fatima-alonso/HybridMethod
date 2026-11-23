/**
 * PLACEHOLDER del wordmark. SRS §4.1: se usarán el logotipo y el wordmark oficiales; reemplazar
 * por el SVG de la marca en `public/logos/` cuando esté disponible.
 */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span
      className={`font-display leading-none font-extrabold tracking-tight uppercase ${className}`}
    >
      The Hybrid <span className="text-volt">Method</span>
    </span>
  );
}
