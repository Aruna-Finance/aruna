"use client";
import * as RadixSelect from "@radix-ui/react-select";
import { CaretDown, Check } from "@phosphor-icons/react";

export type Option<T extends string> = { value: T; label: string };

export function Select<T extends string>({
  value,
  onValueChange,
  options,
  label,
  className = "",
}: {
  value: T;
  onValueChange: (v: T) => void;
  options: Option<T>[];
  label: string;
  className?: string;
}) {
  return (
    <RadixSelect.Root value={value} onValueChange={(v) => onValueChange(v as T)}>
      <RadixSelect.Trigger
        aria-label={label}
        className={`label inline-flex min-w-[190px] cursor-pointer items-center justify-between gap-3 border border-line-2 bg-white px-3 py-3.5 text-sm tracking-[0.04em] transition-colors hover:border-ink data-[state=open]:border-ink ${className}`}
      >
        <RadixSelect.Value />
        <RadixSelect.Icon>
          <CaretDown size={16} weight="regular" aria-hidden />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          sideOffset={4}
          className="z-50 min-w-(--radix-select-trigger-width) border border-ink bg-white"
        >
          <RadixSelect.Viewport>
            {options.map((o) => (
              <RadixSelect.Item
                key={o.value}
                value={o.value}
                className="label flex cursor-pointer items-center justify-between gap-3 px-3 py-3 text-sm outline-none data-[highlighted]:bg-dawn data-[state=checked]:bg-wash data-[highlighted]:data-[state=checked]:bg-dawn"
              >
                <RadixSelect.ItemText>{o.label}</RadixSelect.ItemText>
                <RadixSelect.ItemIndicator>
                  <Check size={16} weight="regular" aria-hidden />
                </RadixSelect.ItemIndicator>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}
