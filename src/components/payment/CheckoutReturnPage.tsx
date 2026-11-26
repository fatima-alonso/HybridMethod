import Link from "next/link";
import type { ReactNode } from "react";

import { Container } from "@/components/shared/Container";
import { buttonPrimary } from "@/components/shared/styles";

type Action = { href: string; label: string };

/** Página de regreso de Stripe Checkout (solo informa, SDD §7.5). */
export function CheckoutReturnPage({
  title,
  lead,
  children,
  primary,
}: {
  title: string;
  lead: string;
  children?: ReactNode;
  primary: Action;
}) {
  return (
    <Container className="max-w-3xl py-16 sm:py-24">
      <div className="space-y-6">
        <h1 className="text-5xl sm:text-6xl">{title}</h1>
        <p className="text-lg text-bone/85">{lead}</p>
        {children}
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link href={primary.href} className={buttonPrimary}>
            {primary.label}
          </Link>
        </div>
      </div>
    </Container>
  );
}
