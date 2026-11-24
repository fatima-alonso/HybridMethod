import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";

import { Container } from "@/components/shared/Container";
import { ConfirmTransferForm } from "@/components/transfer/ConfirmTransferForm";
import { RegenerateLinkForm } from "@/components/transfer/RegenerateLinkForm";
import { CONFIRM_PAGE, LINK_PROBLEM_MESSAGES } from "@/content/transfer-approval";
import {
  getTransferApprovalView,
  type TransferApprovalDetails,
  type TransferApprovalView,
} from "@/services/transfer-approval.service";
import { formatBusinessDateTime } from "@/utils/format";

/**
 * `GET /transfer/confirm/[token]` (RF-11, SDD §7.6). Página privada de Ferro, de solo lectura:
 * abrirla no cambia el token ni el contrato. Confirmar requiere el PIN y un POST explícito.
 *
 * `noindex` y `no-referrer` aquí y en los encabezados de `next.config.ts`.
 */
export const metadata: Metadata = {
  title: CONFIRM_PAGE.metaTitle,
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default function TransferConfirmPage({ params }: PageProps<"/transfer/confirm/[token]">) {
  return (
    <Container className="max-w-3xl py-16 sm:py-24">
      <p className="text-sm font-semibold tracking-widest text-volt uppercase">
        {CONFIRM_PAGE.eyebrow}
      </p>
      <Suspense fallback={<p className="mt-6 text-bone/70">Cargando…</p>}>
        <TransferApproval params={params} />
      </Suspense>
    </Container>
  );
}

async function TransferApproval({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  let view: TransferApprovalView;
  try {
    view = await getTransferApprovalView(token);
  } catch (error) {
    console.error(
      "[transfer.confirm.page] No se pudo leer el enlace:",
      error instanceof Error ? error.name : "error desconocido",
    );
    return (
      <Section title={CONFIRM_PAGE.invalidTitle}>
        <p className="text-bone/85">{CONFIRM_PAGE.unavailable}</p>
      </Section>
    );
  }

  switch (view.state) {
    case "valid":
      return (
        <Section title={CONFIRM_PAGE.title}>
          <p className="text-bone/85">{CONFIRM_PAGE.readOnlyNote}</p>
          <Details details={view.details} />
          <p className="text-sm text-bone/70">
            {CONFIRM_PAGE.expiresAt(formatBusinessDateTime(view.expiresAt))}{" "}
            {CONFIRM_PAGE.remainingAttempts(view.remainingAttempts)}
          </p>
          <ConfirmTransferForm token={token} reference={view.details.reference} />
        </Section>
      );
    case "used":
      return (
        <Section title={CONFIRM_PAGE.usedTitle}>
          <p className="text-bone/85">{LINK_PROBLEM_MESSAGES.used}</p>
          <p>
            <span className="text-bone/70">{CONFIRM_PAGE.labels.reference}: </span>
            <span className="font-mono font-bold text-volt">{view.reference}</span>
          </p>
          <p className="text-bone/85">{CONFIRM_PAGE.usedAt(formatBusinessDateTime(view.usedAt))}</p>
          {view.serviceStartDate && view.serviceEndDate ? (
            <p className="text-bone/85">
              {CONFIRM_PAGE.period(
                formatBusinessDateTime(view.serviceStartDate),
                formatBusinessDateTime(view.serviceEndDate),
              )}
            </p>
          ) : null}
          <HomeLink />
        </Section>
      );
    case "expired":
    case "invalidated":
      return (
        <Section title={CONFIRM_PAGE.invalidTitle}>
          <p className="text-bone/85">
            {view.canRegenerate
              ? LINK_PROBLEM_MESSAGES[view.state]
              : CONFIRM_PAGE.regenerateNotAllowed}
          </p>
          {view.canRegenerate ? <RegenerateLinkForm reference={view.reference} /> : <HomeLink />}
        </Section>
      );
    case "contract_not_pending":
      return (
        <Section title={CONFIRM_PAGE.notPendingTitle}>
          <p className="text-bone/85">
            {view.reference}: {CONFIRM_PAGE.statusLabels[view.status]}.
          </p>
          <HomeLink />
        </Section>
      );
    case "not_found":
      return (
        <Section title={CONFIRM_PAGE.invalidTitle}>
          <p className="text-bone/85">{LINK_PROBLEM_MESSAGES.not_found}</p>
          <RegenerateLinkForm />
        </Section>
      );
  }
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-3 space-y-6">
      <h1 className="text-5xl sm:text-6xl">{title}</h1>
      {children}
    </div>
  );
}

function Details({ details }: { details: TransferApprovalDetails }) {
  const { labels, statusLabels } = CONFIRM_PAGE;
  const items: Array<[string, string]> = [
    [labels.customerName, details.customerName],
    [labels.customerEmail, details.customerEmail],
    [labels.programName, details.programName],
    [labels.amount, details.amount],
    [labels.method, details.method],
    [labels.reference, details.reference],
    [labels.status, statusLabels[details.status]],
    [labels.createdAt, formatBusinessDateTime(details.createdAt)],
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

function HomeLink() {
  return (
    <Link
      href="/"
      className="inline-block font-semibold underline underline-offset-4 hover:text-volt"
    >
      {CONFIRM_PAGE.home}
    </Link>
  );
}
