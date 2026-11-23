import { z } from "zod";

import { PROGRAM_SLUGS } from "@/content/programs";

/**
 * Esquemas Zod compartidos entre cliente y servidor (SDD §9.5).
 */

/** Quita espacios, guiones, puntos y paréntesis de un teléfono, conservando un "+" inicial. */
export function normalizePhone(value: string): string {
  const trimmed = value.trim();
  const plus = trimmed.startsWith("+") ? "+" : "";
  return plus + trimmed.replace(/[^\d]/g, "");
}

/**
 * Formato permitido del WhatsApp (RF-05, DECISIONS A11): opcionalmente "+", y 10 a 15 dígitos
 * (10 = número nacional de México; con lada internacional hasta 15, E.164). Se aceptan espacios,
 * guiones, puntos y paréntesis como separadores, que se eliminan al normalizar.
 */
export const phoneSchema = z
  .string({ error: "Escribe tu número de WhatsApp." })
  .trim()
  .min(1, "Escribe tu número de WhatsApp.")
  .refine((value) => /^\+?[\d\s().-]+$/.test(value), {
    message: "Usa solo números y, si quieres, la lada con +.",
  })
  .transform(normalizePhone)
  .refine((value) => /^\+?\d{10,15}$/.test(value), {
    message: "El número debe tener entre 10 y 15 dígitos.",
  });

/** Formulario Athlete Application (RF-04, RF-05). */
export const applicationSchema = z.object({
  fullName: z
    .string({ error: "Escribe tu nombre completo." })
    .trim()
    .min(1, "Escribe tu nombre completo.")
    .min(3, "Escribe tu nombre completo.")
    .max(120, "El nombre es demasiado largo."),
  email: z
    .string({ error: "Escribe tu correo electrónico." })
    .trim()
    .min(1, "Escribe tu correo electrónico.")
    .max(254, "El correo es demasiado largo.")
    .pipe(z.email("Escribe un correo electrónico válido."))
    .transform((value) => value.toLowerCase()),
  whatsapp: phoneSchema,
  program: z.enum(PROGRAM_SLUGS, { error: "Elige un programa." }),
  privacyAccepted: z.literal(true, { error: "Debes aceptar la política de privacidad." }),
});

export type ApplicationInput = z.input<typeof applicationSchema>;
export type Application = z.output<typeof applicationSchema>;
