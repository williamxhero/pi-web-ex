"use client";

import { useEffect, useId, useRef, useState } from "react";

export const BRAND_TEXT = "Pi Web Ex";
export const COMPACT_BRAND_TEXT = "πx";

export function PiWebTitle({ label = BRAND_TEXT }: { label?: string }) {
  const card = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", dismiss, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", dismiss, true);
    };
  }, [open]);
  return (
    <div className="sidebar-brand-anchor" ref={root}>
      <button ref={button} type="button" className="sidebar-brand" aria-label={label}
        aria-expanded={open} aria-controls={open ? card : undefined} onClick={() => setOpen(!open)}>
        <span className="sidebar-brand-full" aria-hidden="true">{BRAND_TEXT}</span>
        <span className="sidebar-brand-compact" aria-hidden="true">{COMPACT_BRAND_TEXT}</span>
      </button>
      {open && (
        <div className="sidebar-version-card" id={card} role="region" aria-label={label}>
          <strong>{BRAND_TEXT}</strong>
          <code>{process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0+0.0.0"}</code>
          <span>Pi SDK <code>{process.env.NEXT_PUBLIC_PI_VERSION ?? "unknown"}</code></span>
        </div>
      )}
    </div>
  );
}
