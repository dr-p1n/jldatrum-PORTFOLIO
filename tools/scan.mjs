#!/usr/bin/env node
/* One URL in, one row out. The address is the only thing typed.
 *
 *   node tools/scan.mjs https://example.com/
 *   node tools/scan.mjs https://example.com/ --lang es --json
 *   node tools/scan.mjs --file prospects.txt        # one URL per line
 *
 * The operator key makes the worker write the row to the prospect sheet. Keep
 * it out of the shell history — export it once, in a file the repo ignores:
 *   export DATRUM_OP="…"
 * Without it the scans still run and nothing is logged.
 */
const ENDPOINT = process.env.DATRUM_ENDPOINT || "https://ai-visibility.julioernestolv.workers.dev";
const OP = process.env.DATRUM_OP || "";

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i < 0 ? d : argv[i + 1]; };
const has = n => argv.includes(n);
const lang = flag("--lang", "en");
const urls = has("--file")
  ? (await import("node:fs")).readFileSync(flag("--file"), "utf8")
      .split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith("#"))
  : argv.filter(a => !a.startsWith("--") && a !== lang && a !== flag("--file"));

if (!urls.length) {
  console.error("usage: node tools/scan.mjs <url> [--lang es] [--json] [--file list.txt]");
  process.exit(2);
}

// ⚠️ THE URL MUST CARRY A SCHEME — the worker answers 400 without one, and
// that 400 has been misread as a worker bug before now.
const withScheme = u => /^https?:\/\//i.test(u) ? u : "https://" + u;

const pad = (s, n) => String(s).padEnd(n);
const line = (label, r) => {
  if (!r || r.error) return `  ${pad(label, 8)} —      ${r?.error ? r.error.slice(0, 68) : "no result"}`;
  const gaps = (r.checks || []).filter(c => !c.pass && !c.na)
    .sort((a, b) => b.deduction - a.deduction).slice(0, 3).map(c => c.title);
  return `  ${pad(label, 8)} ${pad(r.score + "/100", 8)} ${pad(r.grade, 3)}\n`
       + gaps.map(g => `           · ${g}`).join("\n") || "";
};

let failed = 0;
for (const raw of urls) {
  const url = withScheme(raw);
  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Origin": "https://jldatrum.com" },
      body: JSON.stringify({ url, lang, mode: "all", ...(OP ? { op: OP } : {}) }),
    }).then(r => r.json());
  } catch (e) { console.error(`${url}\n  request failed: ${e.message}`); failed++; continue; }

  if (has("--json")) { console.log(JSON.stringify(res)); continue; }
  if (res.error) { console.log(`\n${url}\n  ${res.error.slice(0, 90)}`); failed++; continue; }
  console.log(`\n${url}${OP ? "" : "   (not logged — DATRUM_OP unset)"}`);
  console.log(line("AI", res.visibility));
  console.log(line("Trust", res.trust));
  console.log(line("Radar", res.responsive));
}
process.exit(failed && failed === urls.length ? 1 : 0);
