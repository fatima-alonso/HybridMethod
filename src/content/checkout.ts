/**
 * Textos del flujo de contratación (Fase 3): verificación del correo, método de pago y
 * transferencia pendiente. Los usan la interfaz y las rutas de la API.
 */

/** Respuesta de `POST /api/verification/request`: igual exista o no el correo (RF-15). */
export const VERIFICATION_REQUESTED_MESSAGE = "Si el correo es válido, recibirás un código.";

/** Mensaje prellenado de WhatsApp de la pantalla de transferencia pendiente (RF-10). */
export function transferWhatsAppMessage(programName: string, reference: string): string {
  return `Hola Ferro, acabo de solicitar mi inscripción a ${programName}. Mi referencia es ${reference}. Quería avisarte sobre mi transferencia.`;
}

export const VERIFY_STEP = {
  title: "Verifica tu correo",
  lead: (email: string) =>
    `Te enviamos un código de 6 dígitos a ${email}. Vence en 10 minutos. Revisa también tu carpeta de spam.`,
  codeLabel: "Código de verificación",
  submit: "Verificar",
  resend: "Reenviar código",
  resendIn: (seconds: number) => `Reenviar código en ${seconds} s`,
  resent: "Te enviamos un código nuevo. El anterior ya no funciona.",
  changeEmail: "Cambiar mis datos",
};

export const PAYMENT_STEP = {
  title: "Elige cómo pagar",
  lead: "Tu correo está verificado. El precio es el mismo en las tres modalidades.",
  submit: "Continuar",
  back: "Cambiar mis datos",
  methods: [
    {
      id: "transfer",
      name: "Transferencia bancaria",
      description:
        "Ferro te envía los datos bancarios por WhatsApp. Tu plan empieza cuando confirma tu pago.",
      available: true,
    },
    {
      id: "one_time",
      name: "Pago único con tarjeta",
      description: "Pagas un mes con Stripe.",
      available: false,
    },
    {
      id: "subscription",
      name: "Suscripción mensual con tarjeta",
      description: "Se renueva cada mes con Stripe hasta que la canceles.",
      available: false,
    },
  ],
  unavailable: "Disponible muy pronto",
} as const;

export const TRANSFER_PENDING = {
  title: "Transferencia pendiente",
  lead: "Tu solicitud quedó registrada. Sigue estos pasos para completar tu pago:",
  referenceLabel: "Tu referencia",
  steps: [
    "Escríbele a Ferro por WhatsApp con el botón de abajo para recibir los datos bancarios.",
    "Haz la transferencia y usa tu referencia como concepto.",
    "Envíale tu comprobante por WhatsApp.",
    "Ferro confirma tu pago y empieza tu plan. Te avisaremos por correo.",
  ],
  whatsapp: "Escribir a Ferro por WhatsApp",
  noWhatsapp: "Ferro te contactará por WhatsApp al número que registraste.",
};

export const FLOW_ERRORS = {
  network: "No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.",
  generic: "Ocurrió un error. Intenta de nuevo en unos minutos.",
  sessionExpired: "Tu verificación venció. Te enviamos un código nuevo para continuar.",
};
