"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { ROLES, type RoleId } from "./nav";

const KEY = "aruna.console.role";
const Ctx = createContext<{ role: RoleId; setRole: (r: RoleId) => void }>({ role: "owner", setRole: () => {} });

/** The active role. A per-viewer convenience kept in localStorage; the page works without it. */
export function RoleProvider({ children }: { children: ReactNode }) {
  const [role, setRoleState] = useState<RoleId>("owner");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved && ROLES.some((r) => r.id === saved)) setRoleState(saved as RoleId);
    } catch {
      /* storage blocked: keep the default */
    }
  }, []);

  const setRole = (r: RoleId) => {
    setRoleState(r);
    try {
      localStorage.setItem(KEY, r);
    } catch {
      /* ignore */
    }
  };

  return <Ctx.Provider value={{ role, setRole }}>{children}</Ctx.Provider>;
}

export const useRole = () => useContext(Ctx);
