import type { Metadata } from "next";

import { LegalPlaceholder } from "@/components/legal/LegalPlaceholder";

export const metadata: Metadata = { title: "Condiciones de contratación · THE HYBRID METHOD" };

export default function TermsPage() {
  return <LegalPlaceholder title="Condiciones de contratación" />;
}
