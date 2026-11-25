import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";

import { DeliveryForm } from "@/components/delivery/DeliveryForm";
import { Container } from "@/components/shared/Container";
import { DELIVERY_PAGE, formatDateString } from "@/content/plan-delivery";
import {
  getDeliveryView,
  type DeliveryDetails,
  type DeliveryView,
} from "@/services/delivery.service";
import { formatBusinessDateTime } from "@/utils/format";

/**
 * `GET /plan/entrega/[token]` (SDD §7.8, DECISIONS A19). Página de solo lectura: abrirla no
 * registra nada (los filtros de correo abren los enlaces solos). `noindex` y `no-referrer` aquí y
 * en los encabezados de `next.config.ts`.
 */
export const metadata: Metadata = {
  title: DELIVERY_PAGE.metaTitle,
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default function PlanDeliveryPage({ params }: PageProps<"/plan/entrega/[token]">) {
  return (
    <Container className="max-w-3xl py-16 sm:py-24">
      <Suspense fallback={<p className="text-bone/70">Cargando…</p>}>
        <PlanDelivery params={params} />
      </Suspense>
    </Container>
  );
}

async function PlanDelivery({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  let view: DeliveryView;
  try {
    view = await getDeliveryView(token);
  } catch (error) {
    console.error(
      "[plan.delivery.page] No se pudo leer el botón:",
      error instanceof Error ? error.name : "error desconocido",
    );
    return (
      <Section title={DELIVERY_PAGE.invalidTitle}>
        <p className="text-bone/85">{DELIVERY_PAGE.unavailable}</p>
      </Section>
    );
  }

  switch (view.state) {
    case "valid":
      return (
        <Section title={DELIVERY_PAGE.title}>
          <p className="text-bone/85">{DELIVERY_PAGE.readOnlyNote}</p>
          <Details details={view.details} />
          <DeliveryForm
            token={token}
            defaultDate={view.defaultDate}
            minDate={view.details.minDate}
            maxDate={view.details.maxDate}
          />
        </Section>
      );
    case "delivered":
      return (
        <Section title={DELIVERY_PAGE.alreadyTitle}>
          <p className="text-lg font-semibold">
            {DELIVERY_PAGE.confirmed(formatDateString(view.deliveredOn))}
          </p>
          <Details details={view.details} />
        </Section>
      );
    case "expired":
    case "not_found":
      return (
        <Section title={DELIVERY_PAGE.invalidTitle}>
          <p className="text-bone/85">{DELIVERY_PAGE.invalid}</p>
        </Section>
      );
  }
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-6">
      <h1 className="text-5xl sm:text-6xl">{title}</h1>
      {children}
    </div>
  );
}

function Details({ details }: { details: DeliveryDetails }) {
  const { labels } = DELIVERY_PAGE;
  const items: Array<[string, string]> = [
    [labels.customerName, details.customerName],
    [labels.programName, details.programName],
    [labels.reference, details.reference],
    [labels.amount, details.amount],
    [labels.paidAt, formatBusinessDateTime(details.paidAt)],
    [
      labels.period,
      DELIVERY_PAGE.period(
        formatBusinessDateTime(details.startDate),
        formatBusinessDateTime(details.endDate),
      ),
    ],
  ];
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 border-2 border-bone/15 p-5 sm:grid-cols-[auto_1fr]">
      {items.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-sm text-bone/70 sm:text-base">{label}</dt>
          <dd className="font-semibold break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
