import { describe, expect, it } from "vitest";

import { parseCommand, parseState, targetTime } from "./stripe-test-clock";

describe("stripe:test-clock", () => {
  it("acepta solo los comandos conocidos", () => {
    expect(parseCommand(["start", "HM-2026-000123"])).toEqual({
      command: "start",
      arg: "HM-2026-000123",
    });
    expect(parseCommand(["day"])).toEqual({ command: "day", arg: undefined });
    expect(() => parseCommand([])).toThrow(/Comando desconocido/);
    expect(() => parseCommand(["borrar-todo"])).toThrow(/Comando desconocido/);
  });

  it("renew adelanta a 2 h después de la renovación; day, 24 h", () => {
    const frozenTime = 1_800_000_000;
    const currentPeriodEnd = frozenTime + 30 * 86_400;
    expect(targetTime("renew", { frozenTime, currentPeriodEnd })).toBe(currentPeriodEnd + 7_200);
    expect(targetTime("day", { frozenTime, currentPeriodEnd })).toBe(frozenTime + 86_400);
    // Si el reloj ya pasó el fin del periodo (p. ej. con reintentos pendientes), no retrocede.
    expect(targetTime("renew", { frozenTime: currentPeriodEnd + 100, currentPeriodEnd })).toBe(
      currentPeriodEnd + 100 + 7_200,
    );
  });

  it("valida el archivo de estado", () => {
    const state = {
      clockId: "clock_1",
      customerId: "cus_1",
      subscriptionId: "sub_1",
      contractId: "c-1",
      reference: "HM-2026-000123",
    };
    expect(parseState(JSON.stringify(state))).toEqual(state);
    expect(() => parseState(JSON.stringify({ ...state, clockId: "" }))).toThrow(/clockId/);
  });
});
