// Reads the import section of a WebAssembly module, and nothing else (docs/CLASSIFIER.md: no flow
// analysis). Hand-written so the core keeps zero dependencies. Any structural inconsistency met on
// the way to the imports is a failure, which the classifier reports as `unknown` — never a guess.

export interface WasmImport {
  module: string;
  name: string;
  kind: "func" | "table" | "memory" | "global" | "tag";
}

export type ParseResult = { ok: true; imports: WasmImport[] } | { ok: false; error: string };

class ParseError extends Error {}

class Cursor {
  constructor(
    private readonly bytes: Uint8Array,
    public pos = 0,
    private readonly end = bytes.length,
  ) {}

  done(): boolean {
    return this.pos >= this.end;
  }

  byte(): number {
    if (this.pos >= this.end) throw new ParseError(`unexpected end at byte ${this.pos}`);
    return this.bytes[this.pos++];
  }

  /** Unsigned LEB128, up to `maxBits` (32 or 64). Values above 2^53 are rejected rather than rounded. */
  leb(maxBits = 32): number {
    let result = 0;
    let shift = 0;
    for (;;) {
      const b = this.byte();
      if (shift >= maxBits) throw new ParseError(`LEB128 longer than ${maxBits} bits at byte ${this.pos - 1}`);
      result += (b & 0x7f) * 2 ** shift;
      shift += 7;
      if ((b & 0x80) === 0) break;
    }
    if (!Number.isSafeInteger(result)) throw new ParseError("LEB128 value too large");
    return result;
  }

  take(n: number): Uint8Array {
    if (n > this.end - this.pos) throw new ParseError(`length ${n} runs past the end at byte ${this.pos}`);
    const out = this.bytes.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }

  name(): string {
    return decodeUtf8(this.take(this.leb()));
  }

  sub(len: number): Cursor {
    if (len > this.end - this.pos) throw new ParseError(`section of ${len} bytes runs past the end at byte ${this.pos}`);
    const c = new Cursor(this.bytes, this.pos, this.pos + len);
    this.pos += len;
    return c;
  }
}

/** Table and memory limits: a flags byte, a minimum, an optional maximum, an optional page size. */
function skipLimits(c: Cursor): void {
  const flags = c.byte();
  if (flags > 0x0f) throw new ParseError(`unknown limits flags 0x${flags.toString(16)}`);
  const bits = flags & 0x04 ? 64 : 32;
  c.leb(bits);
  if (flags & 0x01) c.leb(bits);
  if (flags & 0x08) c.leb(32);
}

const KINDS = ["func", "table", "memory", "global", "tag"] as const;

function readImportSection(c: Cursor): WasmImport[] {
  const count = c.leb();
  const out: WasmImport[] = [];
  for (let i = 0; i < count; i++) {
    const module = c.name();
    const name = c.name();
    const tag = c.byte();
    const kind = KINDS[tag];
    if (kind === undefined) throw new ParseError(`unknown import kind 0x${tag.toString(16)} for ${module}.${name}`);
    switch (kind) {
      case "func":
        c.leb();
        break;
      case "table":
        c.byte();
        skipLimits(c);
        break;
      case "memory":
        skipLimits(c);
        break;
      case "global":
        c.byte();
        c.byte();
        break;
      case "tag":
        c.byte();
        c.leb();
        break;
    }
    out.push({ module, name, kind });
  }
  if (!c.done()) throw new ParseError("import section has trailing bytes");
  return out;
}

const MAGIC = [0x00, 0x61, 0x73, 0x6d];
const VERSION = [0x01, 0x00, 0x00, 0x00];
const IMPORT_SECTION = 2;

export function parseImports(bytes: Uint8Array): ParseResult {
  try {
    const c = new Cursor(bytes);
    const header = c.take(8);
    if (!MAGIC.every((b, i) => header[i] === b)) throw new ParseError("not a WebAssembly module (bad magic)");
    if (!VERSION.every((b, i) => header[4 + i] === b)) throw new ParseError("unsupported WebAssembly version");
    let imports: WasmImport[] | null = null;
    while (!c.done()) {
      const id = c.byte();
      const body = c.sub(c.leb());
      if (id === IMPORT_SECTION) {
        if (imports !== null) throw new ParseError("more than one import section");
        imports = readImportSection(body);
      }
    }
    return { ok: true, imports: imports ?? [] };
  } catch (e) {
    if (e instanceof ParseError) return { ok: false, error: e.message };
    throw e;
  }
}

/** Strict UTF-8 decoding: overlong forms, surrogates and truncated sequences are rejected. */
export function decodeUtf8(b: Uint8Array): string {
  let out = "";
  for (let i = 0; i < b.length; ) {
    const x = b[i];
    let cp: number;
    let n: number;
    if (x < 0x80) [cp, n] = [x, 1];
    else if (x >= 0xc2 && x < 0xe0) [cp, n] = [x & 0x1f, 2];
    else if (x >= 0xe0 && x < 0xf0) [cp, n] = [x & 0x0f, 3];
    else if (x >= 0xf0 && x < 0xf5) [cp, n] = [x & 0x07, 4];
    else throw new ParseError(`invalid UTF-8 lead byte 0x${x.toString(16)}`);
    if (i + n > b.length) throw new ParseError("truncated UTF-8 sequence");
    for (let k = 1; k < n; k++) {
      const y = b[i + k];
      if ((y & 0xc0) !== 0x80) throw new ParseError("invalid UTF-8 continuation byte");
      cp = (cp << 6) | (y & 0x3f);
    }
    const min = [0, 0, 0x80, 0x800, 0x10000][n];
    if (cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) throw new ParseError("invalid UTF-8 code point");
    out += String.fromCodePoint(cp);
    i += n;
  }
  return out;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_INDEX = new Map([...B64].map((ch, i) => [ch, i]));

/** Standard base64 with padding, as NEAR RPC returns `code_base64`. Throws on any other character. */
export function decodeBase64(s: string): Uint8Array {
  const clean = s.replace(/=+$/, "");
  if (clean.length % 4 === 1) throw new Error("invalid base64 length");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    let n = 0;
    const chunk = clean.slice(i, i + 4);
    for (let k = 0; k < 4; k++) {
      const v = k < chunk.length ? B64_INDEX.get(chunk[k]) : 0;
      if (v === undefined) throw new Error(`invalid base64 character ${JSON.stringify(chunk[k])}`);
      n = (n << 6) | v;
    }
    const bytes = [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
    for (let k = 0; k < chunk.length - 1; k++) out[o++] = bytes[k];
  }
  return out;
}
