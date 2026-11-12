import { defineConfig } from "vitest/config";

// Each test file boots a Postgres (PGlite) of its own, about a second, and several files boot at once.
export default defineConfig({ test: { testTimeout: 30_000, hookTimeout: 30_000 } });
