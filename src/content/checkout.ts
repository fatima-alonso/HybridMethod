/**
 * Textos del flujo de contratación (Fase 3): verificación del correo, método de pago y
 * transferencia pendiente. Los usan la interfaz y las rutas de la API.
 */

import { formatBusinessDate } from "@/utils/format";

/** Respuesta de `POST /api/verification/request`: igual exista o no el correo (RF-15). */
export const VERIFICATION_REQUESTED_MESSAGE = "Si el correo es válido, recibirás un código.";

/** Mensaje prellenado de WhatsApp de la pantalla de transferencia pendiente (RF-10). */
export function transferWhatsAppMessage(programName: string, reference: string): string {
  return `Hola Ferro, acabo de solicitar mi inscripción a ${programName}. Mi referencia es ${reference}. Quería avisarte sobre mi transferencia.`;
}

/** Respuestas de las reglas de contratación (SDD §7.3, DECISIONS A20). */
export const CONTRACT_RULE_MESSAGES = {
  pendingExists: "Encontramos un registro pendiente a tu nombre.",
  subscriptionActive:
    "Ya tienes una suscripción activa. Para cambiar de programa, hazlo desde la administración de tu suscripción.",
  /** Mes con mes, sin pagos por adelantado (DECISIONS A28). */
  activePeriod: (activeUntil: Date) =>
    `Ya tienes un mes pagado hasta el ${formatBusinessDate(activeUntil)}. Podrás pagar tu siguiente mes a partir de ese día.`,
  pendingNotTransfer:
    "Tu registro pendiente es de pago con tarjeta. Para pagarlo por transferencia, elige «Cambiar».",
  pendingNotCard:
    "Tu registro pendiente es de otra modalidad. Para pagarlo con tarjeta, elige «Cambiar».",
} as const;

/** Pago con tarjeta (Stripe Checkout, Fase 5). */
export const CHECKOUT_MESSAGES = {
  unavailable:
    "El pago con tarjeta no está disponible en este momento. Puedes pagar por transferencia o intentarlo más tarde.",
  inProgress:
    "Ya recibimos tu pago con tarjeta y Stripe lo está confirmando. Te avisaremos por correo en cuanto quede listo.",
} as const;

/** Paso del formulario de pago de Stripe incrustado (DECISIONS A27, A29). */
export const CARD_STEP = {
  title: "Paga con tarjeta",
  lead: "Completa tu pago en el formulario seguro de Stripe. Nosotros nunca vemos ni guardamos los datos de tu tarjeta.",
  referenceLabel: "Referencia",
  back: "Elegir otra forma de pago",
  loading: "Cargando el formulario de pago seguro…",
  loadError:
    "No pudimos cargar el formulario de pago. Revisa tu conexión, vuelve a intentarlo o elige transferencia.",
  confirmError:
    "No se pudo completar el pago. Revisa los datos de tu tarjeta e inténtalo de nuevo.",
} as const;

/** Nombre de cada modalidad para el aviso del pendiente. */
export const PAYMENT_TYPE_LABELS: Record<string, string> = {
  transfer: "Transferencia",
  one_time: "Pago único",
  subscription: "Suscripción mensual",
};

/** Paso "¿continuar o cambiar?" cuando el cliente ya tiene un pendiente (DECISIONS A20). */
export const PENDING_STEP = {
  title: "Tienes un registro pendiente",
  found: (summary: string) => `Encontramos un registro pendiente: ${summary}.`,
  question: (requested: string) => `¿Quieres continuar con él o cambiarlo a ${requested}?`,
  continue: "Continuar con el pendiente",
  change: (requested: string) => `Cambiar a ${requested}`,
  back: "Volver",
};

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
  lead: "Tu correo está verificado. La suscripción mensual tiene 10 % de descuento.",
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
      description:
        "Pagas un mes aquí mismo, en el formulario seguro de Stripe. Tu plan empieza en cuanto se confirma tu pago.",
      available: true,
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
  keepReference: "Guarda tu referencia: la necesitarás para tu transferencia.",
  done: "Volver al inicio",
};

export const FLOW_ERRORS = {
  network: "No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.",
  generic: "Ocurrió un error. Intenta de nuevo en unos minutos.",
  sessionExpired: "Tu verificación venció. Te enviamos un código nuevo para continuar.",
};

/**
 * Página de regreso de Stripe Checkout (SDD §7.5): solo informa. El pago lo confirma el webhook,
 * nunca estas páginas, así que no muestran ni cambian ningún dato del contrato.
 */
export const CHECKOUT_RETURN_PAGES = {
  success: {
    metaTitle: "Pago enviado · THE HYBRID METHOD",
    title: "¡Gracias!",
    lead: "Stripe está procesando tu pago. En cuanto lo confirme te llegarán por correo tu confirmación de compra y la bienvenida a tu programa.",
    steps: [
      "Revisa tu correo (y la carpeta de spam) en los próximos minutos.",
      "Si pagaste en efectivo o con otro método que tarda en confirmarse, te avisaremos cuando se acredite.",
      "Ferro te escribirá por WhatsApp y te entregará tu plan en 3 a 5 días hábiles.",
    ],
    home: "Volver al inicio",
  },
} as const;
