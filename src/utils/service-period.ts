import { BUSINESS_TIME_ZONE } from "@/utils/reference";

/**
 * Periodo de servicio de un mes para pago único y transferencia (DECISIONS B6, aplicada en A17).
 *
 * - Empieza en el momento en que se confirma el pago (RN-05).
 * - Termina el mismo día del mes siguiente, a la misma hora, en la zona horaria del negocio
 *   (America/Mexico_City). Si ese día no existe (31 de enero → febrero), se usa el último día
 *   del mes siguiente.
 *
 * Es el único lugar con esta regla: si Ferro decide otra, se cambia aquí.
 */

type LocalParts = {
  year: number;
  month: number; // 1–12
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
};

const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});

function localParts(date: Date): LocalParts {
  const values: Record<string, number> = {};
  for (const part of partsFormatter.formatToParts(date)) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  return {
    year: values.year!,
    month: values.month!,
    day: values.day!,
    hour: values.hour!,
    minute: values.minute!,
    second: values.second!,
    millisecond: date.getUTCMilliseconds(),
  };
}

/** Diferencia (ms) entre la hora local del negocio y UTC en un instante dado. */
function zoneOffsetMs(date: Date): number {
  const p = localParts(date);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, p.millisecond);
  return asUtc - date.getTime();
}

/** Instante UTC de una fecha y hora locales del negocio. */
function fromLocal(p: LocalParts): Date {
  const naive = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, p.millisecond);
  let result = naive - zoneOffsetMs(new Date(naive));
  // Segundo ajuste por si el desfase cambia entre la suposición y el resultado (horario de verano).
  result = naive - zoneOffsetMs(new Date(result));
  return new Date(result);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Mismo día (o el último del mes si no existe) del mes siguiente, a la misma hora local. */
export function addOneBusinessMonth(date: Date): Date {
  const p = localParts(date);
  const year = p.month === 12 ? p.year + 1 : p.year;
  const month = p.month === 12 ? 1 : p.month + 1;
  const day = Math.min(p.day, daysInMonth(year, month));
  return fromLocal({ ...p, year, month, day });
}

export type ServicePeriod = { serviceStartDate: Date; serviceEndDate: Date };

/** Periodo de un mes que empieza en `confirmedAt` (pago único o transferencia). */
export function oneMonthServicePeriod(confirmedAt: Date): ServicePeriod {
  return { serviceStartDate: confirmedAt, serviceEndDate: addOneBusinessMonth(confirmedAt) };
}
