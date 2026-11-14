/**
 * Tailwind classes that turn a table into stacked rows below 640px: the header hides, each row becomes a two-column
 * grid and its first cell spans both. Put them on the <table>; the table keeps its desktop layout from sm up. A cell
 * with data-label shows that label above its value on mobile, in place of the hidden header (globals.css).
 */
export const STACK_ON_MOBILE =
  "stack-mobile max-sm:min-w-0 max-sm:block max-sm:[&_thead]:hidden max-sm:[&_tbody]:block max-sm:[&_tr]:grid max-sm:[&_tr]:grid-cols-2 max-sm:[&_tr]:gap-x-4 max-sm:[&_tr]:border-b max-sm:[&_tr]:border-line max-sm:[&_tr]:py-3 max-sm:[&_td]:block max-sm:[&_td]:border-0 max-sm:[&_td]:px-0 max-sm:[&_td]:py-1 max-sm:[&_td]:text-left max-sm:[&_td:first-child]:col-span-2";
