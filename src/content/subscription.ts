/**
 * Textos de "Administrar mi suscripción" (Fase 7, RF-19, DECISIONS A21, A33): la página
 * `/suscripcion`, el acceso al Stripe Customer Portal y sus respuestas.
 */

/** Ruta de la página "Administrar mi suscripción". */
export const SUBSCRIPTION_PAGE_PATH = "/suscripcion";

/** Enlace del pie de página y de los correos de la suscripción. */
export const MANAGE_SUBSCRIPTION_LINK = "Administrar mi suscripción";

export const SUBSCRIPTION_PAGE = {
  metaTitle: "Administrar mi suscripción",
  metaDescription:
    "Cancela tu suscripción, cambia de programa o actualiza tu tarjeta después de verificar tu correo.",
  eyebrow: "Suscripción mensual",
  title: "Administrar mi suscripción",
  lead: "Escribe el correo con el que te suscribiste. Te enviaremos un código para confirmar que eres tú.",
  emailLabel: "Correo electrónico",
  emailPlaceholder: "tu@correo.com",
  submit: "Enviar código",
  portalIntro:
    "En el portal de Stripe puedes cancelar tu suscripción (sigue activa hasta el final del mes que ya pagaste), cambiar de programa (aplica en tu siguiente renovación) o actualizar tu tarjeta.",
  redirecting: "Te estamos llevando al portal de Stripe…",
  openPortal: "Abrir el portal",
  noSubscriptionTitle: "No encontramos una suscripción activa",
  noSubscription:
    "Este correo no tiene una suscripción mensual activa. Si pagaste por transferencia o con pago único, tu mes no se renueva solo: no hay nada que cancelar.",
  noSubscriptionHelp: "¿Tienes dudas? Escríbele a Ferro por WhatsApp.",
  whatsappCta: "Escribirle a Ferro",
  tryOtherEmail: "Probar con otro correo",
  backHome: "Volver al inicio",
  whatsappMessage: "Hola Ferro, tengo una duda sobre mi suscripción a THE HYBRID METHOD.",
} as const;

/** Respuestas de `POST /api/portal` (SDD §7.7). */
export const PORTAL_MESSAGES = {
  /** Igual exista o no el cliente (no revela qué correos están registrados). */
  notFound: SUBSCRIPTION_PAGE.noSubscription,
  unavailable:
    "No pudimos abrir el portal de la suscripción en este momento. Intenta de nuevo en unos minutos.",
} as const;
