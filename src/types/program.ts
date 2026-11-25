import type { ProgramSlug } from "@/content/programs";

/**
 * Programa tal como lo muestra la landing: datos comerciales de la BD (nombre, descripción,
 * precio, moneda) más textos editoriales de `src/content/programs.ts` (DECISIONS A14).
 */
export type LandingProgram = {
  slug: ProgramSlug;
  name: string;
  description: string;
  /** Precio mensual como decimal en texto, p. ej. "1200.00" (nunca float). */
  monthlyPrice: `${number}`;
  /** Precio mensual con suscripción (−10 %, DECISIONS A18). */
  subscriptionPrice: `${number}`;
  currency: string;
  /** Descripción corta del SRS §5 (editorial). */
  summary: string;
  /** Puntos clave (editorial). */
  highlights: readonly string[];
  /** Programa destacado visualmente (editorial). */
  featured: boolean;
};

/** Lo mínimo que necesita el formulario para listar los programas. */
export type ProgramOption = Pick<
  LandingProgram,
  "slug" | "name" | "monthlyPrice" | "subscriptionPrice" | "currency"
>;
