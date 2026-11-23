import { About } from "@/components/landing/About";
import { FaqContact } from "@/components/landing/FaqContact";
import { Hero } from "@/components/landing/Hero";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { Pricing } from "@/components/landing/Pricing";
import { ApplicationSection } from "@/components/forms/ApplicationSection";
import { ProgramsSection } from "@/components/programs/ProgramsSection";
import { getWhatsAppNumber } from "@/lib/config";

/** Landing (SRS §4.2): secciones en el orden definido por el SRS. */
export default function Home() {
  const whatsappNumber = getWhatsAppNumber();
  return (
    <>
      <Hero />
      <About />
      <ProgramsSection />
      <HowItWorks />
      <Pricing />
      <ApplicationSection />
      <FaqContact whatsappNumber={whatsappNumber} />
    </>
  );
}
