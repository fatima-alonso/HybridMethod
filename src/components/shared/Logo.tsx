import Image from "next/image";

/**
 * Logotipo oficial (SRS §4.1). Versiones con fondo transparente para fondos oscuros, generadas a
 * partir de los originales en `docs/brand/`.
 * - `horizontal`: header (HM | THE HYBRID METHOD · BY FERRO FITS).
 * - `stacked`: footer (HM sobre THE HYBRID METHOD · BY FERRO FITS).
 */
const VARIANTS = {
  horizontal: { src: "/logos/hm-logo-horizontal.png", width: 1090, height: 128 },
  stacked: { src: "/logos/hm-logo.png", width: 1125, height: 300 },
} as const;

type Props = {
  variant: keyof typeof VARIANTS;
  className?: string;
  /** Precargar la imagen (solo para el logo visible al cargar la página). */
  priority?: boolean;
};

export function Logo({ variant, className = "", priority = false }: Props) {
  return (
    <Image
      {...VARIANTS[variant]}
      alt="THE HYBRID METHOD by Ferro Fits"
      priority={priority}
      className={`h-auto ${className}`}
    />
  );
}
