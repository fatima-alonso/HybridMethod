"use client";

import { TRANSFER_PENDING } from "@/content/checkout";
import { buttonPrimary, buttonSecondary } from "@/components/shared/styles";
import { WhatsAppIcon } from "@/components/shared/WhatsAppIcon";
import { formatPrice } from "@/utils/format";

import type { TransferCreated } from "./api";
import { StepHeading } from "./StepHeading";

type Props = {
  transfer: TransferCreated;
  /** Cierra el flujo: limpia el formulario y regresa al inicio de la página. */
  onDone: () => void;
};

/** Paso 4: transferencia pendiente con la referencia y el botón de WhatsApp (RF-09, RF-10). */
export function TransferPendingStep({ transfer, onDone }: Props) {
  return (
    <div className="space-y-6">
      <StepHeading title={TRANSFER_PENDING.title} />
      <p className="text-bone/85">{TRANSFER_PENDING.lead}</p>

      <div className="border-2 border-volt p-5">
        <p className="text-sm font-semibold tracking-wide text-bone/70 uppercase">
          {TRANSFER_PENDING.referenceLabel}
        </p>
        <p className="mt-1 font-mono text-3xl font-bold tracking-wider text-volt sm:text-4xl">
          {transfer.reference}
        </p>
        <p className="mt-3 text-bone/85">
          {transfer.program.name} · {formatPrice(transfer.amount, transfer.currency)}
        </p>
      </div>

      <ol className="list-decimal space-y-2 pl-6 text-bone/85 marker:font-bold marker:text-volt">
        {TRANSFER_PENDING.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>

      {transfer.whatsappUrl ? (
        <a
          href={transfer.whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={`w-full sm:w-auto ${buttonPrimary}`}
        >
          <WhatsAppIcon className="size-5" />
          {TRANSFER_PENDING.whatsapp}
          <span className="sr-only"> (se abre en una pestaña nueva)</span>
        </a>
      ) : (
        <p className="text-bone/85">{TRANSFER_PENDING.noWhatsapp}</p>
      )}

      <div className="space-y-3 border-t border-bone/15 pt-6">
        <p className="text-sm text-bone/70">{TRANSFER_PENDING.keepReference}</p>
        <button type="button" onClick={onDone} className={`w-full sm:w-auto ${buttonSecondary}`}>
          {TRANSFER_PENDING.done}
        </button>
      </div>
    </div>
  );
}
