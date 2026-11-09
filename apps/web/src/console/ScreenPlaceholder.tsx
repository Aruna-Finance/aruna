import { SCREENS, type ScreenId } from "./nav";

/** A screen that exists in the shell but is built in a later phase. Says so, and says what it will hold. */
export function ScreenPlaceholder({ id }: { id: ScreenId }) {
  const s = SCREENS[id];
  return (
    <article>
      <h1 className="text-[clamp(28px,4vw,44px)]">{s.title}</h1>
      <p className="mt-4 leading-[1.6] text-slate">{s.plan}</p>
      <p className="mt-8 border-l-[3px] border-dawn bg-dawn-wash px-5 py-4 text-[15px]">
        This screen is built in <span className="mono">{s.phase}</span>. The shell, role switcher and sidebar are in
        place.
      </p>
    </article>
  );
}
