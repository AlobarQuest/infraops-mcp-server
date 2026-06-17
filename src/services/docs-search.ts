/**
 * Coolify documentation search (BM25 over the official docs).
 *
 * Lazily fetches `https://coolify.io/docs/llms-full.txt` on first use, parses it into
 * page/section chunks, and indexes them with MiniSearch. The index is cached in memory
 * for the process lifetime (no TTL). Mirrors the approach used by @masonator/coolify-mcp.
 *
 * Instance-agnostic: the docs are global, so this has no Coolify instance/token dependency.
 */

import axios from "axios";
import MiniSearch from "minisearch";

const DOCS_URL = "https://coolify.io/docs/llms-full.txt";
const FETCH_TIMEOUT_MS = 15000;

interface DocChunk {
  id: number;
  title: string;
  url: string;
  description: string;
  content: string;
}

export interface DocSearchResult {
  title: string;
  url: string;
  description: string;
  snippet: string;
  score: number;
}

let indexPromise: Promise<MiniSearch<DocChunk>> | null = null;

const DOCS_BASE = "https://coolify.io";

/**
 * Parse the llms-full.txt corpus into searchable chunks.
 *
 * Real format (no YAML frontmatter): each doc page begins with an H1 whose text
 * embeds the path, e.g. `# Docker Compose Build Packs (/docs/applications/build-packs/docker-compose)`.
 * Within a page, sections are plain lines ending in an anchor, e.g. `How It Works? [#how-it-works]`.
 * We chunk per section (carrying the page title + url#anchor) for relevance and correct attribution.
 */
function parseDocs(raw: string): DocChunk[] {
  const chunks: DocChunk[] = [];
  let id = 0;

  // Page boundaries: an H1 line whose heading ends with a parenthesised "/path".
  const pageHeader = /^#[ \t]+(.+?)[ \t]+\((\/[^)]+)\)[ \t]*$/gm;
  const headers: { title: string; path: string; start: number; bodyStart: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = pageHeader.exec(raw)) !== null) {
    headers.push({ title: m[1].trim(), path: m[2].trim(), start: m.index, bodyStart: pageHeader.lastIndex });
  }

  const pushChunk = (title: string, url: string, content: string) => {
    const trimmed = content.trim();
    if (trimmed.length >= 20) chunks.push({ id: id++, title, url, description: "", content: trimmed });
  };

  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    const bodyEnd = i + 1 < headers.length ? headers[i + 1].start : raw.length;
    const body = raw.slice(h.bodyStart, bodyEnd);
    const url = DOCS_BASE + h.path;

    // Section markers: a line of the form "Section Name [#anchor]".
    const sectionRe = /^(.+?)[ \t]+\[#([^\]]+)\][ \t]*$/gm;
    const markers: { name: string; anchor: string; index: number }[] = [];
    let s: RegExpExecArray | null;
    while ((s = sectionRe.exec(body)) !== null) {
      markers.push({ name: s[1].trim(), anchor: s[2], index: s.index });
    }

    if (markers.length === 0) {
      pushChunk(h.title, url, body);
      continue;
    }
    for (let j = 0; j < markers.length; j++) {
      const segEnd = j + 1 < markers.length ? markers[j + 1].index : body.length;
      pushChunk(
        `${h.title} > ${markers[j].name}`,
        `${url}#${markers[j].anchor}`,
        body.slice(markers[j].index, segEnd)
      );
    }
  }
  return chunks;
}

async function buildIndex(): Promise<MiniSearch<DocChunk>> {
  const resp = await axios.get<string>(DOCS_URL, {
    timeout: FETCH_TIMEOUT_MS,
    responseType: "text",
    transformResponse: [(d) => d],
  });
  const chunks = parseDocs(resp.data);
  const mini = new MiniSearch<DocChunk>({
    fields: ["title", "description", "content"],
    storeFields: ["title", "url", "description", "content"],
    searchOptions: {
      boost: { title: 3, description: 2, content: 1 },
      prefix: true,
      fuzzy: 0.2,
    },
  });
  mini.addAll(chunks);
  return mini;
}

/** Extract a ~300-char window around the best run of query terms. */
function extractSnippet(content: string, query: string, windowSize = 300): string {
  const text = content.replace(/\s+/g, " ").trim();
  if (text.length <= windowSize) return text;
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const lower = text.toLowerCase();
  let best = 0;
  let bestScore = -1;
  for (let i = 0; i < text.length; i += 50) {
    const win = lower.slice(i, i + windowSize);
    const score = terms.reduce((n, t) => n + (win.includes(t) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  let snippet = text.slice(best, best + windowSize);
  if (best > 0) snippet = "..." + snippet;
  if (best + windowSize < text.length) snippet = snippet + "...";
  return snippet;
}

/** Search the cached docs index, building it lazily on first call. */
export async function searchDocs(query: string, limit = 5): Promise<DocSearchResult[]> {
  if (!indexPromise) {
    indexPromise = buildIndex().catch((err) => {
      indexPromise = null; // allow retry on transient fetch failure
      throw err;
    });
  }
  const mini = await indexPromise;
  const results = mini.search(query).slice(0, limit);
  return results.map((r: any) => ({
    title: r.title,
    url: r.url,
    description: r.description,
    snippet: extractSnippet(r.content ?? "", query),
    score: Math.round(r.score * 100) / 100,
  }));
}
