/**
 * PLACEHOLDER de imagen. SRS §4.1 pide fotografía real de entrenamiento: la marca debe
 * proporcionarla. Reemplazar cada uso por `next/image` con la foto final y su `alt`.
 */
export function ImagePlaceholder({ label, className = "" }: { label: string; className?: string }) {
  return (
    <div
      role="img"
      aria-label={`Imagen pendiente: ${label}`}
      data-placeholder="image"
      className={`relative flex items-end overflow-hidden border border-bone/15 bg-ink-soft bg-[repeating-linear-gradient(135deg,transparent_0_14px,rgb(245_243_238/0.04)_14px_28px)] p-4 ${className}`}
    >
      <span className="bg-ink/80 px-2 py-1 font-mono text-xs tracking-wider text-bone/80 uppercase">
        Imagen pendiente · {label}
      </span>
    </div>
  );
}
