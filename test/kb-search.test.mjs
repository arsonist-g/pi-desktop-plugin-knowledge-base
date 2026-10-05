/**
 * Exercises the real `kb_search` implementation against a stub LightRAG server,
 * so the tool's mapping and its error paths are covered without needing a
 * deployed knowledge base.
 *
 * Run with: npm test
 */

import { createServer } from "node:http";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

const require = createRequire(import.meta.url);

/** Settings the stub `pi.plugin.getSettings` returns; each test sets its own. */
let settings = {};
/** The tool `onLoad` registered, i.e. the object under test. */
let tool;
/** Requests the stub server saw, newest last. */
let seen = [];

const server = createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => {
    body += chunk;
  });
  request.on("end", () => {
    seen.push({ url: request.url, headers: request.headers, body: JSON.parse(body || "{}") });
    if (settings.respond) {
      response.writeHead(settings.respond.status, { "Content-Type": "application/json" });
      response.end(settings.respond.body);
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        status: "success",
        data: {
          entities: [
            { entity_name: "CF优选", entity_type: "method", description: "一种加速做法", file_path: "cf.md" },
          ],
          relationships: [{ src_id: "CF优选", tgt_id: "Cloudflare", description: "作用于", weight: 1 }],
          chunks: [{ reference_id: "1", content: "# CF 优选\n\n正文", file_path: "cf.md" }],
        },
      }),
    );
  });
});

let origin;

before(async () => {
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

beforeEach(async () => {
  seen = [];
  settings = {
    serverUrl: origin,
    apiKey: "test-key",
    mode: "mix",
    topK: 10,
    snippetChars: 2000,
    respond: undefined,
  };
  tool = undefined;
  globalThis.pi = {
    plugin: { getSettings: async () => settings },
    net: {
      fetch: async ({ url, method, headers, body }) => {
        const response = await fetch(url, { method, headers, body });
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
  // Fresh module instance per test: onLoad registers the tool we assert on.
  delete require.cache[require.resolve("../main.js")];
  await require("../main.js").onLoad();
});

test("registers one low-risk tool with a required query argument", () => {
  assert.equal(tool.name, "kb_search");
  assert.equal(tool.risk, "low");
  assert.deepEqual(tool.schema.required, ["query"]);
});

test("posts the query to /query/data and maps the response", async () => {
  const result = await tool.execute({ query: "cf优选" });
  assert.equal(result.ok, true);
  assert.equal(result.hitCount, 1);
  assert.deepEqual(result.snippets, [{ source: "cf.md", content: "# CF 优选\n\n正文" }]);
  assert.equal(result.entities[0].name, "CF优选");
  assert.equal(result.relationships[0].from, "CF优选");

  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, "/query/data");
  assert.equal(seen[0].headers["x-api-key"], "test-key");
  assert.equal(seen[0].body.mode, "mix");
  assert.equal(seen[0].body.top_k, 10);
  assert.equal(seen[0].body.include_chunk_content, true);
});

test("an unconfigured server is reported, not attempted", async () => {
  settings.serverUrl = "  ";
  const result = await tool.execute({ query: "cf优选" });
  assert.equal(result.ok, false);
  assert.match(result.error, /还没配置/);
  assert.equal(seen.length, 0);
});

test("a rejected key explains which setting to check", async () => {
  settings.respond = { status: 403, body: JSON.stringify({ detail: "invalid api key" }) };
  const result = await tool.execute({ query: "cf优选" });
  assert.equal(result.ok, false);
  assert.match(result.error, /403/);
  assert.match(result.error, /API Key/);
});

test("an unreachable server reports the transport error", async () => {
  settings.serverUrl = "http://127.0.0.1:1";
  const result = await tool.execute({ query: "cf优选" });
  assert.equal(result.ok, false);
  assert.match(result.error, /连不上知识库/);
});

test("a caller-supplied mode and topK override the settings", async () => {
  await tool.execute({ query: "cf优选", mode: "naive", topK: 3 });
  assert.equal(seen[0].body.mode, "naive");
  assert.equal(seen[0].body.top_k, 3);
});

test("an unknown mode falls back to the configured default", async () => {
  await tool.execute({ query: "cf优选", mode: "nonsense" });
  assert.equal(seen[0].body.mode, "mix");
});

test("snippetChars truncates long chunks and says so", async () => {
  settings.snippetChars = 4;
  const result = await tool.execute({ query: "cf优选" });
  assert.match(result.snippets[0].content, /^# CF…/);
  assert.match(result.snippets[0].content, /已截断/);
});

test("an empty result says the knowledge base had nothing, without erroring", async () => {
  settings.respond = { status: 200, body: JSON.stringify({ status: "success", data: {} }) };
  const result = await tool.execute({ query: "cf优选" });
  assert.equal(result.ok, true);
  assert.equal(result.hitCount, 0);
  assert.match(result.note, /没有命中内容/);
});

test("a failure status from the server surfaces its message", async () => {
  settings.respond = { status: 200, body: JSON.stringify({ status: "failure", message: "graph empty" }) };
  const result = await tool.execute({ query: "cf优选" });
  assert.equal(result.ok, false);
  assert.match(result.error, /graph empty/);
});

test("an empty query is refused before any request", async () => {
  const result = await tool.execute({ query: "   " });
  assert.equal(result.ok, false);
  assert.equal(seen.length, 0);
});
