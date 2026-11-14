"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "@phosphor-icons/react";
import { resolveTheme, THEME_KEY, type Theme } from "../theme";

/**
 * Light or dark for the console. The choice is kept in this browser. The theme is set on the page root only while a console
 * screen is open, so the public pages keep their own look.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(THEME_KEY);
    } catch {
      /* storage can be blocked */
    }
    setTheme(resolveTheme(stored));
    return () => document.documentElement.removeAttribute("data-theme");
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  function flip() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* the choice just is not remembered */
    }
  }

  const Icon = theme === "dark" ? Sun : Moon;
  return (
    <button
      type="button"
      onClick={flip}
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      title={theme === "dark" ? "Light mode" : "Dark mode"}
      className="inline-flex size-9 cursor-pointer items-center justify-center border border-line-2 transition-colors hover:border-ink"
    >
      <Icon size={18} weight="regular" aria-hidden />
    </button>
  );
}
