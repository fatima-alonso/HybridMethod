import type { Metadata } from "next";

import { CheckoutReturnPage } from "@/components/payment/CheckoutReturnPage";
import { CHECKOUT_RETURN_PAGES } from "@/content/checkout";
import { applicationHref } from "@/content/landing";

const PAGE = CHECKOUT_RETURN_PAGES.cancelled;

export const metadata: Metadata = {
  title: PAGE.metaTitle,
  robots: { index: false, follow: false },
};

/** Regreso de Stripe Checkout sin pagar (SDD §7.5). Solo informa: el contrato sigue pendiente. */
export default function CheckoutCancelledPage() {
  return (
    <CheckoutReturnPage
      title={PAGE.title}
      lead={PAGE.lead}
      primary={{ href: applicationHref(), label: PAGE.retry }}
      secondary={{ href: "/", label: PAGE.home }}
    />
  );
}
