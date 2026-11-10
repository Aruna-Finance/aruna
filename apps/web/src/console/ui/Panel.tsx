import type { ReactNode } from "react";

/** The console card: same border, fill and padding as the landing cards. */
export function Panel({
  title,
  aside,
  children,
  className = "",
}: {
  title?: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`border border-line-2 bg-paper p-6 md:p-8 ${className}`}>
      {(title || aside) && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          {title && <h2 className="text-xl font-medium">{title}</h2>}
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}
