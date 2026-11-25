// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConfirmTransferForm } from "./ConfirmTransferForm";

const router = { back: vi.fn(), push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const TOKEN = "t".repeat(43);
const REFERENCE = "HM-2026-000042";
const fetchMock = vi.fn();

function respond(status: number, body: Record<string, unknown>) {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
}

beforeEach(() => {
  fetchMock.mockReset();
  router.back.mockReset();
  router.push.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const pinInput = () => screen.getByLabelText("PIN de aprobación");
const confirmButton = () => screen.getByRole("button", { name: "Sí, confirmar pago" });

describe("ConfirmTransferForm (RF-11)", () => {
  it("«No, regresar» no envía nada al servidor", () => {
    render(<ConfirmTransferForm token={TOKEN} reference={REFERENCE} />);
    fireEvent.change(pinInput(), { target: { value: "482917" } });
    fireEvent.click(screen.getByRole("button", { name: "No, regresar" }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(router.back.mock.calls.length + router.push.mock.calls.length).toBe(1);
  });

  it("no envía la confirmación sin un PIN válido", () => {
    render(<ConfirmTransferForm token={TOKEN} reference={REFERENCE} />);
    fireEvent.click(confirmButton());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("Escribe tu PIN.");
  });

  it("envía solo { token, pin } y muestra el pago confirmado", async () => {
    respond(200, {
      success: true,
      reference: REFERENCE,
      status: "active",
      serviceStartDate: "2026-11-24T16:30:00.000Z",
      serviceEndDate: "2026-12-24T16:30:00.000Z",
    });
    render(<ConfirmTransferForm token={TOKEN} reference={REFERENCE} />);
    fireEvent.change(pinInput(), { target: { value: "482917" } });
    fireEvent.click(confirmButton());

    expect(await screen.findByText("Pago confirmado")).toBeTruthy();
    expect(screen.getByText(/24 de diciembre de 2026/)).toBeTruthy();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/transfers/confirm");
    expect(JSON.parse(String(init.body))).toEqual({ token: TOKEN, pin: "482917" });
  });

  it("un pago por adelantado explica hasta cuándo va el mes vigente y qué cubre el nuevo", async () => {
    respond(200, {
      success: true,
      reference: "HM-2026-000010",
      status: "scheduled",
      serviceStartDate: "2026-12-25T00:33:00.000Z",
      serviceEndDate: "2027-01-25T00:33:00.000Z",
    });
    render(<ConfirmTransferForm token={TOKEN} reference="HM-2026-000010" />);
    fireEvent.change(pinInput(), { target: { value: "482917" } });
    fireEvent.click(confirmButton());
    expect(
      await screen.findByText(
        /Este cliente ya tiene un mes pagado hasta el 24 de diciembre de 2026, así que este pago cubre del 24 de diciembre de 2026 al 24 de enero de 2027/,
      ),
    ).toBeTruthy();
  });

  it("con un PIN incorrecto muestra los intentos restantes y limpia el campo", async () => {
    respond(403, {
      success: false,
      error: "invalid_pin",
      message: "PIN incorrecto. Te quedan 4 intentos con este enlace.",
      remainingAttempts: 4,
    });
    render(<ConfirmTransferForm token={TOKEN} reference={REFERENCE} />);
    fireEvent.change(pinInput(), { target: { value: "111222" } });
    fireEvent.click(confirmButton());
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("Te quedan 4 intentos"),
    );
    expect((pinInput() as HTMLInputElement).value).toBe("");
  });

  it("si el enlace se invalida, ofrece regenerarlo con la referencia", async () => {
    respond(410, {
      success: false,
      error: "link_unavailable",
      reason: "invalidated",
      message: "Hubo 5 intentos fallidos y este enlace se desactivó.",
    });
    render(<ConfirmTransferForm token={TOKEN} reference={REFERENCE} />);
    fireEvent.change(pinInput(), { target: { value: "111222" } });
    fireEvent.click(confirmButton());

    expect(await screen.findByText("Generar un enlace nuevo")).toBeTruthy();
    expect(screen.getByText(REFERENCE)).toBeTruthy();

    respond(200, {
      success: true,
      reference: REFERENCE,
      message: "Listo. Te enviamos un enlace nuevo.",
    });
    fireEvent.change(screen.getByLabelText("PIN de aprobación"), { target: { value: "482917" } });
    fireEvent.click(screen.getByRole("button", { name: "Generar enlace nuevo" }));
    expect(await screen.findByText(/Te enviamos un enlace nuevo/)).toBeTruthy();
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("/api/transfers/regenerate");
    expect(JSON.parse(String(init.body))).toEqual({ reference: REFERENCE, pin: "482917" });
  });
});
