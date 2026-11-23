// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SiteHeader } from "./SiteHeader";

afterEach(cleanup);

describe("SiteHeader", () => {
  it("abre y cierra el menú móvil con aria-expanded y Escape", () => {
    render(<SiteHeader />);
    const toggle = screen.getByRole("button", { name: "Abrir menú" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("navigation", { name: "Principal (móvil)" })).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("muestra el logo con texto alternativo y enlaza al inicio", () => {
    render(<SiteHeader />);
    const logo = screen.getByRole("img", { name: "THE HYBRID METHOD by Ferro Fits" });
    expect(logo.getAttribute("src")).toContain("hm-logo-horizontal.png");
    expect(logo.closest("a")?.getAttribute("href")).toBe("/#home");
  });

  it("enlaza a todas las secciones", () => {
    render(<SiteHeader />);
    const nav = screen.getByRole("navigation", { name: "Principal" });
    const hrefs = Array.from(nav.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual([
      "/#about",
      "/#programs",
      "/#how-it-works",
      "/#pricing",
      "/#faq",
      "/#athlete-application",
    ]);
  });
});
