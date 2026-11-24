import type { Metadata } from "next";

import { LegalDocumentView } from "@/components/legal/LegalDocumentView";
import { PRIVACY_POLICY } from "@/content/legal";

export const metadata: Metadata = { title: "Política de privacidad · THE HYBRID METHOD" };

export default function PrivacyPage() {
  return <LegalDocumentView document={PRIVACY_POLICY} />;
}
