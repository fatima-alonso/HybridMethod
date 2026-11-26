import type { Metadata } from "next";

import { CheckoutReturnPage } from "@/components/payment/CheckoutReturnPage";
import { CHECKOUT_RETURN_PAGES } from "@/content/checkout";

const PAGE = CHECKOUT_RETURN_PAGES.success;

export const metadata: Metadata = {
  title: PAGE.metaTitle,
  robots: { index: false, follow: false },
};

/**
 * Regreso de Stripe Checkout después de pagar (SDD §7.5, §8.2). Solo informa: no lee la sesión ni
 * confirma el pago. El servicio se activa únicamente con el webhook firmado de Stripe (RN-11).
 */
export default function CheckoutSuccessPage() {
  return (
    <CheckoutReturnPage
      title={PAGE.title}
      lead={PAGE.lead}
      primary={{ href: "/", label: PAGE.home }}
    >
      <ol className="list-decimal space-y-2 pl-6 text-bone/85">
        {PAGE.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </CheckoutReturnPage>
  );
}
