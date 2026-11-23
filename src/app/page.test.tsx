// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SECTION_IDS } from "@/content/landing";
import { PROGRAMS } from "@/content/programs";
import { formatPrice } from "@/utils/format";

import Home from "./page";

let searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParams,
}));

afterEach(() => {
  cleanup();
  searchParams = new URLSearchParams();
});

describe("Landing (RF-01, RF-02, RF-03, SRS §4.2)", () => {
  it("incluye todas las secciones del SRS §4.2 con su encabezado", () => {
    render(<Home />);
    const expected: Array<[string, string | RegExp]> = [
      [SECTION_IDS.home, /THE HYBRID METHOD/],
      [SECTION_IDS.about, "About Me"],
      [SECTION_IDS.programs, "Our Programs"],
      [SECTION_IDS.howItWorks, "How It Works"],
      [SECTION_IDS.pricing, "Pricing"],
      [SECTION_IDS.application, "Athlete Application"],
      [SECTION_IDS.faq, "FAQ & Contact"],
    ];
    for (const [id, heading] of expected) {
      const section = document.getElementById(id);
      expect(section, `falta la sección #${id}`).not.toBeNull();
      expect(within(section!).getAllByRole("heading")[0].textContent).toMatch(heading);
    }
  });

  it("tiene un solo h1", () => {
    render(<Home />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("muestra los tres programas con su descripción y precio del catálogo (RF-02)", () => {
    render(<Home />);
    const programs = document.getElementById(SECTION_IDS.programs)!;
    for (const program of PROGRAMS) {
      const card = within(programs).getByRole("article", { name: program.name });
      expect(within(card).getByText(program.summary)).toBeTruthy();
      expect(
        within(card).getByText(formatPrice(program.monthlyPrice, program.currency)),
      ).toBeTruthy();
    }
  });

  it("el CTA de cada programa lleva al formulario con el programa preseleccionado (RF-03)", () => {
    render(<Home />);
    for (const program of PROGRAMS) {
      const links = screen.getAllByRole("link", { name: new RegExp(program.name) });
      const hrefs = links.map((link) => link.getAttribute("href"));
      expect(hrefs).toContain(`/?programa=${program.slug}#${SECTION_IDS.application}`);
    }
  });

  it("preselecciona el programa que viene en la URL", () => {
    searchParams = new URLSearchParams("programa=hm-complete");
    render(<Home />);
    expect((screen.getByRole("radio", { name: /HM COMPLETE/ }) as HTMLInputElement).checked).toBe(
      true,
    );
  });

  it("ignora un programa desconocido en la URL", () => {
    searchParams = new URLSearchParams("programa=hm-yoga");
    render(<Home />);
    for (const input of screen.getAllByRole("radio") as HTMLInputElement[]) {
      expect(input.checked).toBe(false);
    }
  });

  it("muestra el contacto por WhatsApp con FERRO_WHATSAPP_NUMBER", () => {
    vi.stubEnv("FERRO_WHATSAPP_NUMBER", "5215512345678");
    render(<Home />);
    const link = screen.getByRole("link", { name: /Escribir por WhatsApp/ });
    expect(link.getAttribute("href")).toMatch(/^https:\/\/wa\.me\/5215512345678\?text=/);
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("sin FERRO_WHATSAPP_NUMBER indica que el contacto está pendiente", () => {
    vi.stubEnv("FERRO_WHATSAPP_NUMBER", "");
    render(<Home />);
    expect(screen.queryByRole("link", { name: /Escribir por WhatsApp/ })).toBeNull();
    expect(screen.getByText(/pendiente de configurar/)).toBeTruthy();
  });

  it("marca las imágenes pendientes con texto alternativo", () => {
    render(<Home />);
    const placeholders = document.querySelectorAll('[data-placeholder="image"]');
    expect(placeholders.length).toBeGreaterThan(0);
    placeholders.forEach((el) => {
      expect(el.getAttribute("role")).toBe("img");
      expect(el.getAttribute("aria-label")).toMatch(/^Imagen pendiente: /);
    });
  });
});
