import { buildWhatsAppLink } from "@/utils/whatsapp";

import { WhatsAppIcon } from "./WhatsAppIcon";

type Props = { number: string; message?: string };

/** Botón flotante de WhatsApp (enlace `wa.me`, SDD §6.4). */
export function WhatsAppFloatingButton({ number, message }: Props) {
  return (
    <a
      href={buildWhatsAppLink(number, message)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Escribir a Ferro por WhatsApp (se abre en una pestaña nueva)"
      className="fixed right-4 bottom-4 z-40 inline-flex size-14 items-center justify-center rounded-full bg-volt text-ink shadow-lg shadow-black/40 transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-volt sm:right-6 sm:bottom-6"
    >
      <WhatsAppIcon className="size-7" />
    </a>
  );
}
