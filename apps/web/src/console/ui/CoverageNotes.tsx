import { NOT_COVERED } from "@/landing/lib/facts";
import { heartbeatStale, type Attestor } from "../data/coverage";
import { n0 } from "../fmt";

export function HeartbeatAlert({ attestors }: { attestors: Attestor[] }) {
  const dead = attestors.filter(heartbeatStale);
  if (!dead.length) return null;
  return (
    <p className="border-l-[3px] border-dawn bg-dawn-wash px-5 py-4 leading-[1.6]">
      <strong className="font-medium">An attestor has stopped reporting.</strong>{" "}
      {dead.map((a, i) => (
        <span key={a.id}>
          {i > 0 && ", "}
          <span className="mono">{a.id}</span> last signed {n0(a.heartbeatAgeBlocks)} blocks ago
        </span>
      ))}
      . A silent attestor produces no error and no claims, so the system looks healthy while drift goes unseen. New coverage on
      its targets is blocked until it resumes.
    </p>
  );
}

export function NotCovered() {
  return (
    <ul className="grid gap-2 text-[15px]">
      {NOT_COVERED.map((x) => (
        <li key={x} className="flex gap-3 border-t border-line pt-2">
          <span aria-hidden className="mt-2 size-2 shrink-0 bg-dawn-ink" />
          {x}
        </li>
      ))}
    </ul>
  );
}
