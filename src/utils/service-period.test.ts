import { describe, expect, it } from "vitest";

import { addOneBusinessMonth, oneMonthServicePeriod } from "./service-period";

/** México centro es UTC-6 todo el año desde 2022 (sin horario de verano). */
describe("periodo de un mes (DECISIONS A19, A23)", () => {
  it.each([
    // [confirmación UTC, fin esperado UTC]
    ["2026-11-24T16:30:00.000Z", "2026-12-24T16:30:00.000Z"],
    ["2026-12-15T18:00:00.000Z", "2027-01-15T18:00:00.000Z"],
    // 31 de enero → último día de febrero (2027 no es bisiesto, 2028 sí).
    ["2027-01-31T15:00:00.000Z", "2027-02-28T15:00:00.000Z"],
    ["2028-01-31T15:00:00.000Z", "2028-02-29T15:00:00.000Z"],
    // 31 de marzo → 30 de abril.
    ["2027-03-31T12:00:00.000Z", "2027-04-30T12:00:00.000Z"],
  ])("confirmado el %s termina el %s", (start, end) => {
    expect(addOneBusinessMonth(new Date(start)).toISOString()).toBe(end);
  });

  it("usa el día de la zona del negocio, no el de UTC", () => {
    // 1 de febrero 02:00 UTC = 31 de enero 20:00 en Ciudad de México → 28 de febrero 20:00 local.
    expect(addOneBusinessMonth(new Date("2027-02-01T02:00:00.000Z")).toISOString()).toBe(
      "2027-03-01T02:00:00.000Z",
    );
  });

  it("conserva los milisegundos y empieza en la confirmación", () => {
    const confirmedAt = new Date("2026-11-24T16:30:12.345Z");
    expect(oneMonthServicePeriod(confirmedAt)).toEqual({
      serviceStartDate: confirmedAt,
      serviceEndDate: new Date("2026-12-24T16:30:12.345Z"),
    });
  });
});
