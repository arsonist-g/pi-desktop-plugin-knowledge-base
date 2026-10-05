---
name: Knowledge base lookup
description: Look up a term, abbreviation, product name or internal process in the user's own knowledge base before answering. Use it when the user writes something that reads like a name only they would know, or asks what a term means.
---

# Knowledge base lookup

The user maintains a personal knowledge base of concepts, notes and internal
processes. It is the authority on their own vocabulary: an abbreviation, a
product codename, an in-house procedure, a term of art from their field.

## When to look it up

Call the knowledge-base search tool **before** answering when any of these is
true:

- The user uses a word or abbreviation that reads as a name rather than a normal
  noun — likely specific to them, their team, their project or their field.
- The user asks what something is, how something works, or how to do something
  in a domain they keep notes on.
- The user says "ours", "my", "our company", "our setup", or otherwise treats a
  piece of context as shared — you do not have it, but the knowledge base does.
- You are about to search the web for something that is more likely to be
  written down in the user's own notes than on the public internet.
- A term appears that you half-recognise from general knowledge but the user's
  usage does not quite match the general meaning.

Do **not** call it for general programming concepts, well-known libraries,
public standards, or anything you can answer without project-specific context.
A lookup costs a round trip; spend it where private context decides the answer.

## How to look it up

- The tool is the plugin tool `kb_search`. The host namespaces plugin tools, so
  the name the model sees is `plugin_<pluginId>_kb_search` — with the default
  plugin id that is `plugin_local_knowledge_base_kb_search`. If that exact name
  is not in the catalog, activate whichever entry for this plugin ends in
  `_kb_search` instead of assuming the bare name exists.
- Pass the term itself as `query`, in the language the user wrote it in. A
  short question works too when the term alone is ambiguous.
- Leave `mode` alone unless the first lookup comes back thin. Then try `naive`
  (fastest, vector-only) or `global`.
- One lookup per term. If a term comes back with nothing, do not retry it with
  different wording more than once.

## How to use the result

- Treat the returned `snippets` as the source of truth. They are the user's own
  documents, and they outrank your general knowledge for anything private.
- Cite the `source` file name when you rely on the knowledge base, so the user
  can check or fix the document.
- The `entities` and `relationships` come from the knowledge base's graph and
  help disambiguate, but the `snippets` carry the actual wording.
- If nothing matched, say so plainly and answer from general knowledge, marking
  clearly which part is general and which the knowledge base could not confirm.
  Never invent a definition and attribute it to the knowledge base.
- If the tool reports it is not configured or its key was rejected, tell the
  user the knowledge base is unreachable and continue without it — do not retry
  the same call repeatedly.
