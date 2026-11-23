import { About } from "@/components/landing/About";
import { FaqContact } from "@/components/landing/FaqContact";
import { Hero } from "@/components/landing/Hero";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { Pricing } from "@/components/landing/Pricing";
import { ApplicationSection } from "@/components/forms/ApplicationSection";
import { ProgramsSection } from "@/components/programs/ProgramsSection";
import { getWhatsAppNumber } from "@/lib/config";

import { getCachedLandingPrograms } from "./landing-programs";

/** Landing (SRS §4.2): secciones en el orden definido por el SRS. */
export default async function Home() {
  const whatsappNumber = getWhatsAppNumber();
  const programs = await getCachedLandingPrograms();
  return (
    <>
      <Hero />
      <About />
      <ProgramsSection programs={programs} />
      <HowItWorks />
      <Pricing programs={programs} />
      <ApplicationSection programs={programs} />
      <FaqContact whatsappNumber={whatsappNumber} />
    </>
  );
}
