// Penanda tool pakai logo asli. Kedua PNG sudah di-crop rapat ke konten
// dan dipad persegi, jadi cukup samakan height supaya bobot optiknya sama.
export function ToolMark({ tool, inline = false }: { tool: "pw" | "lh" | "both"; inline?: boolean }) {
  const cls = `pb-tool ${tool}${inline ? " inline" : ""}`;
  if (tool === "both") {
    return (
      <span className={cls} title="Playwright + Lighthouse">
        <img src="/tools/playwright.png" alt="Playwright" />
        <img src="/tools/lighthouse.png" alt="Lighthouse" />
      </span>
    );
  }
  const lh = tool === "lh";
  return (
    <span className={cls}>
      <img src={lh ? "/tools/lighthouse.png" : "/tools/playwright.png"} alt={lh ? "Lighthouse" : "Playwright"} />
    </span>
  );
}
