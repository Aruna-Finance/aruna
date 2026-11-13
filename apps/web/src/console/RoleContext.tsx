"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { ROLES, type RoleId } from "./nav";

const KEY = "aruna.console.role";
const Ctx = createContext<{ role: RoleId; setRole: (r: RoleId) => void; ready: boolean }>({ role: "owner", setRole: () => {}, ready: false });

/** The active role. A per-viewer convenience kept in localStorage; the page works without it. */
export function RoleProvider({ children }: { children: ReactNode }) {
  const [role, setRoleState] = useState<RoleId>("owner");
  // True once the stored role has been read, so a deep link is matched against the role the viewer will actually see.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved && ROLES.some((r) => r.id === saved)) setRoleState(saved as RoleId);
    } catch {
      /* storage blocked: keep the default */
    }
    setReady(true);
  }, []);

  const setRole = (r: RoleId) => {
    setRoleState(r);
    try {
      localStorage.setItem(KEY, r);
    } catch {
      /* ignore */
    }
  };

  return <Ctx.Provider value={{ role, setRole, ready }}>{children}</Ctx.Provider>;
}

export const useRole = () => useContext(Ctx);
