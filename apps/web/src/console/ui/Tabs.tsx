"use client";

import type { ReactNode } from "react";

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  children,
}: {
  tabs: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  children: ReactNode;
}) {
  return (
    <div>
      <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-line-2 pt-px">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            id={`tab-${t.id}`}
            aria-selected={t.id === value}
            aria-controls="tabpanel"
            onClick={() => onChange(t.id)}
            className="label -mb-px shrink-0 cursor-pointer border border-line-2 bg-paper px-5 py-2.5 text-sm text-slate transition-colors hover:border-dawn hover:text-dawn aria-selected:border-dawn aria-selected:border-b-paper aria-selected:text-dawn"
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="tabpanel" aria-labelledby={`tab-${value}`} className="mt-6">
        {children}
      </div>
    </div>
  );
}
