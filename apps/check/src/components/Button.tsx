import type { ButtonHTMLAttributes } from "react";

const base =
  "label inline-block cursor-pointer border-[1.5px] px-6 py-3.5 text-base leading-[1.4] tracking-[0.42px] transition-colors duration-300 disabled:cursor-progress disabled:opacity-60";

const variants = {
  // Accent fill; on hover the fill goes transparent (bitnomial primary).
  primary: "border-dawn bg-dawn text-ink hover:bg-transparent",
  // Transparent; on hover the accent fills in.
  outline: "border-dawn bg-transparent text-ink hover:bg-dawn",
  // Plain dark button for use on light surfaces.
  dark: "border-ink bg-ink text-paper hover:bg-transparent hover:text-ink",
} as const;

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof variants }) {
  return <button className={`${base} ${variants[variant]} ${className}`} {...props} />;
}
