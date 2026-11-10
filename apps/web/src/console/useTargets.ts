"use client";

import { useEffect, useMemo, useState } from "react";
import type { RiskClass } from "@/landing/lib/classifier-types";
import { mockTargets } from "./data/mock";
import type { TargetRecord } from "./data/types";

/** The classified targets and a lookup from target id to its recorded class. */
export function useTargets() {
  const [list, setList] = useState<TargetRecord[]>([]);
  useEffect(() => {
    let live = true;
    mockTargets.list().then((rows) => live && setList(rows));
    return () => {
      live = false;
    };
  }, []);
  const classes = useMemo(
    () => Object.fromEntries(list.map((t) => [t.id, t.classification.class])) as Record<string, RiskClass>,
    [list],
  );
  const classOf = (id: string) => classes[id];
  return { list, classes, classOf };
}
