import type { ReactNode } from "react";

type Props = {
  id: string;
  title: string;
  lead?: ReactNode;
  /** `dark` = sección sobre fondo ink; `light` = sección sobre fondo bone. */
  tone?: "dark" | "light";
};

export function SectionHeading({ id, title, lead, tone = "dark" }: Props) {
  return (
    <header className="max-w-2xl">
      <h2 id={id} className="text-5xl sm:text-6xl">
        <span aria-hidden="true" className="mb-3 block h-1.5 w-12 bg-volt" />
        {title}
      </h2>
      {lead ? (
        <p className={`mt-4 text-lg ${tone === "dark" ? "text-bone/75" : "text-ink/75"}`}>{lead}</p>
      ) : null}
    </header>
  );
}
