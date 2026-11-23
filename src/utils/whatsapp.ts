/**
 * Enlaces `wa.me` (SDD §6.4). No hay integración con la API de WhatsApp: solo enlaces.
 * `number` debe venir en formato internacional, solo dígitos (validado en `src/lib/config.ts`).
 */
export function buildWhatsAppLink(number: string, message?: string): string {
  if (!/^\d{8,15}$/.test(number)) {
    throw new Error("Número de WhatsApp inválido: se esperan 8–15 dígitos sin +");
  }
  const base = `https://wa.me/${number}`;
  return message ? `${base}?text=${encodeURIComponent(message)}` : base;
}
