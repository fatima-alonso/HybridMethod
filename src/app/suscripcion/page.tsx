import type { Metadata } from "next";

import { Container } from "@/components/shared/Container";
import { ManageSubscriptionFlow } from "@/components/subscription/ManageSubscriptionFlow";
import { SUBSCRIPTION_PAGE } from "@/content/subscription";
import { getWhatsAppNumber } from "@/lib/config";
import { buildWhatsAppLink } from "@/utils/whatsapp";

export const metadata: Metadata = {
  title: `${SUBSCRIPTION_PAGE.metaTitle} · THE HYBRID METHOD`,
  description: SUBSCRIPTION_PAGE.metaDescription,
  robots: { index: false, follow: false },
};

/**
 * "Administrar mi suscripción" (RF-19, SRS §9.4, DECISIONS A21, A33): el cliente verifica su correo
 * y entra al Stripe Customer Portal para cancelar, cambiar de programa o actualizar su tarjeta.
 */
export default function ManageSubscriptionPage() {
  const whatsappNumber = getWhatsAppNumber();
  const whatsappUrl = whatsappNumber
    ? buildWhatsAppLink(whatsappNumber, SUBSCRIPTION_PAGE.whatsappMessage)
    : null;
  return (
    <Container className="max-w-3xl py-16 sm:py-24">
      <p className="font-display text-sm font-bold tracking-widest text-volt uppercase">
        {SUBSCRIPTION_PAGE.eyebrow}
      </p>
      <h1 className="mt-3 text-5xl sm:text-6xl">{SUBSCRIPTION_PAGE.title}</h1>
      <div className="mt-8">
        <ManageSubscriptionFlow whatsappUrl={whatsappUrl} />
      </div>
    </Container>
  );
}
