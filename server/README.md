# LightRAG 服务端

给 `kb_search` 工具用的检索后端。单容器、内嵌存储（JSON KV + NanoVectorDB + NetworkX），
不需要 Elasticsearch / Milvus / Postgres。

## 依赖

| 依赖 | 必需 | 说明 |
| --- | --- | --- |
| LLM（OpenAI 兼容） | 是 | 入库时抽实体建图谱，查询时也可能用到。便宜够用的模型即可 |
| Embedding（OpenAI 兼容） | 是 | 建议 `BAAI/bge-m3`，1024 维，中文表现好 |
| MinerU API Token | 否 | 有它才能解析 PDF / 图片 / Office；没有则这些格式退化成纯文本抽取 |

## 起服务

```bash
cp .env.example .env
# 编辑 .env：至少填 LLM_*、EMBEDDING_*、LIGHTRAG_API_KEY
docker compose up -d
docker compose logs -f lightrag
```

启动成功的标志是日志里出现：

```text
INFO: Role LLM Configuration (initialized):
INFO:  - extract: openai/<你的模型>, host=<你的地址>, max_async=2
INFO: Application startup complete.
INFO: Uvicorn running on http://0.0.0.0:9621
```

## 验证

```bash
# 健康检查（不需要鉴权）
curl -s http://127.0.0.1:9621/health

# 鉴权是否生效：无 key 应当返回 403
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:9621/documents/supported_file_types
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "X-API-Key: $LIGHTRAG_API_KEY" \
  http://127.0.0.1:9621/documents/supported_file_types
```

`/documents/supported_file_types` 还会告诉你解析路由实际解析成了什么，
比如 `"mineru"` 下面应当出现 `.pdf`、`.png`、`.docx` 等——如果 mineru 那一栏是空的，
说明 `MINERU_API_TOKEN` 没配对，MinerU 规则被跳过了。

## 入库

浏览器打开 `http://127.0.0.1:9621/webui/`，用 `LIGHTRAG_API_KEY` 登录，上传文档。

也可以走接口：

```bash
curl -X POST http://127.0.0.1:9621/documents/text \
  -H "X-API-Key: $LIGHTRAG_API_KEY" -H "Content-Type: application/json" \
  -d '{"text":"# 标题\n\n正文……","file_source":"my-note.md"}'
```

## 解析路由

`LIGHTRAG_PARSER` 决定哪个后缀交给哪个引擎，从左往右匹配，第一条能用的生效：

```text
LIGHTRAG_PARSER=*:native-iteP,*:mineru-iteP,*:legacy-R
```

- `native`：LightRAG 自带的本地解析器，支持 `.docx` / `.md` / `.textpack`，不依赖外部服务
- `mineru`：调 mineru.net 云 API，支持 `.pdf` `.docx` `.pptx` `.xlsx` 和图片
- `legacy`：兜底，只抽纯文本

`-iteP` 是处理选项：`i` 图片、`t` 表格、`e` 公式，`P` 是按标题结构切块。
`mineru` 规则在 token 没配时会被自动跳过，落到下一条，所以不配 MinerU 也能正常跑。

## 安全

服务只监听 `127.0.0.1`。要对外提供访问，用反向代理加 TLS，**不要**直接把 9621 暴露到公网——
`LIGHTRAG_API_KEY` 是唯一的门锁，而健康检查等端点不需要鉴权。

反代要点：

- `proxy_read_timeout` / `proxy_send_timeout` 给足（入库和查询要等 LLM，可能几分钟）
- 关掉 `proxy_buffering`，否则查询输出不会流式返回
- 放行 WebSocket 升级头，WebUI 会用到

## 数据在哪

`./data/rag_storage`（图谱与向量）和 `./data/inputs`（上传的原件）。
这两个目录就是全部状态，备份它们即可。
