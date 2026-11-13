"use client";

import type { AgentView } from "@aruna/sdk";
import { useMemo, useState } from "react";
import { Button } from "@/shared/Button";
import { Select } from "@/shared/Select";
import { createTestnetReads } from "../chain-reads";
import { amountText } from "../data/coverage-live";
import { exposureCall, exposureCommand } from "../data/exposure-before";
import { block } from "../fmt";
import { useTokenMeta } from "../useTokenMeta";
import { CopyBlock } from "./CopyBlock";
import { TextField } from "./Field";
import { Panel } from "./Panel";

type Answer = { state: "idle" } | { state: "asking" } | { state: "error"; message: string } | { state: "ok"; amount: string; token: string; at: number };

/**
 * R26: how much had an agent sent to a target, in a token, before a block, as the vault's own `exposure_before` view
 * answers it. This is the figure a claim is paid from, so the owner can check it for any block, not only a claimed one.
 */
export function ExposureBefore({ vault, agents, defaultTarget }: { vault: string; agents: AgentView[]; defaultTarget?: string }) {
  const reads = useMemo(() => createTestnetReads(), []);
  const [agent, setAgent] = useState(agents[0]?.publicKey ?? "");
  const [target, setTarget] = useState(defaultTarget ?? "");
  const [token, setToken] = useState("near");
  const [at, setAt] = useState("");
  const [answer, setAnswer] = useState<Answer>({ state: "idle" });
  const call = exposureCall({ agent, target, token, block: at });
  const ready = !("problem" in call);
  const meta = useTokenMeta(answer.state === "ok" ? [answer.token] : []);

  async function ask() {
    if ("problem" in call) return;
    setAnswer({ state: "asking" });
    try {
      const amount = await reads.view<string>(vault, "exposure_before", call.args);
      setAnswer({ state: "ok", amount, token: call.args.token === "near" ? "near" : call.args.token.ft, at: call.args.block });
    } catch (e) {
      setAnswer({ state: "error", message: e instanceof Error ? e.message : "The vault could not be read." });
    }
  }

  return (
    <Panel title="Exposure before a block">
      <p className="max-w-[80ch] text-sm leading-[1.6] text-slate">
        Ask the vault how much an agent had sent to a target before a block. A claim pays from the difference between two such answers, so this
        is the number to check it against. It is what passed through the vault, not the value of a position.
      </p>
      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <div>
          <p className="text-sm font-medium">Agent</p>
          <Select label="Agent" value={agent} onValueChange={setAgent} options={agents.map((a) => ({ value: a.publicKey, label: a.label }))} className="mt-1.5 w-full" />
        </div>
        <TextField label="Target" mono value={target} onChange={setTarget} />
        <TextField label='Token ("near" or a token contract)' mono value={token} onChange={setToken} />
        <TextField label="Block height" mono value={at} onChange={setAt} />
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button type="button" disabled={!ready || answer.state === "asking"} onClick={ask}>
          Ask the vault
        </Button>
        {"problem" in call && at !== "" && <span className="text-sm text-muted">{call.problem}</span>}
      </div>
      {answer.state === "asking" && <p className="mt-4 text-sm text-muted">Asking the vault.</p>}
      {answer.state === "error" && <p className="mt-4 border-l-[3px] border-dawn bg-dawn-wash px-5 py-4 text-[15px]">Could not read the vault. {answer.message}</p>}
      {answer.state === "ok" && (
        <p className="mt-4 text-[15px]">
          Before block {block(answer.at)}: <span className="mono">{amountText(answer.token, answer.amount, meta.get(answer.token))}</span>
        </p>
      )}
      {ready && (
        <div className="mt-5">
          <p className="mb-2 text-sm text-muted">The same question, without this page:</p>
          <CopyBlock text={exposureCommand(vault, call.args)} />
        </div>
      )}
    </Panel>
  );
}
