import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Same "@/" alias as tsconfig.json, so a test can render a component that uses it.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
});
