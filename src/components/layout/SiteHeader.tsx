"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";

import { NAV_LINKS, applicationHref } from "@/content/landing";
import { Container } from "@/components/shared/Container";
import { Logo } from "@/components/shared/Logo";

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const close = () => setOpen(false);

  return (
    <header className="sticky top-0 z-30 border-b border-bone/10 bg-ink/95 backdrop-blur supports-[backdrop-filter]:bg-ink/80">
      <Container className="flex h-16 items-center justify-between gap-6">
        <Link href="/#home" onClick={close} className="shrink-0">
          <Logo variant="horizontal" priority className="w-56 sm:w-64 lg:w-72" />
        </Link>

        <nav aria-label="Principal" className="hidden lg:block">
          <ul className="flex items-center gap-7">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="font-display text-base font-semibold tracking-wider text-bone/80 uppercase transition-colors hover:text-volt"
                >
                  {link.label}
                </Link>
              </li>
            ))}
            <li>
              <Link
                href={applicationHref()}
                className="bg-volt px-4 py-2 font-display text-base font-bold tracking-wider text-ink uppercase transition-colors hover:bg-bone"
              >
                Aplicar
              </Link>
            </li>
          </ul>
        </nav>

        <button
          type="button"
          className="inline-flex size-11 items-center justify-center lg:hidden"
          aria-expanded={open}
          aria-controls={menuId}
          aria-label={open ? "Cerrar menú" : "Abrir menú"}
          onClick={() => setOpen((value) => !value)}
        >
          <span aria-hidden="true" className="relative block h-4 w-6">
            <span
              className={`absolute left-0 block h-0.5 w-6 bg-bone transition-transform ${open ? "top-1.5 rotate-45" : "top-0"}`}
            />
            <span
              className={`absolute top-1.5 left-0 block h-0.5 w-6 bg-bone transition-opacity ${open ? "opacity-0" : ""}`}
            />
            <span
              className={`absolute left-0 block h-0.5 w-6 bg-bone transition-transform ${open ? "top-1.5 -rotate-45" : "top-3"}`}
            />
          </span>
        </button>
      </Container>

      <nav
        id={menuId}
        aria-label="Principal (móvil)"
        hidden={!open}
        className="border-t border-bone/10 bg-ink lg:hidden"
      >
        <Container>
          <ul className="flex flex-col py-4">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  onClick={close}
                  className="block py-3 font-display text-2xl font-semibold tracking-wide uppercase hover:text-volt"
                >
                  {link.label}
                </Link>
              </li>
            ))}
            <li className="pt-3">
              <Link
                href={applicationHref()}
                onClick={close}
                className="block bg-volt px-4 py-3 text-center font-display text-xl font-bold tracking-wide text-ink uppercase"
              >
                Aplicar
              </Link>
            </li>
          </ul>
        </Container>
      </nav>
    </header>
  );
}
