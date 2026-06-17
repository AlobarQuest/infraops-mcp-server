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
let indexPromise = null;
/** Parse the llms-full.txt corpus into searchable chunks. */
function parseDocs(raw) {
    const chunks = [];
    let id = 0;
    // Pages are separated by a blank-line-padded horizontal rule run.
    const pages = raw.split(/\n---\n\n---\n/);
    for (const page of pages) {
        // Frontmatter: leading `url:` / `description:` lines, then `---`, then body.
        let url = "";
        let description = "";
        let title = "";
        let body = page;
        const fmMatch = page.match(/^([\s\S]*?)\n---\n([\s\S]*)$/);
        if (fmMatch) {
            const front = fmMatch[1];
            body = fmMatch[2];
            const urlM = front.match(/^url:\s*(.+)$/m);
            const descM = front.match(/^description:\s*(.+)$/m);
            const titleM = front.match(/^title:\s*(.+)$/m);
            if (urlM)
                url = urlM[1].trim();
            if (descM)
                description = descM[1].trim();
            if (titleM)
                title = titleM[1].trim();
        }
        if (!title) {
            const h1 = body.match(/^#\s+(.+)$/m);
            title = h1 ? h1[1].trim() : url || "Coolify Docs";
        }
        // Sub-split the body on `## ` section headers so results land on a section.
        const sections = body.split(/\n(?=##\s)/);
        for (const section of sections) {
            const content = section.trim();
            if (content.length < 20)
                continue;
            const headerM = section.match(/^##\s+(.+)$/m);
            const sectionTitle = headerM ? `${title} > ${headerM[1].trim()}` : title;
            chunks.push({ id: id++, title: sectionTitle, url, description, content });
        }
    }
    return chunks;
}
async function buildIndex() {
    const resp = await axios.get(DOCS_URL, {
        timeout: FETCH_TIMEOUT_MS,
        responseType: "text",
        transformResponse: [(d) => d],
    });
    const chunks = parseDocs(resp.data);
    const mini = new MiniSearch({
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
function extractSnippet(content, query, windowSize = 300) {
    const text = content.replace(/\s+/g, " ").trim();
    if (text.length <= windowSize)
        return text;
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
    if (best > 0)
        snippet = "..." + snippet;
    if (best + windowSize < text.length)
        snippet = snippet + "...";
    return snippet;
}
/** Search the cached docs index, building it lazily on first call. */
export async function searchDocs(query, limit = 5) {
    if (!indexPromise) {
        indexPromise = buildIndex().catch((err) => {
            indexPromise = null; // allow retry on transient fetch failure
            throw err;
        });
    }
    const mini = await indexPromise;
    const results = mini.search(query).slice(0, limit);
    return results.map((r) => ({
        title: r.title,
        url: r.url,
        description: r.description,
        snippet: extractSnippet(r.content ?? "", query),
        score: Math.round(r.score * 100) / 100,
    }));
}
//# sourceMappingURL=docs-search.js.map