export function renderWindowMarkdown(generatedAt, s) {
    const lines = [];
    lines.push(`# Change Window — ${generatedAt}`);
    lines.push("");
    lines.push(`**${s.applied} applied**, ${s.blocked} blocked, ${s.failed} failed, ${s.skipped} skipped (of ${s.considered} considered).`);
    lines.push("");
    if (!s.results.length) {
        lines.push("_No approved changes this window._");
        return lines.join("\n");
    }
    for (const r of s.results) {
        const icon = r.outcome === "done" ? "✅"
            : r.outcome === "blocked" ? "⏸️"
                : r.outcome.startsWith("skipped") ? "⏭️"
                    : "❌";
        lines.push(`- ${icon} **${r.name}** — ${r.outcome}: ${r.detail}`);
    }
    lines.push("");
    return lines.join("\n");
}
//# sourceMappingURL=window-report.js.map