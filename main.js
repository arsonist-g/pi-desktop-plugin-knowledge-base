/**
 * Knowledge-base tool for PI-Desktop.
 *
 * One agent tool, `kb_search`, posted at a self-hosted LightRAG server. The
 * retrieval endpoint is `/query/data`, which returns the retrieved entities and
 * chunks without asking the server to write an answer: the model already is the
 * one that reasons, and a second LLM round trip would only add latency and lose
 * the source text.
 *
 * Ingestion is deliberately out of scope. Documents go in through the server's
 * own WebUI (where it can parse a PDF with MinerU), so this plugin never writes
 * to the knowledge base and needs no write-side permission.
 */

const REQUEST_TIMEOUT_MS = 90_000;
const MAX_TOP_K = 100;
const DEFAULT_SNIPPETS = 8;
const DEFAULT_ENTITIES = 12;
const MODES = new Set(["mix", "naive", "local", "global", "hybrid"]);

const NOT_CONFIGURED =
  "知识库还没配置：打开 插件 → 知识库检索 → 设置，填 LightRAG 服务地址和 API Key。";

function normalizeBase(settings) {
  return String(settings?.serverUrl ?? "")
    .trim()
    .replace(/\/+$/, "");
}

function positiveNumber(value, fallback, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

function truncate(text, limit) {
  const value = String(text ?? "");
  if (!limit || value.length <= limit) return value;
  return `${value.slice(0, limit)}…（已截断，共 ${value.length} 字）`;
}

function describeError(error) {
  const code = error?.code ? `${error.code}: ` : "";
  return `${code}${error?.message ?? String(error)}`;
}

function formatPayload(payload, snippetChars) {
  const data = payload?.data ?? {};
  const snippets = (data.chunks ?? []).slice(0, DEFAULT_SNIPPETS).map((chunk) => ({
    source: chunk.file_path ?? chunk.reference_id ?? "unknown",
    content: truncate(chunk.content, snippetChars),
  }));
  const entities = (data.entities ?? []).slice(0, DEFAULT_ENTITIES).map((entity) => ({
    name: entity.entity_name,
    type: entity.entity_type,
    description: truncate(entity.description, 300),
    source: entity.file_path,
  }));
  const relationships = (data.relationships ?? []).slice(0, DEFAULT_ENTITIES).map((relation) => ({
    from: relation.src_id,
    to: relation.tgt_id,
    description: truncate(relation.description, 300),
  }));
  return { snippets, entities, relationships };
}

async function onLoad() {
  await pi.agent.registerTool({
    name: "kb_search",
    description:
      "Search the user's personal knowledge base (a self-hosted LightRAG server) for a term, concept or internal note.",
    risk: "low",
    schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        mode: { type: "string", enum: [...MODES] },
        topK: { type: "number" },
      },
      required: ["query"],
    },
    execute: async (args) => {
      const settings = await pi.plugin.getSettings();
      const base = normalizeBase(settings);
      if (!base) return { ok: false, error: NOT_CONFIGURED };

      const query = String(args?.query ?? "").trim();
      if (!query) return { ok: false, error: "query is required" };

      const mode = MODES.has(String(args?.mode)) ? String(args.mode) : String(settings.mode ?? "mix");
      const topK = positiveNumber(args?.topK ?? settings.topK, 10, MAX_TOP_K);
      const snippetChars = Math.max(0, Number(settings.snippetChars ?? 2000) || 0);

      let response;
      try {
        response = await pi.net.fetch({
          url: `${base}/query/data`,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": String(settings.apiKey ?? ""),
          },
          body: JSON.stringify({ query, mode, top_k: topK, include_chunk_content: true }),
          timeoutMs: REQUEST_TIMEOUT_MS,
        });
      } catch (error) {
        return { ok: false, query, error: `连不上知识库：${describeError(error)}` };
      }

      if (response.status === 401 || response.status === 403) {
        return {
          ok: false,
          query,
          error: `知识库拒绝了这次请求（HTTP ${response.status}）：检查设置里的 API Key 是否和服务端 LIGHTRAG_API_KEY 一致。`,
        };
      }
      if (response.status >= 400) {
        return {
          ok: false,
          query,
          error: `知识库返回 HTTP ${response.status}：${truncate(response.bodyText, 300)}`,
        };
      }

      let payload;
      try {
        payload = JSON.parse(response.bodyText);
      } catch {
        return { ok: false, query, error: "知识库返回的不是合法 JSON。" };
      }
      if (payload?.status === "failure") {
        return { ok: false, query, error: `检索失败：${payload.message ?? "unknown"}` };
      }

      const { snippets, entities, relationships } = formatPayload(payload, snippetChars);
      return {
        ok: true,
        query,
        mode,
        hitCount: snippets.length,
        snippets,
        entities,
        relationships,
        note: snippets.length
          ? undefined
          : "知识库里没有命中内容。可能是文档还没入库，或者换一个说法再试。",
      };
    },
  });
}

async function onUnload() {
  await pi.agent.unregisterTool("kb_search");
}

module.exports = { onLoad, onUnload };
