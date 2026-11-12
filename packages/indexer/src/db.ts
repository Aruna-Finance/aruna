// The database the store runs on (plan U1, KTD1 and KTD2): Postgres, reached through one small async interface.
// Production opens postgres.js from DATABASE_URL; the tests open PGlite (real Postgres, in the test process) behind the
// same interface, so both run the same SQL. The URI carries a password: it is a secret (R9), and every error that leaves
// this file has been redacted of it.

import postgres from "postgres";

export type Row = Record<string, unknown>;
/** Positional (`?`, or Postgres's own `$1`) or named (`$name` with an object). */
export type Params = readonly unknown[] | Readonly<Record<string, unknown>>;

export interface Queryable {
  /** The rows a statement returns. */
  query(sql: string, params?: Params): Promise<Row[]>;
  /** How many rows a statement inserted, updated or deleted. */
  run(sql: string, params?: Params): Promise<number>;
}

export interface Db extends Queryable {
  /** Runs `fn` in one transaction on one connection; a throw rolls everything back and is rethrown. */
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/**
 * Turns `?` and `$name` placeholders into Postgres's `$1, $2, ...`, in the order the values are used. A name used twice
 * is one value. Text inside single quotes is left alone. SQL that already uses `$1` takes an array as it is.
 */
export function toPositional(sql: string, params: Params = []): { text: string; values: unknown[] } {
  const values: unknown[] = [];
  const named = new Map<string, number>();
  let text = "";
  let used = false;
  let next = 0;
  for (let i = 0; i < sql.length; ) {
    const c = sql[i];
    if (c === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") j += 2;
          else break;
        } else j++;
      }
      text += sql.slice(i, j + 1);
      i = j + 1;
    } else if (c === "?") {
      used = true;
      if (!Array.isArray(params)) throw new Error("a ? placeholder needs a list of values");
      values.push(params[next++]);
      text += `$${values.length}`;
      i++;
    } else if (c === "$" && /[A-Za-z_]/.test(sql[i + 1] ?? "")) {
      used = true;
      const m = /^\$([A-Za-z_]\w*)/.exec(sql.slice(i))!;
      const name = m[0];
      if (Array.isArray(params)) throw new Error(`placeholder ${name} needs an object of values`);
      let at = named.get(name);
      if (at === undefined) {
        if (!(name in (params as Record<string, unknown>))) throw new Error(`no value for placeholder ${name}`);
        values.push((params as Record<string, unknown>)[name]);
        at = values.length;
        named.set(name, at);
      }
      text += `$${at}`;
      i += name.length;
    } else {
      text += c;
      i++;
    }
  }
  return { text, values: used ? values : Array.isArray(params) ? [...params] : [] };
}

/** Replaces the URI and the parts of it that are secret in `text`. */
export function redactor(url: string): (text: string) => string {
  const secrets = new Set<string>([url]);
  try {
    const u = new URL(url);
    for (const s of [u.password, u.username]) {
      if (s.length >= 3) {
        secrets.add(s);
        secrets.add(decodeURIComponent(s));
      }
    }
  } catch {
    // Not a URL: the whole value is still redacted.
  }
  const list = [...secrets].filter(Boolean).sort((a, b) => b.length - a.length);
  return (text) => list.reduce((t, s) => t.split(s).join("<db>"), text);
}

/** The message and stack of an error, redacted in place, so its class and fields (a Postgres error code) survive. */
function scrub(e: unknown, redact: (t: string) => string): unknown {
  if (e instanceof Error) {
    e.message = redact(e.message);
    if (e.stack) e.stack = redact(e.stack);
  }
  return e;
}

/** How long a connect or a statement may take before it fails into the ingest loop's retry, instead of hanging (KTD7). */
const CONNECT_TIMEOUT_S = 10;
const STATEMENT_TIMEOUT_MS = 30_000;
/** Ingest is serial and the API light, and a Railway deploy briefly runs two instances against one pooler (plan KTD5). */
const MAX_CONNECTIONS = 3;

/** BIGINT as a JavaScript number: every value the indexer stores (heights, milliseconds, a Date.now() nonce) is below 2^53. */
const bigintAsNumber = { to: 20, from: [20], parse: (x: string) => Number(x), serialize: (x: unknown) => String(x) };

export function connect(url: string): Db {
  const redact = redactor(url);
  const sql = postgres(url, {
    max: MAX_CONNECTIONS,
    connect_timeout: CONNECT_TIMEOUT_S,
    idle_timeout: 60,
    connection: { statement_timeout: STATEMENT_TIMEOUT_MS },
    types: { bigint: bigintAsNumber },
    onnotice: () => {},
  });
  type Runner = Pick<postgres.Sql, "unsafe">;
  const wrap = (r: Runner): Queryable => ({
    async query(text, params) {
      const p = toPositional(text, params);
      try {
        return (await r.unsafe(p.text, p.values as postgres.ParameterOrJSON<never>[])) as unknown as Row[];
      } catch (e) {
        throw scrub(e, redact);
      }
    },
    async run(text, params) {
      const p = toPositional(text, params);
      try {
        return (await r.unsafe(p.text, p.values as postgres.ParameterOrJSON<never>[])).count;
      } catch (e) {
        throw scrub(e, redact);
      }
    },
  });
  return {
    ...wrap(sql),
    async transaction(fn) {
      try {
        return (await sql.begin((tx) => fn(wrap(tx)))) as Awaited<ReturnType<typeof fn>>;
      } catch (e) {
        throw scrub(e, redact);
      }
    },
    close: () => sql.end({ timeout: 5 }),
  };
}

/** The database named by DATABASE_URL, or the way to set it (R7). */
export function connectFromEnv(env: NodeJS.ProcessEnv = process.env): Db {
  const url = env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Set it to the Supabase Session pooler URI (Connect, then Session pooler, port 5432): postgresql://postgres.<project>:<password>@<region>.pooler.supabase.com:5432/postgres",
    );
  }
  return connect(url);
}
