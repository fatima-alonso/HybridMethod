import { describe, expect, it } from "vitest";

import {
  businessDate,
  businessDaysBetween,
  isBusinessDay,
  isValidDateString,
  mexicanHolidays,
} from "./business-calendar";

describe("calendario del negocio (DECISIONS A25)", () => {
  it("toma el día en hora del centro de México, no en UTC", () => {
    // 25 nov 05:30 UTC = 24 nov 23:30 en Ciudad de México.
    expect(businessDate(new Date("2026-11-25T05:30:00Z"))).toBe("2026-11-24");
    expect(businessDate(new Date("2026-11-25T06:30:00Z"))).toBe("2026-11-25");
  });

  it("valida fechas AAAA-MM-DD que existen", () => {
    expect(isValidDateString("2026-02-28")).toBe(true);
    expect(isValidDateString("2026-02-29")).toBe(false);
    expect(isValidDateString("2028-02-29")).toBe(true);
    expect(isValidDateString("26-11-24")).toBe(false);
  });

  it("calcula los festivos de la LFT, incluidos los lunes móviles", () => {
    expect([...mexicanHolidays(2026)].sort()).toEqual([
      "2026-01-01",
      "2026-02-02",
      "2026-03-16",
      "2026-05-01",
      "2026-09-16",
      "2026-11-16",
      "2026-12-25",
    ]);
    expect(mexicanHolidays(2030).has("2030-10-01")).toBe(true);
    expect(mexicanHolidays(2027).has("2027-10-01")).toBe(false);
  });

  it("los fines de semana y festivos no son hábiles", () => {
    expect(isBusinessDay("2026-11-24")).toBe(true); // martes
    expect(isBusinessDay("2026-11-28")).toBe(false); // sábado
    expect(isBusinessDay("2026-11-16")).toBe(false); // Revolución (tercer lunes de noviembre)
  });

  it("cuenta los días hábiles después del pago", () => {
    expect(businessDaysBetween("2026-11-24", "2026-11-24")).toBe(0);
    expect(businessDaysBetween("2026-11-24", "2026-11-25")).toBe(1);
    // Pagó el viernes: sábado y domingo no cuentan; el lunes es el primero.
    expect(businessDaysBetween("2026-11-27", "2026-11-29")).toBe(0);
    expect(businessDaysBetween("2026-11-27", "2026-11-30")).toBe(1);
    // Pagó el viernes anterior al festivo del lunes 16 de noviembre.
    expect(businessDaysBetween("2026-11-13", "2026-11-16")).toBe(0);
    expect(businessDaysBetween("2026-11-13", "2026-11-17")).toBe(1);
  });
});
