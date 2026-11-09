import { SmoothScroll } from "@/shared/SmoothScroll";

/** Smooth scrolling belongs to the landing, spec and proof pages. The console scrolls natively. */
export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SmoothScroll />
      {children}
    </>
  );
}
