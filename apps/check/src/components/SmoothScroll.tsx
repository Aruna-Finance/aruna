"use client";
import { useEffect } from "react";
import { animate, type AnimationPlaybackControls } from "framer-motion";

const NAV_OFFSET = 64; // sticky navbar height
const EASE = [0.22, 1, 0.36, 1] as const;

/** True when the wheel event should stay native: nested scroller, horizontal gesture, locked body. */
function shouldStayNative(e: WheelEvent): boolean {
  if (e.ctrlKey || e.defaultPrevented) return true; // pinch zoom
  if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return true;
  if (document.body.hasAttribute("data-scroll-locked")) return true; // open select or dialog
  for (let el = e.target as HTMLElement | null; el && el !== document.body; el = el.parentElement) {
    const oy = getComputedStyle(el).overflowY;
    if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight) return true;
  }
  return false;
}

/** Mounted once. Smooths wheel scrolling and in-page anchor jumps with framer-motion. */
export function SmoothScroll() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let controls: AnimationPlaybackControls | null = null;
    let target = window.scrollY;
    const maxScroll = () => document.documentElement.scrollHeight - window.innerHeight;

    const scrollTo = (to: number, duration: number) => {
      controls?.stop();
      target = Math.min(Math.max(to, 0), maxScroll());
      controls = animate(window.scrollY, target, {
        duration,
        ease: EASE,
        onUpdate: (v) => window.scrollTo(0, v),
        onComplete: () => {
          controls = null;
        },
      });
    };

    const onWheel = (e: WheelEvent) => {
      if (shouldStayNative(e)) return;
      e.preventDefault();
      if (!controls) target = window.scrollY;
      const unit = e.deltaMode === 1 ? 32 : e.deltaMode === 2 ? window.innerHeight : 1;
      scrollTo(target + e.deltaY * unit, 0.7);
    };

    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement).closest("a[href^='#']");
      if (!a) return;
      const hash = a.getAttribute("href")!;
      const el = hash === "#" || hash === "#top" ? document.body : document.getElementById(hash.slice(1));
      if (!el) return; // no section for this link yet: leave the browser default
      e.preventDefault();
      const top = el === document.body ? 0 : el.getBoundingClientRect().top + window.scrollY - NAV_OFFSET + 1;
      scrollTo(top, 1);
      history.pushState(null, "", hash);
    };

    // Native scrolling (keyboard, touch, scrollbar drag) must cancel an animation in progress.
    const cancel = () => {
      controls?.stop();
      controls = null;
    };

    window.addEventListener("wheel", onWheel, { passive: false });
    document.addEventListener("click", onClick);
    window.addEventListener("keydown", cancel);
    window.addEventListener("touchstart", cancel, { passive: true });
    return () => {
      controls?.stop();
      window.removeEventListener("wheel", onWheel);
      document.removeEventListener("click", onClick);
      window.removeEventListener("keydown", cancel);
      window.removeEventListener("touchstart", cancel);
    };
  }, []);

  return null;
}
