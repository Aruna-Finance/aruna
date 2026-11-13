"use client";

import Link from "next/link";
import { isValidAccountId } from "@aruna/rpc";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/shared/Button";
import { fetchViewTransport, Registry } from "@aruna/sdk/coverage";
import { createTestnetReads } from "../chain-reads";
import {
  buildCeiling,
  classifiedTarget,
  classifiedTargets,
  createVaultArgs,
  FACTORY,
  FAUCET_BACKUP_URL,
  FAUCET_URL,
  GAS_CREATE_VAULT,
  nextStep,
  planFunds,
  readFactory,
  SEED_TARGETS,
  setupChecklist,
  vaultIdOf,
  vaultNameError,
  vaultTaken,
  type FactoryInfo,
  type TargetOption,
} from "../data/factory";
import { nearToYocto, yoctoToNear } from "../fmt";
import { mergeVaultRows, ownedVaults, type OwnedVault } from "../data/owned-vaults";
import { REGISTRY } from "../data/price";
import { defaultHistory } from "../history";
import { useTx } from "../TxContext";
import { ClassTag } from "../ui/ClassTag";
import { NumberField, TextField } from "../ui/Field";
import { historyNotice, targetHref } from "../ui/Freshness";
import { Panel } from "../ui/Panel";
import { TokenIcon } from "../ui/Token";

import { useVaultView } from "../useVaultView";
import { useWallet } from "../WalletContext";
import { relationOf, RELATION_TEXT } from "../walletRole";
import { createWalletTransport, sendNear } from "../wallet-transport";

// Create your own vault (plan U5, R15 to R17). The wallet that signs is the owner. Nothing here classifies a target:
// a target is offered only when the registry already holds a class for it.

const GAS_TGAS = 150n;

export function CreateVault() {
  const { accountId, getWallet } = useWallet();
  const { open } = useTx();
  const reads = useMemo(() => createTestnetReads(), []);
  const history = useMemo(() => defaultHistory(), []);

  const [info, setInfo] = useState<FactoryInfo | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [targets, setTargets] = useState<TargetOption[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [name, setName] = useState("");
  const [operatorMode, setOperatorMode] = useState<"me" | "other">("me");
  const [otherOperator, setOtherOperator] = useState("");
  const [deposit, setDeposit] = useState(0.5);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [extra, setExtra] = useState("");
  const [extraNote, setExtraNote] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    readFactory(reads)
      .then(async (f) => {
        if (!live) return;
        setInfo(f);
        const found = await classifiedTargets(reads, f.registry, SEED_TARGETS);
        if (!live) return;
        setTargets(found);
        // A target the registry has classified is picked by default, so the default ceiling is usable.
        setPicked(new Set(found.filter((t) => !t.frozen).slice(0, 1).map((t) => t.target)));
      })
      .catch((e: unknown) => live && setInfoError(e instanceof Error ? e.message : "Could not read the factory."));
    return () => {
      live = false;
    };
  }, [reads]);

  useEffect(() => {
    let live = true;
    setBalance(null);
    if (accountId) reads.balance(accountId).then((b) => live && setBalance(b)).catch(() => live && setBalance(null));
    return () => {
      live = false;
    };
  }, [accountId, reads, created]);

  const nameError = name === "" ? null : vaultNameError(name);
  const operator = operatorMode === "me" ? accountId : otherOperator.trim() === "" ? null : otherOperator.trim();
  const operatorError = operatorMode === "other" && otherOperator.trim() !== "" && !isValidAccountId(otherOperator.trim()) ? "That is not a valid account id." : null;
  const depositYocto = nearToYocto(deposit);
  const plan = info && balance !== null ? planFunds({ balanceYocto: balance, depositYocto, minDepositYocto: info.minDepositYocto }) : null;
  const chosen = targets.filter((t) => picked.has(t.target));
  const ready = Boolean(accountId && info && name && !nameError && !operatorError && chosen.length > 0 && plan?.ok);

  async function addExtra() {
    setExtraNote(null);
    const id = extra.trim();
    if (!info || !id) return;
    if (targets.some((t) => t.target === id)) return setExtraNote("Already in the list.");
    try {
      const t = await classifiedTarget(reads, info.registry, id);
      if (!t) return setExtraNote(`The registry has no class for ${id}, so it cannot go in a ceiling. This console does not classify targets.`);
      setTargets((l) => [...l, t]);
      setExtra("");
    } catch {
      setExtraNote("Could not read the registry. Try again.");
    }
  }

  async function submit() {
    setFormError(null);
    if (!ready || !accountId || !info) return;
    try {
      if (await vaultTaken(reads, name)) return setFormError(`${vaultIdOf(name)} already exists. Pick another name.`);
    } catch {
      return setFormError("Could not check whether the name is free. Try again.");
    }
    const vault = vaultIdOf(name);
    const args = createVaultArgs({ name, owner: accountId, operator, ceiling: buildCeiling(chosen) });
    open({
      title: "Create your vault",
      signer: accountId,
      receiver: FACTORY,
      method: "create_vault",
      depositYocto: depositYocto.toString(),
      gas: GAS_CREATE_VAULT,
      actions: [`create ${vault}`, `owner ${accountId}`, `operator ${operator ?? "none"}`, `ceiling targets ${chosen.map((t) => t.target).join(", ")}`],
      note: "The deposit becomes the vault's balance. The vault has no full-access key, so only its own rules can move the money.",
      okLabel: "Create vault",
      onOk: async () => {
        const wallet = await getWallet();
        if (!wallet) throw new Error("Connect a wallet first.");
        const transport = createWalletTransport({ wallet, signerId: accountId, ...reads });
        const r = await transport.call(FACTORY, "create_vault", args, { depositYocto, tgas: GAS_TGAS });
        history.track({ hash: r.tx, vault, label: "Create vault" });
        setCreated(vault);
        return r;
      },
    });
  }

  return (
    <article>
      <h1 className="text-[clamp(28px,4vw,44px)]">Create your vault</h1>
      <p className="mt-4 max-w-[70ch] leading-[1.6] text-slate">
        A vault holds an agent&apos;s money and enforces its limits. You become its owner. It is created by the current factory on testnet,
        with no full-access key, and you set which contracts agents may touch.
      </p>

      <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-6">
        {!accountId && (
          <Panel>
            <p className="leading-[1.6]">Connect a testnet wallet with the button in the header. The account you connect becomes the owner.</p>
          </Panel>
        )}
        {infoError && <p className="border-l-[3px] border-dawn bg-dawn-wash px-5 py-4 text-[15px]">Could not read the factory. {infoError}</p>}

        <Panel title="1. Name and roles">
          <div className="grid gap-5 sm:max-w-xl">
            <TextField
              label="Vault name"
              value={name}
              onChange={(v) => setName(v.toLowerCase())}
              mono
              hint={nameError ?? (name ? `The vault will be ${vaultIdOf(name)}.` : `It becomes <name>.${FACTORY}.`)}
            />
            <fieldset>
              <legend className="text-sm font-medium">Operator</legend>
              <div className="mt-2 grid gap-2 text-[15px]">
                <label className="flex items-center gap-3">
                  <input type="radio" name="op" checked={operatorMode === "me"} onChange={() => setOperatorMode("me")} />
                  Me. The same account is owner and operator.
                </label>
                <label className="flex items-center gap-3">
                  <input type="radio" name="op" checked={operatorMode === "other"} onChange={() => setOperatorMode("other")} />
                  Another account, such as the company that runs the agents.
                </label>
              </div>
              {operatorMode === "other" && (
                <div className="mt-3">
                  <TextField label="Operator account" value={otherOperator} onChange={setOtherOperator} mono hint={operatorError ?? "Leave empty for no operator."} />
                </div>
              )}
            </fieldset>
          </div>
        </Panel>

        <Panel title="2. Which contracts agents may touch" aside={<span className="text-sm text-muted">Only targets the registry has classified</span>}>
          {info && targets.length === 0 && <p className="text-sm text-muted">The registry has no class for the listed targets yet.</p>}
          <ul className="grid gap-3">
            {targets.map((t) => (
              <li key={t.target} className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={picked.has(t.target)}
                    onChange={(e) =>
                      setPicked((s) => {
                        const n = new Set(s);
                        if (e.target.checked) n.add(t.target);
                        else n.delete(t.target);
                        return n;
                      })
                    }
                  />
                  <span className="mono text-sm">{t.target}</span>
                </label>
                <ClassTag c={t.class} target={t.target} />
                {t.frozen && <span className="mono border border-dawn-ink px-2 py-0.5 text-xs text-dawn-ink">frozen: spends are refused</span>}
                <Link href={targetHref(t.target)} className="text-sm underline underline-offset-4">
                  Evidence
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-5 sm:max-w-xl">
            <div className="flex items-end gap-3">
              <div className="min-w-0 flex-1">
                <TextField label="Add a classified target" value={extra} onChange={setExtra} mono />
              </div>
              <Button type="button" variant="outline" className="inline-flex h-[51px] items-center py-0!" onClick={addExtra} disabled={!info || !extra.trim()}>
                Check
              </Button>
            </div>
            <p className="mt-1.5 text-sm text-muted">{extraNote ?? "Checked against the registry, not classified here."}</p>
          </div>
          <p className="mt-4 max-w-[70ch] text-sm leading-[1.6] text-muted">
            The ceiling limits every agent to 0.5 NEAR per transaction and 2 NEAR per day, and admits the riskiest class you pick here. You can
            change it later as owner.
          </p>
        </Panel>

        <Panel title="3. Fund it and sign">
          <div className="grid gap-5 sm:max-w-xl">
            <NumberField
              label="Deposit"
              value={deposit}
              onChange={setDeposit}
              suffix={<TokenIcon t="NEAR" />}
              step={0.1}
              hint={info ? `The factory requires at least ${yoctoToNear(info.minDepositYocto.toString())} NEAR. It becomes the vault's balance.` : undefined}
            />
            <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-1 text-sm">
              <dt className="text-muted">Your balance</dt>
              <dd className="mono text-right">{balance === null ? (accountId ? "reading" : "no wallet") : `${yoctoToNear(balance.toString())} NEAR`}</dd>
              <dt className="text-muted">Needed (deposit + gas reserve)</dt>
              <dd className="mono text-right">{plan ? `${yoctoToNear(plan.neededYocto.toString())} NEAR` : "n/a"}</dd>
            </dl>
            {plan && plan.shortfallYocto > 0n && (
              <p className="border-l-[3px] border-dawn bg-dawn-wash px-4 py-3 text-sm leading-[1.6]" role="status">
                Your balance is {yoctoToNear(plan.shortfallYocto.toString())} NEAR short. Nothing is sent. Get testnet NEAR from the{" "}
                <a href={FAUCET_URL} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                  NEAR faucet
                </a>{" "}
                (or{" "}
                <a href={FAUCET_BACKUP_URL} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                  near-faucet.io
                </a>
                ), then come back.
              </p>
            )}
            {plan?.depositTooSmall && info && (
              <p className="text-sm text-dawn-ink" role="status">
                The deposit is under the factory minimum of {yoctoToNear(info.minDepositYocto.toString())} NEAR. The factory would refuse it.
              </p>
            )}
            {formError && (
              <p className="text-sm text-dawn-ink" role="alert">
                {formError}
              </p>
            )}
            <div>
              <Button type="button" onClick={submit} disabled={!ready}>
                Review and create
              </Button>
            </div>
          </div>
        </Panel>

        {created && <CreatedVault key={created} vault={created} account={accountId} reads={reads} getWallet={getWallet} open={open} />}

        <MyVaults account={accountId} history={history} />
      </div>
    </article>
  );
}

function CreatedVault({
  vault,
  account,
  reads,
  getWallet,
  open,
}: {
  vault: string;
  account: string | null;
  reads: ReturnType<typeof createTestnetReads>;
  getWallet: ReturnType<typeof useWallet>["getWallet"];
  open: ReturnType<typeof useTx>["open"];
}) {
  const [tick, setTick] = useState(0);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [amount, setAmount] = useState(1);
  const state = useVaultView(`${tick >= 0 ? vault : ""}`);

  useEffect(() => {
    let live = true;
    reads.balance(vault).then((b) => live && setBalance(b)).catch(() => live && setBalance(null));
    return () => {
      live = false;
    };
  }, [vault, reads, tick]);

  const view = state.status === "ok" ? state.view : null;
  const items = setupChecklist({
    exists: view !== null,
    ceilingTargets: view?.ceiling?.allowedTargets.length ?? 0,
    balanceYocto: balance,
    agents: view?.agents.length ?? 0,
  });
  const next = nextStep(items);
  const relation = view ? relationOf(account, view) : null;

  function deposit() {
    if (!account) return;
    const yocto = nearToYocto(amount);
    open({
      title: "Deposit NEAR into your vault",
      signer: account,
      receiver: vault,
      method: "transfer",
      depositYocto: yocto.toString(),
      actions: [`transfer ${yoctoToNear(yocto.toString())} NEAR to ${vault}`],
      note: "A plain transfer. Only the vault's rules can move it out again.",
      okLabel: "Deposit",
      onOk: async () => {
        const wallet = await getWallet();
        if (!wallet) throw new Error("Connect a wallet first.");
        const r = await sendNear({ wallet, signerId: account, receiver: vault, depositYocto: yocto });
        setTick((t) => t + 1);
        return r;
      },
    });
  }

  return (
    <Panel title={`Your vault ${vault}`} aside={<Button type="button" variant="outline" onClick={() => setTick((t) => t + 1)}>Refresh</Button>}>
      {state.status === "loading" && <p className="text-muted">Reading the vault.</p>}
      {state.status === "error" && (
        <p className="text-sm leading-[1.6]">
          The vault is not readable yet. A new vault can take a few seconds to appear. Press Refresh. {state.message}
        </p>
      )}
      {relation && <p className="mb-4 text-[15px]">{RELATION_TEXT[relation]}</p>}
      <ol className="grid gap-2">
        {items.map((i) => (
          <li key={i.id} className="flex items-center gap-3 text-[15px]">
            <b className={`inline-flex size-6 items-center justify-center border text-xs ${i.done ? "border-ink bg-ink text-paper" : "border-line-2 text-muted"}`}>
              {i.done ? "ok" : ""}
            </b>
            <span className={i.done ? "" : next?.id === i.id ? "font-medium" : "text-muted"}>{i.label}</span>
          </li>
        ))}
      </ol>
      <dl className="mt-5 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-muted">Balance</dt>
          <dd className="mono">{balance === null ? "unknown" : `${yoctoToNear(balance.toString())} NEAR`}</dd>
        </div>
        <div>
          <dt className="text-muted">Full-access keys</dt>
          <dd className="mono">{view ? view.fullAccessKeys : "unknown"}</dd>
        </div>
        <div>
          <dt className="text-muted">Agents</dt>
          <dd className="mono">{view ? view.agents.length : "unknown"}</dd>
        </div>
      </dl>
      <div className="mt-6 flex flex-wrap items-end gap-4">
        <div className="w-56">
          <NumberField label="Deposit more" value={amount} onChange={setAmount} suffix={<TokenIcon t="NEAR" />} step={0.5} />
        </div>
        <Button type="button" variant="outline" onClick={deposit} disabled={!account || !(amount > 0)}>
          Deposit
        </Button>
        <Link href={`/console/lookup/?vault=${encodeURIComponent(vault)}`} className="pb-3 text-sm underline underline-offset-4">
          Open in Lookup
        </Link>
        <Link href={`/console/agents/?vault=${encodeURIComponent(vault)}`} className="pb-3 text-sm underline underline-offset-4">
          Manage agents
        </Link>
      </div>
      {next && next.id === "agent" && <p className="mt-4 text-sm text-muted">Next: add an agent. The Agents screen still runs on sample data until the agent step lands.</p>}
    </Panel>
  );
}

export const vaultListNeedsIndexer = "Vaults you only operate, and vaults whose ownership moved, are listed by the indexer, which is not connected in this build.";

async function fromRegistry(account: string): Promise<{ state: "ok"; list: OwnedVault[] } | { state: "error"; message: string }> {
  try {
    const registry = new Registry({ registry: REGISTRY, transport: fetchViewTransport({ network: "testnet" }) });
    return { state: "ok", list: await ownedVaults(registry, account) };
  } catch (e) {
    return { state: "error", message: e instanceof Error ? e.message : "The registry could not be read." };
  }
}

export function MyVaults({ account, history }: { account: string | null; history: ReturnType<typeof defaultHistory> }) {
  const [rows, setRows] = useState<{ vault: string; role: string }[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    if (!account) {
      setRows(null);
      return;
    }
    Promise.all([history.vaults({ owner: account }), history.vaults({ operator: account }), fromRegistry(account)]).then(([own, op, reg]) => {
      if (!live) return;
      const down = [own, op].find((r) => r.state === "unavailable");
      setNotice(history.source === "fixture" ? vaultListNeedsIndexer : historyNotice(down ?? own, history.source));
      setProblem(reg.state === "error" ? reg.message : null);
      const fromIndexer: { vault: string; role: string }[] = [];
      if (own.state !== "unavailable") fromIndexer.push(...own.items.map((v) => ({ vault: v.vault, role: "owner" })));
      if (op.state !== "unavailable") fromIndexer.push(...op.items.map((v) => ({ vault: v.vault, role: "operator" })));
      setRows(mergeVaultRows(history.source === "fixture" ? [] : fromIndexer, reg.state === "ok" ? reg.list : []));
    });
    return () => {
      live = false;
    };
  }, [account, history]);

  if (!account) return null;
  return (
    <Panel title="Your vaults">
      {rows && rows.length === 0 && !problem && <p className="text-sm text-muted">No vaults found for this account.</p>}
      {rows && rows.length > 0 && (
        <ul className="grid gap-2">
          {rows.map((r) => (
            <li key={r.vault} className="flex flex-wrap items-center gap-3 text-[15px]">
              <Link href={`/console/dashboard/?vault=${encodeURIComponent(r.vault)}`} className="mono underline underline-offset-4">
                {r.vault}
              </Link>
              <span className="text-sm text-muted">{r.role}</span>
            </li>
          ))}
        </ul>
      )}
      {rows === null && <p className="text-sm text-muted">Reading your vaults.</p>}
      {problem && <p className="mt-3 text-sm text-dawn-ink">Could not read the registry. {problem}</p>}
      {notice && <p className="mt-3 text-sm text-muted">{notice}</p>}
    </Panel>
  );
}
