// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PROGRAMS } from "@/content/programs";
import { getPhoneCountryOptions } from "@/lib/phone";

import { ApplicationFlow } from "./ApplicationFlow";

const COUNTRIES = getPhoneCountryOptions();

type Reply = { status: number; body: Record<string, unknown> };
const replies: Record<string, Reply[]> = {};
const calls: Array<{ url: string; body: Record<string, unknown> }> = [];

function reply(url: string, status: number, body: Record<string, unknown>) {
  (replies[url] ??= []).push({ status, body });
}

beforeEach(() => {
  for (const key of Object.keys(replies)) delete replies[key];
  calls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      const next = replies[url]?.shift();
      if (!next) throw new TypeError("Failed to fetch");
      return new Response(JSON.stringify(next.body), { status: next.status });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function fillForm() {
  fireEvent.change(screen.getByLabelText("Nombre completo"), { target: { value: "Ana López" } });
  fireEvent.change(screen.getByLabelText("Correo electrónico"), {
    target: { value: "Ana@Example.com" },
  });
  fireEvent.change(screen.getByLabelText("WhatsApp"), { target: { value: "55 1234 5678" } });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
}

const transfer = {
  success: true,
  reference: "HM-2026-000042",
  status: "pending_payment",
  program: { slug: "hm-run", name: "HM RUN" },
  amount: "1200.00",
  currency: "MXN",
  whatsappUrl: "https://wa.me/5215512345678?text=Hola",
};

async function reachPaymentStep() {
  reply("/api/verification/request", 200, { success: true, message: "ok" });
  reply("/api/verification/confirm", 200, { success: true });
  render(<ApplicationFlow programs={PROGRAMS} countries={COUNTRIES} preselectedProgram="hm-run" />);
  fillForm();
  await screen.findByRole("heading", { name: "Verifica tu correo" });
  fireEvent.change(screen.getByLabelText("Código de verificación"), {
    target: { value: "123 456" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Verificar" }));
  await screen.findByRole("heading", { name: "Elige cómo pagar" });
}

describe("ApplicationFlow (SDD §8.1, §8.4)", () => {
  it("formulario → código → método de pago → transferencia pendiente", async () => {
    await reachPaymentStep();
    expect(calls[0]).toEqual({
      url: "/api/verification/request",
      body: { email: "Ana@Example.com" },
    });
    expect(calls[1]).toEqual({
      url: "/api/verification/confirm",
      body: { email: "Ana@Example.com", code: "123456" },
    });

    reply("/api/transfers", 201, transfer);
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    await screen.findByRole("heading", { name: "Transferencia pendiente" });

    // El navegador no envía correo, importe ni Price ID (SDD §9.2).
    expect(calls[2]).toEqual({
      url: "/api/transfers",
      body: {
        fullName: "Ana López",
        whatsapp: { country: "MX", number: "55 1234 5678" },
        program: "hm-run",
        privacyAccepted: true,
      },
    });
    expect(screen.getByText("HM-2026-000042")).toBeTruthy();
    const whatsapp = screen.getByRole("link", { name: /WhatsApp/ });
    expect(whatsapp.getAttribute("href")).toBe(transfer.whatsappUrl);
  });

  it("el encabezado de cada paso recibe el foco", async () => {
    await reachPaymentStep();
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Elige cómo pagar" }));
  });

  it("los pagos con Stripe aparecen deshabilitados (Fase 5)", async () => {
    await reachPaymentStep();
    const transferOption = screen.getByRole("radio", { name: /Transferencia bancaria/ });
    expect((transferOption as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("radio", { name: /Pago único/ }) as HTMLInputElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole("radio", { name: /Suscripción/ }) as HTMLInputElement).disabled).toBe(
      true,
    );
  });

  it("muestra el error del código y los intentos restantes", async () => {
    reply("/api/verification/request", 200, { success: true });
    reply("/api/verification/confirm", 400, {
      success: false,
      error: "invalid_code",
      message: "El código no es correcto. Te quedan 4 intentos.",
      remainingAttempts: 4,
    });
    render(
      <ApplicationFlow programs={PROGRAMS} countries={COUNTRIES} preselectedProgram="hm-run" />,
    );
    fillForm();
    await screen.findByRole("heading", { name: "Verifica tu correo" });
    fireEvent.change(screen.getByLabelText("Código de verificación"), {
      target: { value: "000000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Verificar" }));
    expect(await screen.findByText("El código no es correcto. Te quedan 4 intentos.")).toBeTruthy();
  });

  it("valida el formato del código antes de enviarlo", async () => {
    reply("/api/verification/request", 200, { success: true });
    render(
      <ApplicationFlow programs={PROGRAMS} countries={COUNTRIES} preselectedProgram="hm-run" />,
    );
    fillForm();
    await screen.findByRole("heading", { name: "Verifica tu correo" });
    fireEvent.change(screen.getByLabelText("Código de verificación"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Verificar" }));
    expect(await screen.findByText("El código tiene 6 dígitos.")).toBeTruthy();
    expect(calls).toHaveLength(1);
  });

  it("el reenvío espera 60 s", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    reply("/api/verification/request", 200, { success: true });
    render(
      <ApplicationFlow programs={PROGRAMS} countries={COUNTRIES} preselectedProgram="hm-run" />,
    );
    fillForm();
    await screen.findByRole("heading", { name: "Verifica tu correo" });
    const resend = () =>
      screen.getByRole("button", { name: /Reenviar código/ }) as HTMLButtonElement;
    expect(resend().disabled).toBe(true);
    expect(resend().textContent).toMatch(/60 s/);
    for (let i = 0; i < 61; i++) {
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
    }
    expect(resend().disabled).toBe(false);
    reply("/api/verification/request", 200, { success: true });
    fireEvent.click(resend());
    expect(await screen.findByText(/Te enviamos un código nuevo/)).toBeTruthy();
    expect(calls.filter((c) => c.url === "/api/verification/request")).toHaveLength(2);
  });

  it("si la sesión venció al crear la transferencia, pide otro código", async () => {
    await reachPaymentStep();
    reply("/api/transfers", 401, { success: false, error: "verification_required", message: "" });
    reply("/api/verification/request", 200, { success: true });
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    await screen.findByRole("heading", { name: "Verifica tu correo" });
    expect(screen.getByText(/Tu verificación venció/)).toBeTruthy();
  });

  it("sin conexión muestra un error y se queda en el formulario", async () => {
    render(
      <ApplicationFlow programs={PROGRAMS} countries={COUNTRIES} preselectedProgram="hm-run" />,
    );
    fillForm();
    expect(await screen.findByText(/No pudimos conectar/)).toBeTruthy();
    expect(screen.getByLabelText("Nombre completo")).toBeTruthy();
  });

  it("al regresar al formulario conserva los datos", async () => {
    reply("/api/verification/request", 200, { success: true });
    render(
      <ApplicationFlow programs={PROGRAMS} countries={COUNTRIES} preselectedProgram="hm-run" />,
    );
    fillForm();
    await screen.findByRole("heading", { name: "Verifica tu correo" });
    fireEvent.click(screen.getByRole("button", { name: "Cambiar mis datos" }));
    await waitFor(() =>
      expect((screen.getByLabelText("Nombre completo") as HTMLInputElement).value).toBe(
        "Ana López",
      ),
    );
    expect((screen.getByLabelText("Correo electrónico") as HTMLInputElement).value).toBe(
      "Ana@Example.com",
    );
  });
});
