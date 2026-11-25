/**
 * Formatea un importe decimal en texto (p. ej. "1200.00") sin convertirlo a float.
 * `Intl.NumberFormat` acepta cadenas numéricas y las formatea con precisión decimal exacta.
 */
export function formatPrice(amount: `${number}`, currency: string): string {
  const formatted = new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
  return `${formatted} ${currency}`;
}

const businessDateTimeFormatter = new Intl.DateTimeFormat("es-MX", {
  timeZone: "America/Mexico_City",
  dateStyle: "long",
  timeStyle: "short",
});

const businessDateFormatter = new Intl.DateTimeFormat("es-MX", {
  timeZone: "America/Mexico_City",
  dateStyle: "long",
});

/** Fecha sin hora en la zona del negocio. Ej.: "24 de diciembre de 2026". */
export function formatBusinessDate(date: Date | string): string {
  return businessDateFormatter.format(typeof date === "string" ? new Date(date) : date);
}

/**
 * Fecha y hora en la zona del negocio (America/Mexico_City), para correos y pantallas.
 * Ej.: "24 de noviembre de 2026, 4:00 a.m.".
 */
export function formatBusinessDateTime(date: Date | string): string {
  return businessDateTimeFormatter.format(typeof date === "string" ? new Date(date) : date);
}
