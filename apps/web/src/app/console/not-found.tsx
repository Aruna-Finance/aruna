import Link from "next/link";

export default function NotFound() {
  return (
    <article className="max-w-[640px]">
      <h1 className="text-[clamp(28px,4vw,44px)]">This screen does not exist</h1>
      <p className="mt-4 leading-[1.6] text-slate">
        The address does not match any console screen. Pick one from the sidebar, or go back to the start.
      </p>
      <Link href="/console/" className="label mt-6 inline-block underline underline-offset-4">
        Back to the console
      </Link>
    </article>
  );
}
