// Charts as plain SVG, built from the raw result files only (plan R42: one command rebuilds every chart
// from raw data). No dependencies. Every chart has a title, a description and labelled axes, and tells its
// series apart by dash and label as well as by colour.
export interface Series {
  name: string;
  points: { x: number; y: number }[];
  color: string;
  dash?: string;
}
export interface Marker {
  x: number;
  label: string;
}

const W = 720;
const H = 360;
const M = { l: 64, r: 210, t: 44, b: 48 };
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function niceTicks(lo: number, hi: number, n = 5): number[] {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / n;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Number(v.toPrecision(12)));
  return out;
}
const fmt = (v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v).toLocaleString("en-US")}` : `${Number(v.toPrecision(3))}`);

export function lineChart(o: { title: string; desc: string; xLabel: string; yLabel: string; series: Series[]; markers?: Marker[]; yMin?: number; yMax?: number; hLine?: { y: number; label: string } }): string {
  const xs = o.series.flatMap((s) => s.points.map((p) => p.x));
  const ys = o.series.flatMap((s) => s.points.map((p) => p.y)).concat(o.hLine ? [o.hLine.y] : []);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = o.yMin ?? Math.min(0, ...ys);
  const y1 = o.yMax ?? (Math.max(...ys) * 1.05 || 1);
  const px = (x: number) => M.l + ((x - x0) / (x1 - x0 || 1)) * (W - M.l - M.r);
  const py = (y: number) => H - M.b - ((y - y0) / (y1 - y0 || 1)) * (H - M.t - M.b);
  const g: string[] = [];
  for (const t of niceTicks(y0, y1)) g.push(`<line x1="${M.l}" x2="${W - M.r}" y1="${py(t)}" y2="${py(t)}" stroke="#d0d7de" stroke-width="1"/><text x="${M.l - 8}" y="${py(t) + 4}" text-anchor="end" font-size="11" fill="#57606a">${fmt(t)}</text>`);
  for (const t of niceTicks(x0, x1)) g.push(`<line x1="${px(t)}" x2="${px(t)}" y1="${H - M.b}" y2="${H - M.b + 4}" stroke="#57606a"/><text x="${px(t)}" y="${H - M.b + 18}" text-anchor="middle" font-size="11" fill="#57606a">${fmt(t)}</text>`);
  if (o.hLine) g.push(`<line x1="${M.l}" x2="${W - M.r}" y1="${py(o.hLine.y)}" y2="${py(o.hLine.y)}" stroke="#57606a" stroke-dasharray="2 3"/><text x="${W - M.r + 8}" y="${py(o.hLine.y) + 4}" font-size="11" fill="#57606a">${esc(o.hLine.label)}</text>`);
  for (const m of o.markers ?? []) g.push(`<line x1="${px(m.x)}" x2="${px(m.x)}" y1="${M.t}" y2="${H - M.b}" stroke="#8250df" stroke-dasharray="4 3"/><text x="${px(m.x) + 4}" y="${M.t + 12}" font-size="11" fill="#8250df">${esc(m.label)}</text>`);
  o.series.forEach((s, i) => {
    const d = s.points.map((p, j) => `${j ? "L" : "M"}${px(p.x).toFixed(1)},${py(p.y).toFixed(1)}`).join(" ");
    g.push(`<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2"${s.dash ? ` stroke-dasharray="${s.dash}"` : ""}/>`);
    const ly = M.t + 16 + i * 18;
    g.push(`<line x1="${W - M.r + 8}" x2="${W - M.r + 30}" y1="${ly - 4}" y2="${ly - 4}" stroke="${s.color}" stroke-width="2"${s.dash ? ` stroke-dasharray="${s.dash}"` : ""}/><text x="${W - M.r + 36}" y="${ly}" font-size="11" fill="#1f2328">${esc(s.name)}</text>`);
  });
  return svg(o.title, o.desc, `${g.join("\n")}
<line x1="${M.l}" x2="${W - M.r}" y1="${H - M.b}" y2="${H - M.b}" stroke="#57606a"/><line x1="${M.l}" x2="${M.l}" y1="${M.t}" y2="${H - M.b}" stroke="#57606a"/>
<text x="${(M.l + W - M.r) / 2}" y="${H - 8}" text-anchor="middle" font-size="12" fill="#1f2328">${esc(o.xLabel)}</text>
<text transform="translate(16 ${(M.t + H - M.b) / 2}) rotate(-90)" text-anchor="middle" font-size="12" fill="#1f2328">${esc(o.yLabel)}</text>`);
}

export function barChart(o: { title: string; desc: string; yLabel: string; bars: { label: string; value: number; lo?: number; hi?: number; color: string }[]; hLine?: { y: number; label: string } }): string {
  const y1 = Math.max(0.01, ...o.bars.map((b) => b.hi ?? b.value), o.hLine?.y ?? 0) * 1.1;
  const bw = (W - M.l - M.r) / o.bars.length;
  const py = (y: number) => H - M.b - 20 - (y / y1) * (H - M.t - M.b - 20);
  const g: string[] = [];
  for (const t of niceTicks(0, y1)) g.push(`<line x1="${M.l}" x2="${W - M.r}" y1="${py(t)}" y2="${py(t)}" stroke="#d0d7de"/><text x="${M.l - 8}" y="${py(t) + 4}" text-anchor="end" font-size="11" fill="#57606a">${Math.round(t * 100)}%</text>`);
  if (o.hLine) g.push(`<line x1="${M.l}" x2="${W - M.r}" y1="${py(o.hLine.y)}" y2="${py(o.hLine.y)}" stroke="#57606a" stroke-dasharray="2 3"/><text x="${W - M.r + 8}" y="${py(o.hLine.y) + 4}" font-size="11" fill="#57606a">${esc(o.hLine.label)}</text>`);
  o.bars.forEach((b, i) => {
    const x = M.l + i * bw + bw * 0.2;
    const w = bw * 0.6;
    g.push(`<rect x="${x}" y="${py(b.value)}" width="${w}" height="${Math.max(1, py(0) - py(b.value))}" fill="${b.color}"/>`);
    if (b.lo !== undefined && b.hi !== undefined) g.push(`<line x1="${x + w / 2}" x2="${x + w / 2}" y1="${py(b.lo)}" y2="${py(b.hi)}" stroke="#1f2328"/><line x1="${x + w / 2 - 5}" x2="${x + w / 2 + 5}" y1="${py(b.hi)}" y2="${py(b.hi)}" stroke="#1f2328"/><line x1="${x + w / 2 - 5}" x2="${x + w / 2 + 5}" y1="${py(b.lo)}" y2="${py(b.lo)}" stroke="#1f2328"/>`);
    g.push(`<text x="${x + w / 2}" y="${py(b.hi ?? b.value) - 6}" text-anchor="middle" font-size="11" fill="#1f2328">${(b.value * 100).toFixed(1)}%</text>`);
    wrap(b.label, 15).forEach((l, j) => g.push(`<text x="${x + w / 2}" y="${py(0) + 14 + j * 12}" text-anchor="middle" font-size="10" fill="#1f2328">${esc(l)}</text>`));
  });
  return svg(o.title, o.desc, `${g.join("\n")}
<line x1="${M.l}" x2="${W - M.r}" y1="${py(0)}" y2="${py(0)}" stroke="#57606a"/>
<text transform="translate(16 ${(M.t + H - M.b) / 2}) rotate(-90)" text-anchor="middle" font-size="12" fill="#1f2328">${esc(o.yLabel)}</text>`);
}

/** Greedy word wrap to at most `max` characters a line. */
function wrap(text: string, max: number): string[] {
  const lines: string[] = [];
  for (const word of text.split(" ")) {
    const last = lines[lines.length - 1];
    if (last !== undefined && (last + " " + word).length <= max) lines[lines.length - 1] = last + " " + word;
    else lines.push(word);
  }
  return lines;
}

function svg(title: string, desc: string, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="t d" font-family="system-ui, sans-serif">
<title id="t">${esc(title)}</title><desc id="d">${esc(desc)}</desc>
<rect width="${W}" height="${H}" fill="#ffffff"/>
<text x="${M.l}" y="24" font-size="14" font-weight="600" fill="#1f2328">${esc(title)}</text>
${body}
</svg>
`;
}
