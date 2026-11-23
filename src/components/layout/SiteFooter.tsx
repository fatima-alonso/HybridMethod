import Link from "next/link";

import { FOOTER, NAV_LINKS } from "@/content/landing";
import { Container } from "@/components/shared/Container";
import { Wordmark } from "@/components/shared/Wordmark";

export function SiteFooter() {
  return (
    <footer className="border-t border-bone/10 bg-ink py-12">
      <Container className="grid gap-10 md:grid-cols-[2fr_1fr_1fr]">
        <div>
          <Wordmark className="text-3xl" />
          <p className="mt-1 text-sm font-semibold tracking-[0.3em] text-volt uppercase">
            by Ferro Fits
          </p>
          <p className="mt-4 max-w-sm text-bone/70">{FOOTER.tagline}</p>
        </div>
        <nav aria-label="Secciones">
          <ul className="space-y-2">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="text-bone/75 hover:text-volt">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label="Legal">
          <ul className="space-y-2">
            {FOOTER.legal.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="text-bone/75 hover:text-volt">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </Container>
      <Container className="mt-10 border-t border-bone/10 pt-6 text-sm text-bone/60">
        © THE HYBRID METHOD · by Ferro Fits
      </Container>
    </footer>
  );
}
