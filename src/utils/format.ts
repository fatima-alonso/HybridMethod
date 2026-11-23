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
