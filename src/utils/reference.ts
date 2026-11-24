/**
 * Referencias de contrato `HM-AAAA-NNNNNN` (SDD §5.3, DECISIONS A14).
 *
 * - `AAAA`: año de creación en la zona horaria del negocio (America/Mexico_City).
 * - `NNNNNN`: consecutivo de la secuencia `contract_reference_seq` de la BD, con ceros a la
 *   izquierda hasta 6 dígitos. No se reinicia cada año (así la unicidad no depende del año) y,
 *   si pasa de 999999, simplemente usa más dígitos.
 */

export const BUSINESS_TIME_ZONE = "America/Mexico_City";

export const CONTRACT_REFERENCE_PATTERN = /^HM-\d{4}-\d{6,}$/;

const yearFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
});

/** Año calendario de `date` en la zona horaria del negocio. */
export function businessYear(date: Date): number {
  return Number(yearFormatter.format(date));
}

export function formatContractReference(year: number, sequence: bigint | number): string {
  const n = BigInt(sequence);
  if (!Number.isInteger(year) || year < 1000 || year > 9999) {
    throw new RangeError(`Año inválido para la referencia: ${year}`);
  }
  if (n < BigInt(1)) throw new RangeError(`Consecutivo inválido para la referencia: ${n}`);
  return `HM-${year}-${n.toString().padStart(6, "0")}`;
}

export function isContractReference(value: string): boolean {
  return CONTRACT_REFERENCE_PATTERN.test(value);
}
