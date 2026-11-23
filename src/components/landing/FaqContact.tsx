import { FAQ, SECTION_IDS } from "@/content/landing";
import { Container } from "@/components/shared/Container";
import { SectionHeading } from "@/components/shared/SectionHeading";
import { WhatsAppIcon } from "@/components/shared/WhatsAppIcon";
import { buttonPrimary } from "@/components/shared/styles";
import { buildWhatsAppLink } from "@/utils/whatsapp";

export function FaqContact({ whatsappNumber }: { whatsappNumber?: string }) {
  return (
    <section
      id={SECTION_IDS.faq}
      aria-labelledby="faq-title"
      className="scroll-mt-16 border-t border-bone/10 py-20 sm:py-28"
    >
      <Container className="grid gap-12 lg:grid-cols-[1.5fr_1fr]">
        <div>
          <SectionHeading id="faq-title" title={FAQ.title} />
          <div className="mt-10 divide-y divide-bone/15 border-y border-bone/15">
            {FAQ.items.map((item) => (
              <details key={item.question} className="group py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-display text-2xl font-bold uppercase [&::-webkit-details-marker]:hidden">
                  {item.question}
                  <span
                    aria-hidden="true"
                    className="text-3xl leading-none text-volt transition-transform group-open:rotate-45"
                  >
                    +
                  </span>
                </summary>
                <p className="mt-3 max-w-2xl text-bone/80">{item.answer}</p>
              </details>
            ))}
          </div>
        </div>

        <aside
          aria-labelledby="contact-title"
          className="h-fit border border-bone/15 bg-ink-soft p-6 sm:p-8"
        >
          <h3 id="contact-title" className="text-4xl">
            {FAQ.contactTitle}
          </h3>
          <p className="mt-3 text-bone/75">{FAQ.contactBody}</p>
          {whatsappNumber ? (
            <a
              href={buildWhatsAppLink(whatsappNumber, FAQ.whatsappMessage)}
              target="_blank"
              rel="noopener noreferrer"
              className={`mt-6 w-full ${buttonPrimary}`}
            >
              <WhatsAppIcon className="size-5" />
              {FAQ.contactCta}
              <span className="sr-only"> (se abre en una pestaña nueva)</span>
            </a>
          ) : (
            <p className="mt-6 text-sm text-bone/60">{FAQ.contactUnavailable}</p>
          )}
        </aside>
      </Container>
    </section>
  );
}
