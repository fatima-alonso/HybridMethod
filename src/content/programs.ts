/**
 * Catálogo de programas: ÚNICA fuente de nombres, descripciones y precios en el código (SRS §5).
 *
 * - Los precios son cadenas decimales (nunca `number`/float).
 * - Desde la Fase 2 (DECISIONS A14) este catálogo alimenta el seed (`npm run db:seed`), que copia
 *   slug, nombre, descripción, precio, moneda, `active` y orden a la tabla `programs`. La landing y
 *   el servidor leen esos datos de la BD; de aquí solo salen los textos editoriales (`summary`,
 *   `highlights`, `featured`). Para cambiar un precio: editarlo aquí y volver a ejecutar el seed.
 * - Precios finales de Ferro, sin cargos adicionales (DECISIONS A18). La suscripción mensual tiene
 *   10 % de descuento: `subscriptionPrice` = `monthlyPrice` × 0.90, guardado ya redondeado a
 *   centavos (una prueba lo exige). El pago único y la transferencia pagan `monthlyPrice`.
 */

export const PROGRAM_SLUGS = ["hm-run", "hm-strength", "hm-complete"] as const;

export type ProgramSlug = (typeof PROGRAM_SLUGS)[number];

export type Program = {
  slug: ProgramSlug;
  name: string;
  /** Descripción corta del SRS §5. */
  summary: string;
  /** PLACEHOLDER: texto largo que la marca debe reemplazar o aprobar. */
  description: string;
  /** PLACEHOLDER: puntos clave que la marca debe reemplazar o aprobar. */
  highlights: readonly string[];
  /** Precio mensual completo (pago único y transferencia), decimal en texto, p. ej. "1200.00". */
  monthlyPrice: `${number}`;
  /** Precio mensual con suscripción (−10 %, DECISIONS A18), decimal en texto. */
  subscriptionPrice: `${number}`;
  currency: "MXN";
  /** Programa destacado visualmente en la landing. */
  featured: boolean;
  /** Si se puede contratar. El seed lo copia a `Program.active`. */
  active: boolean;
};

export const PROGRAMS: readonly Program[] = [
  {
    slug: "hm-run",
    name: "HM RUN",
    summary: "Running performance, resistencia, ritmos y eficiencia.",
    description:
      "Para correr más rápido, más lejos y con mejor técnica. Planificación por ritmos y zonas para tu próxima carrera.",
    highlights: [
      "Plan de carrera por ritmos y zonas",
      "Trabajo de resistencia y eficiencia",
      "Ajustes según tu progreso",
    ],
    monthlyPrice: "1200.00",
    subscriptionPrice: "1080.00",
    currency: "MXN",
    featured: false,
    active: true,
  },
  {
    slug: "hm-strength",
    name: "HM STRENGTH",
    summary: "Fuerza, hipertrofia y composición corporal.",
    description:
      "Entrenamiento de fuerza estructurado para ganar músculo, fuerza y mejorar tu composición corporal.",
    highlights: [
      "Progresión de cargas planificada",
      "Fuerza e hipertrofia",
      "Enfoque en composición corporal",
    ],
    monthlyPrice: "1500.00",
    subscriptionPrice: "1350.00",
    currency: "MXN",
    featured: false,
    active: true,
  },
  {
    slug: "hm-complete",
    name: "HM COMPLETE",
    summary: "Fuerza, running, HYROX y rendimiento híbrido.",
    description:
      "El método híbrido completo: fuerza y running en un solo plan, con preparación para HYROX.",
    highlights: [
      "Fuerza + running integrados",
      "Preparación para HYROX",
      "Rendimiento híbrido de principio a fin",
    ],
    monthlyPrice: "1800.00",
    subscriptionPrice: "1620.00",
    currency: "MXN",
    featured: true,
    active: true,
  },
];

export function isProgramSlug(value: unknown): value is ProgramSlug {
  return typeof value === "string" && (PROGRAM_SLUGS as readonly string[]).includes(value);
}

export function getProgram(slug: ProgramSlug): Program {
  const program = PROGRAMS.find((p) => p.slug === slug);
  if (!program) throw new Error(`Programa desconocido: ${slug}`);
  return program;
}
