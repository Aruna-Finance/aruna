import { describe, expect, it } from "vitest";
import { connect, connectFromEnv, redactor, toPositional } from "../src/db.js";
import { pglite, pgliteDb } from "./helpers.js";

describe("placeholders", () => {
  it("turns ? into $1, $2 in the order the values are used", () => {
    expect(toPositional("SELECT * FROM t WHERE a = ? AND b IN (?, ?)", [1, "x", "y"])).toEqual({ text: "SELECT * FROM t WHERE a = $1 AND b IN ($2, $3)", values: [1, "x", "y"] });
  });

  it("turns $name into one numbered value per name, even when the name is used twice", () => {
    expect(toPositional("INSERT INTO t (a, b, c) VALUES ($x, $y, $x)", { $x: 1, $y: 2 })).toEqual({ text: "INSERT INTO t (a, b, c) VALUES ($1, $2, $1)", values: [1, 2] });
  });

  it("leaves text inside quotes alone", () => {
    expect(toPositional("SELECT '?' || '$x''?' , ?", ["v"]).text).toBe("SELECT '?' || '$x''?' , $1");
  });

  it("passes SQL that already numbers its values through", () => {
    expect(toPositional("SELECT $1, $2", [1, 2])).toEqual({ text: "SELECT $1, $2", values: [1, 2] });
  });

  it("refuses a named placeholder with no value", () => {
    expect(() => toPositional("SELECT $missing", { $other: 1 })).toThrow(/\$missing/);
  });
});

describe("the interface over Postgres", () => {
  it("returns the row a positional insert wrote, and BIGINT as a number", async () => {
    const db = pgliteDb(await pglite());
    await db.run("CREATE TABLE t (a BIGINT PRIMARY KEY, b TEXT)");
    const rows = await db.query("INSERT INTO t (a, b) VALUES (?, ?) RETURNING a, b", [1794314403283, "x"]);
    expect(rows).toEqual([{ a: 1794314403283, b: "x" }]);
  });

  it("commits a transaction's rows and reports how many rows a statement changed", async () => {
    const db = pgliteDb(await pglite());
    await db.run("CREATE TABLE t (a BIGINT PRIMARY KEY, b TEXT)");
    const changed = await db.transaction(async (tx) => {
      await tx.run("INSERT INTO t VALUES (?, ?)", [1, "x"]);
      return tx.run("UPDATE t SET b = ? WHERE a = ?", ["y", 1]);
    });
    expect(changed).toBe(1);
    expect(await db.query("SELECT b FROM t")).toEqual([{ b: "y" }]);
  });

  it("leaves no row behind when a transaction throws", async () => {
    const db = pgliteDb(await pglite());
    await db.run("CREATE TABLE t (a BIGINT PRIMARY KEY)");
    await expect(
      db.transaction(async (tx) => {
        await tx.run("INSERT INTO t VALUES (1)");
        throw new Error("stop");
      }),
    ).rejects.toThrow("stop");
    expect(await db.query("SELECT a FROM t")).toEqual([]);
  });
});

describe("the connection URI is a secret", () => {
  const url = "postgresql://postgres.abcdefgh:p%40ss-w0rd!@aws-0-eu.pooler.supabase.com:5432/postgres";

  it("is removed from an error message, with its password written either way", () => {
    const redact = redactor(url);
    const text = `could not connect to ${url}: password p@ss-w0rd! and p%40ss-w0rd! rejected for postgres.abcdefgh`;
    const out = redact(text);
    for (const secret of [url, "p@ss-w0rd!", "p%40ss-w0rd!", "postgres.abcdefgh"]) expect(out).not.toContain(secret);
  });

  it("does not reach an error from a connection that fails", async () => {
    const db = connect("postgresql://someuser:hunter2hunter2@127.0.0.1:1/postgres");
    const err = await db.query("SELECT 1").then(
      () => undefined,
      (e: unknown) => e as Error,
    );
    expect(err).toBeInstanceOf(Error);
    expect(`${err!.message}\n${err!.stack}`).not.toContain("hunter2hunter2");
    await db.close();
  });

  it("is required, and the message names the variable", () => {
    expect(() => connectFromEnv({})).toThrow(/DATABASE_URL/);
    expect(() => connectFromEnv({ DATABASE_URL: "" })).toThrow(/Session pooler/);
  });
});
