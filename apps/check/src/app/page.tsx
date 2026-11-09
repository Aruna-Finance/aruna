import { CheckBox } from "@/components/CheckBox";

export default function Page() {
  return (
    <main className="wrap">
      <header className="top">
        <span className="brand">Aruna</span>
        <span className="badge">testnet</span>
      </header>
      <h1>
        Can this NEAR contract still <em>change</em> under your agent?
      </h1>
      <p className="sub">
        Aruna found a class of contract that can change with no transaction touching it, while the
        field everyone monitors never changes. Paste an account to see its class and the evidence.
      </p>
      <CheckBox />
      <p className="caption mono">No wallet · no backend · reproducible from public RPC</p>
    </main>
  );
}
