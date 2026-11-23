// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import Home from "./page";

afterEach(cleanup);

describe("Página de inicio (placeholder Fase 0)", () => {
  it("muestra el nombre de la marca como encabezado principal", () => {
    render(<Home />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/the hybrid\s*method/i);
  });
});
