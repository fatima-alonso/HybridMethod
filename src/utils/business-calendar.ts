import { BUSINESS_TIME_ZONE } from "@/utils/reference";

/**
 * Calendario del negocio (America/Mexico_City): fechas sin hora y días hábiles (DECISIONS A19, A25).
 *
 * Las fechas sin hora se manejan como texto `AAAA-MM-DD` para no depender de la zona horaria del
 * servidor. En la BD (`@db.Date`) se guardan como medianoche UTC de ese día.
 */

export type DateString = `${number}-${number}-${number}`;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Día (AAAA-MM-DD) de un instante en la zona del negocio. */
export function businessDate(instant: Date): DateString {
  return dateFormatter.format(instant) as DateString;
}

/** ¿Es una fecha AAAA-MM-DD que existe en el calendario? */
export function isValidDateString(value: string): value is DateString {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const [, y, m, d] = match.map(Number) as [number, number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Valor para una columna `@db.Date`: medianoche UTC de ese día. */
export function dateStringToDbDate(value: DateString): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/** Inverso de `dateStringToDbDate`. */
export function dbDateToDateString(value: Date): DateString {
  return value.toISOString().slice(0, 10) as DateString;
}

function utcDate(value: DateString): Date {
  return dateStringToDbDate(value);
}

function addDays(value: DateString, days: number): DateString {
  const date = utcDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return dbDateToDateString(date);
}

/** n-ésimo lunes (1 = primero) de un mes, como AAAA-MM-DD. */
function nthMonday(year: number, month: number, n: number): DateString {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const offset = (8 - first.getUTCDay()) % 7; // días hasta el primer lunes (getUTCDay: 1 = lunes)
  const day = 1 + offset + (n - 1) * 7;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` as DateString;
}

/**
 * Días de descanso obligatorio en México (Ley Federal del Trabajo, art. 74), DECISIONS A25:
 * 1 de enero; primer lunes de febrero; tercer lunes de marzo; 1 de mayo; 16 de septiembre; tercer
 * lunes de noviembre; 1 de octubre cada seis años (cambio del Poder Ejecutivo: 2024, 2030, …);
 * 25 de diciembre. No incluye los días de jornada electoral, que dependen de cada elección.
 */
export function mexicanHolidays(year: number): Set<DateString> {
  const fixed = (month: number, day: number) =>
    `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` as DateString;
  const holidays = new Set<DateString>([
    fixed(1, 1),
    nthMonday(year, 2, 1),
    nthMonday(year, 3, 3),
    fixed(5, 1),
    fixed(9, 16),
    nthMonday(year, 11, 3),
    fixed(12, 25),
  ]);
  if (year >= 2024 && (year - 2024) % 6 === 0) holidays.add(fixed(10, 1));
  return holidays;
}

/** ¿Es día hábil (lunes a viernes, sin festivos)? */
export function isBusinessDay(value: DateString): boolean {
  const weekday = utcDate(value).getUTCDay();
  if (weekday === 0 || weekday === 6) return false;
  return !mexicanHolidays(Number(value.slice(0, 4))).has(value);
}

/** Días hábiles completos entre dos fechas: los que hay después de `from` hasta `to` inclusive. */
export function businessDaysBetween(from: DateString, to: DateString): number {
  let count = 0;
  for (let day = addDays(from, 1); day <= to; day = addDays(day, 1)) {
    if (isBusinessDay(day)) count += 1;
  }
  return count;
}
