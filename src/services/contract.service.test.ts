import { describe, expect, it } from "vitest";

import type { ContractStatus } from "@/generated/prisma/client";

import {
  CONTRACT_TRANSITIONS,
  allowedSources,
  assertTransition,
  canTransition,
  effectiveContractStatus,
} from "./contract.service";
import { InvalidContractTransitionError } from "./errors";

const STATUSES: ContractStatus[] = [
  "pending_payment",
  "active",
  "completed",
  "payment_failed",
  "cancelled",
];

const VALID: Array<[ContractStatus, ContractStatus]> = [
  ["pending_payment", "active"],
  ["active", "completed"],
  ["active", "payment_failed"],
  ["payment_failed", "active"],
  ["active", "cancelled"],
  ["payment_failed", "cancelled"],
];

describe("máquina de estados del contrato (DECISIONS A3)", () => {
  it("cubre exactamente los cinco estados, sin `paid`", () => {
    expect(Object.keys(CONTRACT_TRANSITIONS).sort()).toEqual([...STATUSES].sort());
    expect(Object.keys(CONTRACT_TRANSITIONS)).not.toContain("paid");
  });

  it.each(VALID)("permite %s → %s", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
    expect(() => assertTransition(from, to)).not.toThrow();
  });

  const invalid = STATUSES.flatMap((from) =>
    STATUSES.map((to) => [from, to] as [ContractStatus, ContractStatus]),
  ).filter(([from, to]) => !VALID.some(([f, t]) => f === from && t === to));

  it.each(invalid)("rechaza %s → %s", (from, to) => {
    expect(canTransition(from, to)).toBe(false);
    expect(() => assertTransition(from, to)).toThrow(InvalidContractTransitionError);
  });

  it("no permite volver a pending_payment ni salir de los estados finales", () => {
    expect(allowedSources("pending_payment")).toEqual([]);
    expect(CONTRACT_TRANSITIONS.completed).toEqual([]);
    expect(CONTRACT_TRANSITIONS.cancelled).toEqual([]);
  });

  it("solo se activa desde pending_payment o payment_failed (RN-05)", () => {
    expect(allowedSources("active").sort()).toEqual(["payment_failed", "pending_payment"]);
  });
});

describe("estado efectivo al leer el contrato", () => {
  const now = new Date("2026-12-15T12:00:00Z");
  const past = new Date("2026-12-01T00:00:00Z");
  const future = new Date("2027-01-01T00:00:00Z");

  it("un pago único o transferencia activa y vencida cuenta como completed", () => {
    for (const paymentType of ["transfer", "one_time"] as const) {
      expect(
        effectiveContractStatus({ status: "active", paymentType, serviceEndDate: past }, now),
      ).toBe("completed");
    }
  });

  it("si el periodo sigue vigente, sigue active", () => {
    expect(
      effectiveContractStatus(
        { status: "active", paymentType: "transfer", serviceEndDate: future },
        now,
      ),
    ).toBe("active");
  });

  it("una suscripción no se completa sola (se renueva con invoice.paid)", () => {
    expect(
      effectiveContractStatus(
        { status: "active", paymentType: "subscription", serviceEndDate: past },
        now,
      ),
    ).toBe("active");
  });

  it("no cambia otros estados", () => {
    for (const status of ["pending_payment", "payment_failed", "cancelled"] as const) {
      expect(
        effectiveContractStatus({ status, paymentType: "one_time", serviceEndDate: past }, now),
      ).toBe(status);
    }
  });
});
