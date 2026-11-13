import { Disclosure } from "./Disclosure";

/**
 * A failed read, said plainly: what could not be read and what to do next. The raw message from the RPC or the
 * library stays one click away, for someone reporting a bug.
 */
export function ReadError({ what, detail, className = "" }: { what: string; detail?: string | null; className?: string }) {
  return (
    <div role="alert" className={`border-l-[3px] border-dawn bg-dawn-wash px-5 py-4 text-[15px] ${className}`}>
      <p>Couldn&apos;t read {what}. Check your connection and try again in a moment.</p>
      {detail && (
        <Disclosure title="Details" className="mt-2 text-sm text-slate [&>summary]:font-normal">
          <p className="mono mt-2 break-words text-xs">{detail}</p>
        </Disclosure>
      )}
    </div>
  );
}
