export type Theme = "light" | "dark";
export const THEME_KEY = "aruna-theme";

/** Dark unless the person chose light. Anything else stored is ignored. */
export function resolveTheme(stored: string | null): Theme {
  return stored === "light" ? "light" : "dark";
}

/** Runs before the first paint of a console page, so the page never opens light and then turns dark. */
export const THEME_BOOT = `try{if(localStorage.getItem(${JSON.stringify(THEME_KEY)})!=="light")document.documentElement.setAttribute("data-theme","dark")}catch(e){document.documentElement.setAttribute("data-theme","dark")}`;
