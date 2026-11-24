// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PROGRAMS } from "@/content/programs";
import { getPhoneCountryOptions } from "@/lib/phone";

import { ApplicationForm } from "./ApplicationForm";

afterEach(cleanup);

const COUNTRIES = getPhoneCountryOptions();
const countrySelect = () =>
  screen.getByRole("combobox", { name: "País de tu número de WhatsApp" }) as HTMLSelectElement;

const radio = (name: RegExp) => screen.getByRole("radio", { name }) as HTMLInputElement;

function fillValid() {
  fireEvent.change(screen.getByLabelText("Nombre completo"), { target: { value: "Ana López" } });
  fireEvent.change(screen.getByLabelText("Correo electrónico"), {
    target: { value: "ana@example.com" },
  });
  fireEvent.change(screen.getByLabelText("WhatsApp"), { target: { value: "55 1234 5678" } });
  fireEvent.click(screen.getByRole("checkbox"));
}

describe("ApplicationForm (RF-03, RF-04, RF-05)", () => {
  it("muestra los campos del RF-04 y ningún otro dato (sin país del cliente, A1)", () => {
    render(<ApplicationForm programs={PROGRAMS} countries={COUNTRIES} />);
    expect(screen.getByLabelText("Nombre completo")).toBeTruthy();
    expect(screen.getByLabelText("Correo electrónico")).toBeTruthy();
    expect(screen.getByLabelText("WhatsApp")).toBeTruthy();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(screen.getByRole("checkbox")).toBeTruthy();
    // El único selector de país es la lada del WhatsApp (DECISIONS B13), con México por defecto.
    expect(screen.getAllByRole("combobox")).toEqual([countrySelect()]);
    expect(countrySelect().value).toBe("MX");
  });

  it("sin preselección, ningún programa está marcado", () => {
    render(<ApplicationForm programs={PROGRAMS} countries={COUNTRIES} />);
    for (const input of screen.getAllByRole("radio") as HTMLInputElement[]) {
      expect(input.checked).toBe(false);
    }
  });

  it("preselecciona el programa recibido (RF-03)", () => {
    render(
      <ApplicationForm
        programs={PROGRAMS}
        countries={COUNTRIES}
        preselectedProgram="hm-strength"
      />,
    );
    expect(radio(/HM STRENGTH/).checked).toBe(true);
    expect(radio(/HM RUN/).checked).toBe(false);
  });

  it("al cambiar la preselección actualiza el programa sin borrar lo escrito", () => {
    const { rerender } = render(
      <ApplicationForm programs={PROGRAMS} countries={COUNTRIES} preselectedProgram="hm-run" />,
    );
    fireEvent.change(screen.getByLabelText("Nombre completo"), { target: { value: "Ana López" } });
    rerender(
      <ApplicationForm
        programs={PROGRAMS}
        countries={COUNTRIES}
        preselectedProgram="hm-complete"
      />,
    );
    expect(radio(/HM COMPLETE/).checked).toBe(true);
    expect((screen.getByLabelText("Nombre completo") as HTMLInputElement).value).toBe("Ana López");
  });

  it("al enviar vacío muestra los errores y enfoca el primer campo inválido", () => {
    render(<ApplicationForm programs={PROGRAMS} countries={COUNTRIES} />);
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));

    expect(screen.getByText("Escribe tu nombre completo.")).toBeTruthy();
    expect(screen.getByText("Escribe tu correo electrónico.")).toBeTruthy();
    expect(screen.getByText("Escribe tu número de WhatsApp.")).toBeTruthy();
    expect(screen.getByText("Elige un programa.")).toBeTruthy();
    expect(screen.getByText("Debes aceptar la política de privacidad.")).toBeTruthy();

    const name = screen.getByLabelText("Nombre completo");
    expect(name.getAttribute("aria-invalid")).toBe("true");
    expect(name.getAttribute("aria-describedby")).toBeTruthy();
    expect(document.activeElement).toBe(name);
    expect(screen.getByRole("alert").textContent).toBe("");
  });

  it("valida el formato del correo y del WhatsApp", () => {
    render(
      <ApplicationForm programs={PROGRAMS} countries={COUNTRIES} preselectedProgram="hm-run" />,
    );
    fillValid();
    fireEvent.change(screen.getByLabelText("Correo electrónico"), { target: { value: "ana@" } });
    fireEvent.change(screen.getByLabelText("WhatsApp"), { target: { value: "123" } });
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));

    expect(screen.getByText("Escribe un correo electrónico válido.")).toBeTruthy();
    expect(screen.getByText("Ese número no es válido para el país elegido.")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText("Correo electrónico"));
  });

  it("acepta números de otros países eligiendo el país (DECISIONS B13)", () => {
    render(
      <ApplicationForm programs={PROGRAMS} countries={COUNTRIES} preselectedProgram="hm-run" />,
    );
    fillValid();
    fireEvent.change(countrySelect(), { target: { value: "ES" } });
    fireEvent.change(screen.getByLabelText("WhatsApp"), { target: { value: "612 34 56 78" } });
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(screen.queryAllByText(/^(Escribe|Elige|Debes|Ese número)/)).toHaveLength(0);
  });

  it("valida el número con las reglas del país elegido", () => {
    render(
      <ApplicationForm programs={PROGRAMS} countries={COUNTRIES} preselectedProgram="hm-run" />,
    );
    fillValid();
    fireEvent.change(countrySelect(), { target: { value: "ES" } });
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    // "55 1234 5678" es válido en México pero no en España.
    expect(screen.getByText("Ese número no es válido para el país elegido.")).toBeTruthy();
  });

  it("los errores se actualizan al corregir un campo después del primer envío", () => {
    render(<ApplicationForm programs={PROGRAMS} countries={COUNTRIES} />);
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    fireEvent.click(radio(/HM RUN/));
    expect(screen.queryByText("Elige un programa.")).toBeNull();
  });

  it("con datos válidos entrega los valores al flujo sin mostrar errores", () => {
    const onSubmit = vi.fn();
    render(
      <ApplicationForm
        programs={PROGRAMS}
        countries={COUNTRIES}
        preselectedProgram="hm-complete"
        onSubmit={onSubmit}
      />,
    );
    fillValid();
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));

    expect(screen.queryAllByText(/^(Escribe|Elige|Debes)/)).toHaveLength(0);
    expect(onSubmit).toHaveBeenCalledWith({
      fullName: "Ana López",
      email: "ana@example.com",
      whatsappCountry: "MX",
      whatsapp: "55 1234 5678",
      program: "hm-complete",
      privacyAccepted: true,
    });
  });

  it("con datos inválidos no llama al flujo", () => {
    const onSubmit = vi.fn();
    render(<ApplicationForm programs={PROGRAMS} countries={COUNTRIES} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("mientras se envía, deshabilita el botón y muestra el error del servidor", () => {
    render(
      <ApplicationForm programs={PROGRAMS} countries={COUNTRIES} busy serverError="Sin conexión" />,
    );
    const button = screen.getByRole("button", { name: "Enviando código…" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toBe("Sin conexión");
  });

  it("enlaza a la política de privacidad", () => {
    render(<ApplicationForm programs={PROGRAMS} countries={COUNTRIES} />);
    expect(screen.getByRole("link", { name: /política de privacidad/ }).getAttribute("href")).toBe(
      "/privacidad",
    );
  });
});
