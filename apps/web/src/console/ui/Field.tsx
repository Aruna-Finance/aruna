"use client";

import { useId, type ReactNode } from "react";

/** A labelled number input with a unit suffix, the console's only numeric field. */
export function NumberField({
  label,
  value,
  onChange,
  suffix,
  hint,
  step = 1,
  min = 0,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  suffix: ReactNode;
  hint?: string;
  step?: number;
  min?: number;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <div className="mt-1.5 flex border border-line-2 bg-paper focus-within:border-ink focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ink">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min={min}
          step={step}
          value={Number.isFinite(value) ? value : ""}
          onChange={(e) => onChange(e.target.value === "" ? NaN : Number(e.target.value))}
          className="mono min-w-0 flex-1 bg-transparent px-3 py-2.5 text-[15px] outline-none"
        />
        <span className="label flex min-w-12 items-center justify-center border-l border-line px-3 text-xs text-muted">{suffix}</span>
      </div>
      {hint && <p className="mt-1.5 text-sm text-muted">{hint}</p>}
    </div>
  );
}

export function TextField({
  label,
  value,
  onChange,
  hint,
  mono,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: React.ReactNode;
  mono?: boolean;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        type="text"
        value={value}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        className={`mt-1.5 block w-full border border-line-2 bg-paper px-3 py-2.5 text-[15px] focus:border-ink focus:outline-2 focus:outline-offset-2 focus:outline-ink ${mono ? "mono" : ""}`}
      />
      {hint && <p className="mt-1.5 text-sm text-muted">{hint}</p>}
    </div>
  );
}
