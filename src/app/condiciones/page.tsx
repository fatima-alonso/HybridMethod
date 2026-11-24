import type { Metadata } from "next";

import { LegalDocumentView } from "@/components/legal/LegalDocumentView";
import { TERMS } from "@/content/legal";

export const metadata: Metadata = { title: "Condiciones de contratación · THE HYBRID METHOD" };

export default function TermsPage() {
  return <LegalDocumentView document={TERMS} />;
}
