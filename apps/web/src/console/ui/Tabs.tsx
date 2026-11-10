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
      <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-line-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            id={`tab-${t.id}`}
            aria-selected={t.id === value}
            aria-controls="tabpanel"
            onClick={() => onChange(t.id)}
            className="-mb-px shrink-0 cursor-pointer border-b-2 border-transparent px-4 py-3 text-[15px] text-muted transition-colors hover:text-ink aria-selected:border-ink aria-selected:font-medium aria-selected:text-ink"
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
