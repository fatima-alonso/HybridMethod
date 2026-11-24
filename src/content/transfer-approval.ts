/**
 * Textos de la confirmación manual de transferencias (Fase 4): la página privada de Ferro y los
 * mensajes de `POST /api/transfers/confirm` y `/regenerate`.
 */

export const LINK_PROBLEM_MESSAGES = {
  not_found: "Este enlace no es válido. Revisa que lo hayas copiado completo desde el correo.",
  expired:
    "Este enlace ya venció. El contrato sigue pendiente: genera un enlace nuevo con tu PIN y te llegará por correo.",
  used: "Este enlace ya se usó: el pago de este contrato ya está confirmado.",
  invalidated:
    "Este enlace ya no funciona (se generó uno más reciente o hubo 5 PIN incorrectos). El contrato sigue pendiente: genera un enlace nuevo con tu PIN.",
} as const;

export const API_MESSAGES = {
  invalidPin: (remaining: number) =>
    remaining === 1
      ? "PIN incorrecto. Te queda 1 intento con este enlace."
      : `PIN incorrecto. Te quedan ${remaining} intentos con este enlace.`,
  invalidPinNoLink: "PIN incorrecto.",
  tooManyPinAttempts:
    "PIN incorrecto. Hubo 5 intentos fallidos y este enlace se desactivó. El contrato sigue pendiente: genera un enlace nuevo con tu PIN.",
  contractNotPending:
    "Este contrato ya no está pendiente de pago, así que no hay nada que confirmar.",
  pinNotConfigured:
    "La confirmación con PIN no está configurada en el servidor (falta FERRO_APPROVAL_PIN_HASH).",
  contractNotFound: "No hay un contrato por transferencia con esa referencia.",
  regenerated:
    "Listo. Te enviamos un enlace nuevo a tu correo. Los enlaces anteriores ya no funcionan.",
  regeneratedEmailFailed:
    "Se generó un enlace nuevo, pero no se pudo enviar el correo. Intenta de nuevo en unos minutos.",
} as const;

export const CONFIRM_PAGE = {
  metaTitle: "Confirmar transferencia · THE HYBRID METHOD",
  eyebrow: "Solo para Ferro",
  title: "Confirmar transferencia",
  question: "¿Confirmas que recibiste el pago?",
  readOnlyNote:
    "Abrir este enlace no cambia nada. El pago solo se confirma si escribes tu PIN y eliges «Sí, confirmar pago».",
  labels: {
    customerName: "Cliente",
    customerEmail: "Correo",
    programName: "Programa",
    amount: "Importe",
    method: "Método de pago",
    reference: "Referencia",
    status: "Estado del pago",
    createdAt: "Solicitado",
  },
  statusLabels: {
    pending_payment: "Pendiente de confirmación",
    active: "Pagado · plan activo",
    completed: "Pagado · plan terminado",
    payment_failed: "Pago fallido",
    cancelled: "Cancelado",
  },
  expiresAt: (date: string) => `El enlace vence el ${date} (hora del centro de México).`,
  remainingAttempts: (n: number) =>
    n === 1
      ? "Queda 1 intento de PIN con este enlace."
      : `Quedan ${n} intentos de PIN con este enlace.`,
  pinLabel: "PIN de aprobación",
  confirm: "Sí, confirmar pago",
  confirming: "Confirmando…",
  back: "No, regresar",
  backNote: "«No, regresar» no envía nada: el contrato sigue pendiente.",
  confirmedTitle: "Pago confirmado",
  confirmed: (reference: string) =>
    `El contrato ${reference} quedó activo. El cliente recibirá la confirmación y el correo de bienvenida.`,
  period: (start: string, end: string) => `Periodo del plan: del ${start} al ${end}`,
  usedTitle: "Pago ya confirmado",
  usedAt: (date: string) => `Se confirmó el ${date}.`,
  invalidTitle: "Enlace no disponible",
  notPendingTitle: "Nada que confirmar",
  regenerateTitle: "Generar un enlace nuevo",
  regenerateLead:
    "Escribe la referencia del contrato y tu PIN. El enlace nuevo te llegará por correo y los anteriores dejarán de funcionar.",
  regenerateNotAllowed:
    "Este contrato ya no está pendiente de pago, así que no hace falta un enlace nuevo.",
  referenceLabel: "Referencia del contrato",
  regenerate: "Generar enlace nuevo",
  regenerating: "Generando…",
  home: "Ir al inicio",
  unavailable: "No se pudo cargar la información. Intenta de nuevo en unos minutos.",
  networkError: "No hubo conexión con el servidor. Revisa tu internet e intenta de nuevo.",
  genericError: "Ocurrió un error. Intenta de nuevo en unos minutos.",
} as const;
