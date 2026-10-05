/**
 * Runs `kb_search` once against a real LightRAG server, outside PI-Desktop.
 *
 * The unit tests cover the tool's mapping and error paths against a stub; this
 * is the one that proves the server, the key and the network path actually work
 * together. It loads `main.js` with a stand-in `pi` object, so it exercises the
 * shipped code rather than a copy of it.
 *
 * Usage:
 *   KB_URL=https://kb.example.com KB_KEY=... node scripts/live-check.mjs cf优选
 */

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const url = process.env.KB_URL;
const key = process.env.KB_KEY;
if (!url || !key) {
  console.error("set KB_URL and KB_KEY first, e.g.");
  console.error("  KB_URL=https://kb.example.com KB_KEY=... node scripts/live-check.mjs cf优选");
  process.exit(2);
}

let tool;
globalThis.pi = {
  plugin: {
    getSettings: async () => ({ serverUrl: url, apiKey: key, mode: "mix", topK: 10, snippetChars: 600 }),
  },
  net: {
    fetch: async ({ url: target, method, headers, body }) => {
      const response = await fetch(target, { method, headers, body });
      return { status: response.status, headers: {}, bodyText: await response.text() };
    },
  },
  agent: {
    registerTool: async (registered) => {
      tool = registered;
    },
    unregisterTool: async () => {},
  },
};

await require(join(here, "..", "main.js")).onLoad();

const query = process.argv.slice(2).join(" ") || "test";
const started = Date.now();
const result = await tool.execute({ query });
const elapsed = Date.now() - started;

console.log(`query:   ${query}`);
console.log(`elapsed: ${elapsed} ms`);
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
