import { z } from "zod";

import { PROGRAM_SLUGS } from "@/content/programs";
import { isE164, isPhoneCountry, toE164, type CountryCode } from "@/lib/phone";
import { isValidDateString, type DateString } from "@/utils/business-calendar";

/**
 * Esquemas Zod compartidos entre cliente y servidor (SDD §9.5).
 */

/**
 * WhatsApp tal como lo envía el formulario (RF-05, DECISIONS A11): país elegido (México por
 * defecto) y número local. Se aceptan espacios, guiones, puntos y paréntesis, y un "+" inicial
 * (si el número trae su lada, esa manda sobre el país). Sale ya en formato E.164.
 */
export const whatsappInputSchema = z
  .object({
    country: z.string({ error: "Elige el país de tu número." }).refine(isPhoneCountry, {
      message: "Elige el país de tu número.",
    }),
    number: z
      .string({ error: "Escribe tu número de WhatsApp." })
      .trim()
      .min(1, "Escribe tu número de WhatsApp.")
      .max(30, "El número es demasiado largo.")
      .refine((value) => /^\+?[\d\s().-]+$/.test(value), {
        message: "Usa solo números y, si quieres, la lada con +.",
      }),
  })
  .transform((value, ctx) => {
    const e164 = toE164(value.number, value.country as CountryCode);
    if (!e164) {
      ctx.addIssue({
        code: "custom",
        path: ["number"],
        message: "Ese número no es válido para el país elegido.",
      });
      return z.NEVER;
    }
    return e164;
  });

/** WhatsApp ya normalizado en E.164 (`+525512345678`), como se guarda en Customer (SDD §5.3). */
export const e164Schema = z
  .string({ error: "El WhatsApp debe estar en formato internacional." })
  .refine(isE164, { message: "El WhatsApp debe estar en formato internacional (+52…)." });

/** Correo normalizado: sin espacios alrededor y en minúsculas (SDD §5.3). */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export const fullNameSchema = z
  .string({ error: "Escribe tu nombre completo." })
  .trim()
  .min(1, "Escribe tu nombre completo.")
  .min(3, "Escribe tu nombre completo.")
  .max(120, "El nombre es demasiado largo.");

export const emailSchema = z
  .string({ error: "Escribe tu correo electrónico." })
  .trim()
  .min(1, "Escribe tu correo electrónico.")
  .max(254, "El correo es demasiado largo.")
  .pipe(z.email("Escribe un correo electrónico válido."))
  .transform(normalizeEmail);

/**
 * Datos del cliente que se guardan en Customer (RF-16), con el WhatsApp ya en E.164.
 * Sin `country` del cliente (DECISIONS A1): el país del selector solo sirve para leer el número.
 */
export const customerDataSchema = z.object({
  fullName: fullNameSchema,
  email: emailSchema,
  whatsapp: e164Schema,
});

export type CustomerDataInput = z.input<typeof customerDataSchema>;
export type CustomerData = z.output<typeof customerDataSchema>;

/** Formulario Athlete Application (RF-04, RF-05). */
export const applicationSchema = z.object({
  fullName: fullNameSchema,
  email: emailSchema,
  whatsapp: whatsappInputSchema,
  program: z.enum(PROGRAM_SLUGS, { error: "Elige un programa." }),
  privacyAccepted: z.literal(true, { error: "Debes aceptar la política de privacidad." }),
});

export type ApplicationInput = z.input<typeof applicationSchema>;
export type Application = z.output<typeof applicationSchema>;

// ─── API de la Fase 3 (SDD §7.1, §7.6) ──────────────────────────────────────

/** `POST /api/verification/request`. */
export const verificationRequestSchema = z.object({ email: emailSchema });

/** Código OTP de 6 dígitos. Se toleran espacios y guiones al pegarlo. */
export const otpCodeSchema = z
  .string({ error: "Escribe el código de 6 dígitos." })
  .transform((value) => value.replace(/[\s-]/g, ""))
  .pipe(z.string().regex(/^\d{6}$/, "El código tiene 6 dígitos."));

/** `POST /api/verification/confirm`. */
export const verificationConfirmSchema = z.object({ email: emailSchema, code: otpCodeSchema });

/**
 * `POST /api/transfers`: el formulario completo salvo el correo, que se toma de la sesión de
 * verificación (SDD §7.2). Se vuelve a validar todo en el servidor (RF-05).
 */
export const transferRequestSchema = applicationSchema.omit({ email: true }).extend({
  /** Respuesta a "¿continuar con tu registro pendiente o cambiarlo?" (DECISIONS A20). */
  pendingAction: z.enum(["continue", "change"]).optional(),
});

export type TransferRequestBody = z.input<typeof transferRequestSchema>;

// ─── Confirmación de transferencias (Fase 4, DECISIONS A7) ──────────────────

/** PIN de aprobación de Ferro: de 6 a 12 dígitos. */
export const PIN_MIN_LENGTH = 6;
export const PIN_MAX_LENGTH = 12;
export const PIN_PATTERN = new RegExp(`^\\d{${PIN_MIN_LENGTH},${PIN_MAX_LENGTH}}$`);

export const approvalPinSchema = z
  .string({ error: "Escribe tu PIN." })
  .trim()
  .min(1, "Escribe tu PIN.")
  .regex(PIN_PATTERN, `El PIN tiene de ${PIN_MIN_LENGTH} a ${PIN_MAX_LENGTH} dígitos.`);

/** `POST /api/transfers/confirm`: solo `{ token, pin }` (no existe `reject`, DECISIONS A5). */
export const transferConfirmSchema = z.object({
  token: z.string({ error: "Falta el enlace." }).min(1, "Falta el enlace.").max(128),
  pin: approvalPinSchema,
});

/** `POST /api/transfers/regenerate`. */
export const transferRegenerateSchema = z.object({
  reference: z
    .string({ error: "Escribe la referencia." })
    .trim()
    .toUpperCase()
    .regex(/^HM-\d{4}-\d{6,}$/, "La referencia tiene el formato HM-AAAA-NNNNNN."),
  pin: approvalPinSchema,
});

// ─── Entrega del plan (Fase 4, DECISIONS A19) ───────────────────────────────

/** `POST /api/plan-delivery/confirm`. */
export const planDeliveryConfirmSchema = z.object({
  token: z.string({ error: "Falta el enlace." }).min(1, "Falta el enlace.").max(128),
  deliveredOn: z
    .string({ error: "Elige la fecha de entrega." })
    .refine(isValidDateString, "Elige una fecha válida.")
    .transform((value) => value as DateString),
});
