// Contrast audit for ui/ — requires playwright installed in the repo root.
// Usage: node ui/cek-kontras.cjs http://127.0.0.1:5173
const { chromium } = require("playwright");

const URL = process.argv[2] || "http://127.0.0.1:5173";

const scan = () => {
  const lum = (rgb) => {
    const m = rgb.map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2];
  };
  const parse = (s) => {
    const m = String(s).match(/[\d.]+/g);
    return m ? m.map(Number) : null;
  };
  const bgOf = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && (c.length < 4 || c[3] > 0.9)) return c;
      n = n.parentElement;
    }
    return parse(getComputedStyle(document.body).backgroundColor);
  };
  const ratio = (f, b) => {
    const [x, y] = [lum(f), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  const out = [];
  document.querySelectorAll("body *").forEach((el) => {
    if (!Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim())) return;
    const t = (el.textContent || "").trim();
    if (!t || t.length > 60) return;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") return;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const f = parse(cs.color);
    if (!f) return;
    const b = bgOf(el);
    const cr = ratio(f, b);
    // WCAG: large text (>=24px, or >=18.66px bold) only needs 3:1
    const px = parseFloat(cs.fontSize);
    const min = px >= 24 || (px >= 18.66 && parseInt(cs.fontWeight, 10) >= 700) ? 3 : 4.5;
    if (cr < min)
      out.push({
        sel: el.tagName.toLowerCase() + (typeof el.className === "string" && el.className ? "." + el.className.split(" ").filter(Boolean).join(".") : ""),
        text: t.slice(0, 28),
        fg: cs.color,
        bg: `rgb(${b.slice(0, 3)})`,
        ratio: Math.round(cr * 100) / 100,
      });
  });
  out.sort((a, b) => a.ratio - b.ratio);
  return out;
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ colorScheme: "light" });
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(URL, { waitUntil: "load" });

  const report = {};
  report.light = await page.evaluate(scan);
  await page.click("#themeBtn");
  for (const view of ["overview", "runs", "failures", "projects"]) {
    await page.click(`[data-view=${view}]`);
    report[`dark:${view}`] = await page.evaluate(scan);
  }
  await page.click("[data-view=overview]");
  await page.evaluate(() => document.querySelector("#recentRuns tr")?.click());
  report["dark:drawer"] = await page.evaluate(scan);

  const total = Object.values(report).reduce((n, rows) => n + rows.length, 0);
  console.log(JSON.stringify({ url: URL, errs, offenders: total, report }, null, 1));
  await browser.close();
  process.exit(total === 0 && errs.length === 0 ? 0 : 1);
})().catch((e) => {
  console.error("FAIL", e.message);
  process.exit(2);
});
