// Builds minimal WebAssembly modules byte by byte, so each test states exactly which imports exist.

export type ImportSpec =
  | { module?: string; name: string; kind?: "func" }
  | { module?: string; name: string; kind: "memory" }
  | { module?: string; name: string; kind: "global" };

const utf8 = (s: string): number[] => {
  const out: number[] = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
  }
  return out;
};

export const leb = (n: number): number[] => {
  const out: number[] = [];
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n !== 0) b |= 0x80;
    out.push(b);
  } while (n !== 0);
  return out;
};

const name = (s: string): number[] => {
  const b = utf8(s);
  return [...leb(b.length), ...b];
};

export const section = (id: number, body: number[]): number[] => [id, ...leb(body.length), ...body];

export const HEADER = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];

/** Type section with one `() -> ()` function type, which every func import references. */
const TYPE_SECTION = section(1, [1, 0x60, 0, 0]);

export function importSection(imports: ImportSpec[]): number[] {
  const body: number[] = [...leb(imports.length)];
  for (const imp of imports) {
    body.push(...name(imp.module ?? "env"), ...name(imp.name));
    switch (imp.kind ?? "func") {
      case "func":
        body.push(0x00, ...leb(0));
        break;
      case "memory":
        body.push(0x02, 0x00, ...leb(1));
        break;
      case "global":
        body.push(0x03, 0x7f, 0x00);
        break;
    }
  }
  return section(2, body);
}

/** A module with a type section, an optional custom section first, and the given imports. */
export function moduleWith(imports: ImportSpec[], opts: { customFirst?: boolean } = {}): Uint8Array {
  const custom = opts.customFirst ? section(0, [...name("name"), 1, 2, 3]) : [];
  return new Uint8Array([...HEADER, ...custom, ...TYPE_SECTION, ...importSection(imports)]);
}

export const funcs = (...names: string[]): ImportSpec[] => names.map((n) => ({ name: n }));

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
export function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const [a, b, c] = [bytes[i], bytes[i + 1], bytes[i + 2]];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    out += b === undefined ? "=" : B64[(n >> 6) & 63];
    out += c === undefined ? "=" : B64[n & 63];
  }
  return out;
}
