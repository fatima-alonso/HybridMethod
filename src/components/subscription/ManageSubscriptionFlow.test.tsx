// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { navigation } from "@/utils/navigation";

import { ManageSubscriptionFlow } from "./ManageSubscriptionFlow";

type Reply = { status: number; body: Record<string, unknown> };
const replies: Record<string, Reply[]> = {};
const calls: Array<{ url: string; body: Record<string, unknown> }> = [];

function reply(url: string, status: number, body: Record<string, unknown>) {
  (replies[url] ??= []).push({ status, body });
}

const PORTAL_URL = "https://billing.stripe.com/p/session/test_123";
const WHATSAPP = "https://wa.me/5215512345678?text=Hola";

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
  vi.spyOn(navigation, "assign").mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function verifyEmail(email = "Sofia@Example.com") {
  reply("/api/verification/request", 200, { success: true, message: "ok" });
  reply("/api/verification/confirm", 200, { success: true });
  render(<ManageSubscriptionFlow whatsappUrl={WHATSAPP} />);
  fireEvent.change(screen.getByLabelText("Correo electrónico"), { target: { value: email } });
  fireEvent.click(screen.getByRole("button", { name: "Enviar código" }));
  await screen.findByRole("heading", { name: "Verifica tu correo" });
  fireEvent.change(screen.getByLabelText("Código de verificación"), {
    target: { value: "123456" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Verificar" }));
}

describe("Administrar mi suscripción (RF-19, DECISIONS A33)", () => {
  it("correo → código → portal de Stripe", async () => {
    reply("/api/portal", 200, { success: true, url: PORTAL_URL });
    await verifyEmail();
    await screen.findByText("Te estamos llevando al portal de Stripe…");
    expect(navigation.assign).toHaveBeenCalledWith(PORTAL_URL);
    expect(calls.map((c) => c.url)).toEqual([
      "/api/verification/request",
      "/api/verification/confirm",
      "/api/portal",
    ]);
    expect(calls[0]?.body).toEqual({ email: "sofia@example.com" });
    // El portal no recibe el correo: el servidor lo toma de la sesión verificada.
    expect(calls[2]?.body).toEqual({});
    expect(screen.getByRole("link", { name: "Abrir el portal" }).getAttribute("href")).toBe(
      PORTAL_URL,
    );
  });

  it("sin suscripción lo dice sin revelar nada más y ofrece WhatsApp u otro correo", async () => {
    reply("/api/portal", 404, {
      success: false,
      error: "subscription_not_found",
      message: "No encontramos una suscripción activa con este correo.",
    });
    await verifyEmail();
    await screen.findByRole("heading", { name: "No encontramos una suscripción activa" });
    expect(navigation.assign).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Escribirle a Ferro" }).getAttribute("href")).toBe(
      WHATSAPP,
    );
    fireEvent.click(screen.getByRole("button", { name: "Probar con otro correo" }));
    expect(screen.getByLabelText("Correo electrónico")).toBeTruthy();
  });

  it("valida el correo antes de pedir el código", async () => {
    render(<ManageSubscriptionFlow whatsappUrl={null} />);
    fireEvent.change(screen.getByLabelText("Correo electrónico"), { target: { value: "sofia" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar código" }));
    expect(await screen.findByText("Escribe un correo electrónico válido.")).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it("si la verificación venció, pide otro código", async () => {
    reply("/api/portal", 401, {
      success: false,
      error: "verification_required",
      message: "Tu verificación de correo venció.",
    });
    reply("/api/verification/request", 200, { success: true, message: "ok" });
    await verifyEmail();
    await screen.findByText("Tu verificación venció. Te enviamos un código nuevo para continuar.");
    expect(calls.at(-1)?.url).toBe("/api/verification/request");
  });

  it("si el portal no está disponible muestra el error y deja reintentar", async () => {
    reply("/api/portal", 503, {
      success: false,
      error: "portal_unavailable",
      message: "No pudimos abrir el portal de la suscripción en este momento.",
    });
    await verifyEmail();
    expect(
      await screen.findByText("No pudimos abrir el portal de la suscripción en este momento."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Enviar código" })).toBeTruthy();
  });
});
