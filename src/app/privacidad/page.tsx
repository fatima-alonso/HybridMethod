import type { Metadata } from "next";

import { LegalPlaceholder } from "@/components/legal/LegalPlaceholder";

export const metadata: Metadata = { title: "Política de privacidad · THE HYBRID METHOD" };

export default function PrivacyPage() {
  return <LegalPlaceholder title="Política de privacidad" />;
}
