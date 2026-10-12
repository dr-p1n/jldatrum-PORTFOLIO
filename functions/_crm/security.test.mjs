// Security invariants for the /admin port. These are cheap, and each one is
// here because getting it wrong exposes prospect data (Ley 81) rather than
// breaking a feature — so they fail the build, not a review.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : null);

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; console.log('  ok  ', name); } else { fail++; console.log('  FAIL', name); } };

// 1. DEV_SKIP_ACCESS may only ever come from .dev.vars, which is gitignored and
//    never deployed. In wrangler.toml or a committed env file it would disable
//    the Access check in production.
// Match an assignment, not the string: these files are allowed to *mention*
// the variable in a comment explaining this very rule.
const assigns = (s) => /^[^#\n]*\bDEV_SKIP_ACCESS\s*=/m.test(s || '');
ok(existsSync(join(root, 'workers/crm-mail/wrangler.toml')), 'the mail Worker config exists to be checked');
for (const f of ['workers/crm-mail/wrangler.toml', 'wrangler.toml', '_headers', '_routes.json']) {
  ok(!assigns(read(f)), `DEV_SKIP_ACCESS is not assigned in ${f}`);
}
ok(!read('.dev.vars'), '.dev.vars is not in the repo');
ok((read('.gitignore') || '').includes('.dev.vars'), '.dev.vars is gitignored');

// 2. The CRM source drop is never deployable. The repo root IS the Pages
//    deploy directory, so an untracked copy is one `git add -A` from public.
const gi = read('.gitignore') || '';
ok(gi.includes('_crm-source/'), '_crm-source/ is gitignored');
ok(gi.includes('*.zip'), 'zips are gitignored');
ok((read('_redirects') || '').includes('/_crm-source/*'), '_crm-source/* also 301s to /404');

// 3. Shared CRM modules must not be served as static assets. Anything under
//    functions/ is used to build routes and is never uploaded; a crm/ folder at
//    the root would publish db.js and leads.js as source.
ok(!existsSync(join(root, 'crm')), 'no root-level crm/ folder');
ok(existsSync(join(root, 'functions/_crm/db.js')), 'shared modules live under functions/');

// 4. Functions must not sit in front of the public site.
const routes = JSON.parse(read('_routes.json'));
ok(JSON.stringify(routes.include) === JSON.stringify(['/admin/api/*']), '_routes.json includes only /admin/api/*');

// 5. The admin block must not inherit the public analytics allowances, and the
//    public policy must not be loosened.
const headers = read('_headers');
const adminBlock = headers.slice(headers.indexOf('/admin/*'));
ok(!/googletagmanager|google-analytics/.test(adminBlock), 'admin CSP allows no analytics hosts');
ok(adminBlock.includes('Cache-Control: no-store'), 'admin responses are no-store');
ok(adminBlock.includes('Referrer-Policy: no-referrer'), 'admin sends no referrer');
ok(/X-Frame-Options: DENY/.test(adminBlock), 'admin denies framing');
const publicBlock = headers.slice(headers.indexOf('/*'), headers.indexOf('/admin/*'));
ok(!/'unsafe-inline'[^;]*script-src|script-src[^;]*'unsafe-inline'/.test(publicBlock), 'public script-src still has no unsafe-inline');

// 6. /admin is never advertised.
ok((read('robots.txt') || '').includes('Disallow: /admin'), 'robots.txt disallows /admin');
ok(!(read('sitemap.xml') || '').includes('/admin'), '/admin is not in the sitemap');
const adminHtml = read('admin/index.html') || '';
ok(/noindex/.test(adminHtml), 'admin page is noindex');
for (const f of readdirSync(root).filter((f) => f.endsWith('.html'))) {
  ok(!read(f).includes('/admin'), `${f} does not link /admin`);
}

// 7. The API entry verifies Access itself, independently of the Access app.
const entry = read('functions/admin/api/[[path]].js') || '';
ok(entry.includes('verifyAccess'), 'API entry verifies the Access JWT');
ok(/status: 401/.test(entry), 'API entry answers 401 without a valid token');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
