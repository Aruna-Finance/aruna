import { describe, expect, it } from "vitest";
import { decodeBase64, parseImports } from "../src/wasm-imports.js";
import { HEADER, funcs, importSection, leb, moduleWith, section, toBase64 } from "./helpers/wasm-builder.js";

describe("parseImports", () => {
  it("lists function imports with their module", () => {
    const r = parseImports(moduleWith(funcs("input", "promise_batch_action_deploy_contract")));
    expect(r).toEqual({
      ok: true,
      imports: [
        { module: "env", name: "input", kind: "func" },
        { module: "env", name: "promise_batch_action_deploy_contract", kind: "func" },
      ],
    });
  });

  it("walks memory and global imports to reach the ones after them", () => {
    const r = parseImports(
      moduleWith([{ name: "memory", kind: "memory" }, { name: "g", kind: "global" }, { name: "panic" }]),
    );
    expect(r.ok && r.imports.map((i) => `${i.kind}:${i.name}`)).toEqual(["memory:memory", "global:g", "func:panic"]);
  });

  it("skips a custom section before the import section", () => {
    const r = parseImports(moduleWith(funcs("value_return"), { customFirst: true }));
    expect(r.ok && r.imports.map((i) => i.name)).toEqual(["value_return"]);
  });

  it("returns no imports for a module without an import section", () => {
    expect(parseImports(new Uint8Array(HEADER))).toEqual({ ok: true, imports: [] });
  });

  it("decodes UTF-8 names", () => {
    const r = parseImports(moduleWith([{ module: "envé", name: "naïve" }]));
    expect(r.ok && r.imports[0]).toEqual({ module: "envé", name: "naïve", kind: "func" });
  });

  it.each([
    ["empty input", new Uint8Array([])],
    ["wrong magic", new Uint8Array([0x00, 0x61, 0x73, 0x6e, 1, 0, 0, 0])],
    ["unsupported version", new Uint8Array([0x00, 0x61, 0x73, 0x6d, 2, 0, 0, 0])],
    ["truncated module", moduleWith(funcs("promise_batch_create")).slice(0, -3)],
    ["section size past the end", new Uint8Array([...HEADER, 2, ...leb(500), 1])],
    ["name length past the section", new Uint8Array([...HEADER, ...section(2, [1, ...leb(40), 0x65])])],
    ["unknown import kind", new Uint8Array([...HEADER, ...section(2, [1, 1, 0x65, 1, 0x66, 0x09])])],
    ["invalid UTF-8 in a name", new Uint8Array([...HEADER, ...section(2, [1, 1, 0xff, 1, 0x66, 0x00, 0])])],
    ["import entries shorter than the section", new Uint8Array([...HEADER, ...section(2, [...importSection(funcs("a")).slice(2), 0])])],
    ["two import sections", new Uint8Array([...moduleWith(funcs("a")), ...importSection(funcs("b"))])],
  ])("fails on %s", (_label, bytes) => {
    const r = parseImports(bytes);
    expect(r.ok).toBe(false);
  });
});

describe("decodeBase64", () => {
  it("round-trips bytes of every length modulo 3", () => {
    for (const len of [0, 1, 2, 3, 4, 5, 255]) {
      const bytes = new Uint8Array(len).map((_, i) => (i * 37) & 0xff);
      expect(decodeBase64(toBase64(bytes))).toEqual(bytes);
    }
  });

  it("rejects characters outside the alphabet", () => {
    expect(() => decodeBase64("AA*A")).toThrow();
  });
});
