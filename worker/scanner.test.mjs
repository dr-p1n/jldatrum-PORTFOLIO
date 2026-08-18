/* Tests for the pure logic in ai-visibility-scanner.js.
   No Workers runtime needed — we strip the default export and import the rest.
   Run:  node worker/scanner.test.mjs                                        */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const srcPath = path.join(here, "ai-visibility-scanner.js");
const tmpPath = path.join(here, ".scanner.undertest.mjs");

let src = fs.readFileSync(srcPath, "utf8");
src = src.slice(0, src.indexOf("export default"));
src += "\nexport { parseRobots, blocksAgent, grade, validateTarget, isPrivateHost, AI_CRAWLERS };";
fs.writeFileSync(tmpPath, src);
const M = await import(tmpPath);
fs.unlinkSync(tmpPath);

let pass = 0, fail = 0;
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${ok ? "" : `   got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
};
const g = s => M.parseRobots(s);

console.log("robots.txt");
t("Disallow:/ blocks",              M.blocksAgent(g("User-agent: *\nDisallow: /"), "GPTBot"), true);
t("Allow:/ permits",                M.blocksAgent(g("User-agent: *\nAllow: /"), "GPTBot"), false);
t("empty Disallow permits",         M.blocksAgent(g("User-agent: *\nDisallow:"), "GPTBot"), false);
t("no rules permits",               M.blocksAgent(g(""), "GPTBot"), false);
t("named group beats wildcard",     M.blocksAgent(g("User-agent: *\nAllow: /\n\nUser-agent: GPTBot\nDisallow: /"), "GPTBot"), true);
t("...and spares other agents",     M.blocksAgent(g("User-agent: *\nAllow: /\n\nUser-agent: GPTBot\nDisallow: /"), "ClaudeBot"), false);
t("user-agent is case-insensitive", M.blocksAgent(g("User-agent: gptbot\nDisallow: /"), "GPTBot"), true);
t("comments stripped",              M.blocksAgent(g("# x\nUser-agent: *\nDisallow: / # y"), "GPTBot"), true);
t("path rule misses root",          M.blocksAgent(g("User-agent: *\nDisallow: /admin"), "GPTBot", "/"), false);
t("path rule hits its subtree",     M.blocksAgent(g("User-agent: *\nDisallow: /admin"), "GPTBot", "/admin/x"), true);
t("longer Allow beats Disallow",    M.blocksAgent(g("User-agent: *\nDisallow: /\nAllow: /public"), "GPTBot", "/public/a"), false);

console.log("\nour own robots.txt lets every listed crawler through");
const ours = M.parseRobots(fs.readFileSync(path.join(here, "..", "robots.txt"), "utf8"));
for (const b of M.AI_CRAWLERS) t(b.ua, M.blocksAgent(ours, b.ua, "/"), false);

console.log("\ngrade bands");
for (const [s, e] of [[100,"A+"],[95,"A"],[86,"A-"],[80,"B+"],[70,"B"],[66,"B-"],
                      [60,"C+"],[50,"C"],[45,"C-"],[40,"D+"],[30,"D"],[25,"D-"],[10,"F"],[0,"F"]])
  t(`${s} -> ${e}`, M.grade(s), e);

console.log("\nSSRF: must reject");
for (const u of ["http://localhost/","http://127.0.0.1/","http://127.1.2.3/","https://192.168.1.1/",
  "https://10.0.0.5/","https://172.16.0.1/","https://172.31.255.254/","https://169.254.169.254/",
  "https://100.64.0.1/","https://0.0.0.0/","https://[::1]/","https://[fd00::1]/","https://[fe80::1]/",
  "https://239.1.1.1/","file:///etc/passwd","ftp://x.com/","https://foo.internal/","https://box.lan/",
  "https://a.local/","https://user:pw@evil.com/","not a url","https://nodot","https://999.1.1.1/"])
  t(u, !!M.validateTarget(u).error, true);

console.log("\nSSRF: must accept");
for (const u of ["https://jldatrum.com/","https://example.com/a/b?c=1","http://sub.domain.co.uk/",
                 "https://172.15.0.1/","https://172.32.0.1/","https://8.8.8.8/","https://100.63.0.1/"])
  t(u, !!M.validateTarget(u).error, false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
