/**
 * Textos del registro de la entrega del plan (DECISIONS A19): la página del botón y los mensajes
 * de `POST /api/plan-delivery/confirm`.
 */
export const DELIVERY_PAGE = {
  metaTitle: "Registrar entrega del plan · THE HYBRID METHOD",
  title: "Registrar entrega del plan",
  readOnlyNote:
    "Abrir este enlace no registra nada. La fecha solo se guarda cuando presionas «Confirmar entrega». Es solo de referencia: no cambia el periodo ni los cobros.",
  labels: {
    customerName: "Cliente",
    programName: "Programa",
    reference: "Referencia",
    amount: "Importe",
    paidAt: "Fecha de pago",
    period: "Periodo",
  },
  period: (start: string, end: string) => `Del ${start} al ${end}`,
  dateLabel: "Fecha de entrega",
  dateHint: "Hoy por defecto. Cámbiala si entregaste el plan otro día.",
  confirm: "Confirmar entrega",
  confirming: "Guardando…",
  confirmedTitle: "Fecha de entrega del plan confirmada",
  confirmed: (date: string) => `Entrega registrada el ${date}.`,
  alreadyTitle: "Entrega ya registrada",
  invalidTitle: "Enlace no válido o vencido",
  invalid:
    "Este botón ya no funciona. Si la entrega sigue pendiente, el siguiente recordatorio traerá un botón nuevo.",
  unavailable: "No se pudo cargar la información. Intenta de nuevo en unos minutos.",
  networkError: "No hubo conexión con el servidor. Revisa tu internet e intenta de nuevo.",
  genericError: "Ocurrió un error. Intenta de nuevo en unos minutos.",
} as const;

export const DELIVERY_API_MESSAGES = {
  linkNotFound: DELIVERY_PAGE.invalid,
  linkExpired: DELIVERY_PAGE.invalid,
  future: "La fecha de entrega no puede ser futura.",
  beforePayment: "La fecha de entrega no puede ser anterior al día del pago.",
} as const;

const dateFormatter = new Intl.DateTimeFormat("es-MX", {
  timeZone: "UTC",
  dateStyle: "long",
});

/** "2026-11-27" → "27 de noviembre de 2026" (la fecha no tiene hora: se formatea en UTC). */
export function formatDateString(value: string): string {
  return dateFormatter.format(new Date(`${value}T00:00:00Z`));
}
