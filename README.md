# 知识库检索 · PI-Desktop 插件

让 PI-Desktop 里的 Agent 能查你自己的知识库。

解决的问题很具体：你和 AI 说「cf 优选」「XX 方案」「我们那套部署流程」，模型没有这个概念，
于是它去网上搜，搜回来一堆过时的、AI 写的、互相抄错的文章。你把概念写成一篇文档放进知识库，
以后 AI 每次遇到这个词先去查你的文档，答案就是你写的那一份。

- 后端：自建 [LightRAG](https://github.com/HKUDS/LightRAG)（图谱 + 向量混合检索）
- 文档解析：可直接用 [mineru.net](https://mineru.net/) 云 API，PDF / 扫描件 / Office 都能转成 Markdown
- 插件只读知识库，不写入、不改动你的文件

## 里面有什么

| 文件 | 作用 |
| --- | --- |
| `manifest.json` | 插件清单：一个 Agent 工具 `kb_search` + 一份技能文档 |
| `main.js` | `kb_search` 的实现，POST 到 LightRAG 的 `/query/data` |
| `skills/knowledge-base.md` | 告诉模型什么时候该去查知识库、查到之后怎么用 |
| `server/` | LightRAG 服务端的 docker compose 与配置模板 |

## 一、先把服务端跑起来

服务端没有现成的公共实例，你需要自己部署一个（约 10 分钟）。完整说明见
[`server/README.md`](server/README.md)，要点：

```bash
cd server
cp .env.example .env    # 填 LLM / embedding / MinerU token
docker compose up -d
```

服务端需要三样外部依赖：

| 依赖 | 用途 | 说明 |
| --- | --- | --- |
| LLM（OpenAI 兼容） | 入库时抽实体、建图谱 | 便宜够用的模型即可，建议并发压到 2 |
| Embedding（OpenAI 兼容） | 向量检索 | `BAAI/bge-m3` 中文效果好，1024 维 |
| MinerU token | PDF / 图片 / Office 解析 | 可留空，只是 PDF 会退化成纯文本抽取 |

部署完成后打开 `https://你的域名/webui/`，用 API Key 登录，上传文档即可。
Markdown 直接入库；PDF 交给 MinerU 转 Markdown 再入库。

## 二、装插件

PI-Desktop → 侧边栏 **插件** → 右上角菜单 **从本地目录安装** → 选这个仓库目录。

安装时会要求授权四项权限，逐条说明：

| 权限 | 为什么需要 |
| --- | --- |
| `agent.tool.register` | 注册 `kb_search` 工具 |
| `agent.prompt.inject` | 注入技能目录，让模型知道有这个工具、什么时候用 |
| `net.fetch` | 请求你的 LightRAG 服务 |
| `net.anyHost` | 服务地址由你自己填，清单里写不死 |

`net.anyHost` 是因为服务端地址是你自己输入的——任何提前写好的域名白名单都不可能猜中。
它放行 http(s) 出站，但云厂商的元数据地址（169.254.169.254 一类）永远不放行。

## 三、配置

**插件 → 知识库检索 → 设置**：

| 设置项 | 填什么 |
| --- | --- |
| LightRAG 服务地址 | `https://kb.example.com`，不带结尾斜杠 |
| LightRAG API Key | 服务端 `.env` 里的 `LIGHTRAG_API_KEY` |
| 默认检索模式 | `mix`（图谱 + 向量，默认）／`naive`（纯向量，最快） |
| 默认召回条数 | 默认 10 |
| 单条片段字符上限 | 默认 2000，避免一次塞满上下文 |

API Key 存在插件的私有设置文件里（`<应用数据目录>/plugins/data/local.knowledge-base/`），
不会进版本库。稳妥起见，可以给 PI-Desktop 单独用一个只读用途的 Key。

## 四、用起来

正常说话就行——模型会自己判断要不要查：

```text
你：cf 优选是怎么做的来着？
（模型调用 kb_search("cf 优选")，拿到你写的那篇文档，再回答）
```

也可以直接点名：

```text
你：查一下知识库里「灰度发布流程」
```

判断「该不该查」的规则写在 `skills/knowledge-base.md` 里，不满意可以直接改这个文件——
技能文档是模型读的提示词，不是代码。

## 五、排错

| 现象 | 原因 |
| --- | --- |
| 工具回「知识库还没配置」 | 设置里服务地址是空的 |
| 工具回 HTTP 401/403 | API Key 和服务端 `LIGHTRAG_API_KEY` 不一致 |
| 工具回「没有命中内容」 | 文档还没入库，或换个说法 |
| 连不上 | 从这台电脑 `curl https://你的域名/health` 试一下 |

## 许可

MIT
