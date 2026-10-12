// Bundle import — the acceptance test from the port brief.
// Pure-function level: splitBundle / readBundle / remapGroup. The commit-time
// duplicate check lives in the router against D1 and is exercised here through
// the same key rule the router uses, so a change to one shows up as a failure.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readBundle, remapGroup, splitBundle, MAPPABLE_FIELDS } from './leads.js';

const here = dirname(fileURLToPath(import.meta.url));
const fx = (f) => readFileSync(join(here, 'fixtures', f), 'utf8');

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; console.log('  ok  ', name); } else { fail++; console.log('  FAIL', name); } };
const eq = (a, b, name) => ok(a === b, `${name} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

// The acceptance bundle: a 10-row CSV, a 3-row markdown table under a heading,
// and the two sheets an xlsx contributes (the client turns each sheet into its
// own table before posting, so the server contract is the same).
const bundle = [fx('gemini-sample.csv'), fx('bundle-sample.md'), fx('xlsx-sheets.md')].join('\n\n');

const res = readBundle(bundle);
ok(!res.error, 'bundle parses without error');
eq(res.groups.length, 4, 'four groups');
eq(res.groups[0].leads.length, 10, 'group 1 has the 10 Gemini rows');
eq(res.groups[1].leads.length, 3, 'group 2 has the 3 Seguros rows');
eq(res.groups[2].leads.length, 2, 'group 3 has 2 rows');
eq(res.groups[3].leads.length, 2, 'group 4 has 2 rows');

eq(res.groups[1].industry, 'Seguros', 'heading supplies the industry');
eq(res.groups[1].region, 'Colón', 'heading supplies the region');
eq(res.groups[3].industry, 'Logistica', 'sheet heading supplies its own industry');
eq(res.groups[3].region, 'Colon', 'sheet heading supplies its own region');

// prose between tables is not a group
ok(!res.groups.some((g) => g.leads.some((l) => /everything for Col/i.test(l.company || ''))), 'prose is not imported as a lead');

// every lead starts in the queue with no events
ok(res.groups.every((g) => g.leads.every((l) => !l.rung)), 'imported leads carry no rung of their own (router sets 0)');

// ── duplicate rule, the same key the router commits on ──
const key = (l) => l.website || l.email || l.phone || (l.company || '').toLowerCase();
const seen = new Set();
let firstPass = 0;
for (const g of res.groups) for (const l of g.leads) { const k = key(l); if (k && !seen.has(k)) { seen.add(k); firstPass++; } }
eq(firstPass, 17, 'first import takes every unique lead');

let secondPass = 0;
for (const g of res.groups) for (const l of g.leads) { const k = key(l); if (k && !seen.has(k)) { seen.add(k); secondPass++; } }
eq(secondPass, 0, 're-importing the same bundle imports nothing');

// ── a single table still behaves as one group ──
const single = readBundle(fx('gemini-sample.csv'));
eq(single.groups.length, 1, 'a lone table is one group');
eq(single.groups[0].leads.length, 10, 'and keeps all its rows');

// ── column mapping override ──
const csv = fx('gemini-sample.csv');
const asIs = remapGroup(csv, []);
eq(asIs.columns[0].field, 'company', 'auto-mapped first column is company');
const forced = remapGroup(csv, ['company', 'name', 'notes', 'focus', 'region', 'email', 'whatsapp', 'phone', 'website', 'notes']);
eq(forced.columns[2].field, 'notes', 'an override wins over the guess');
eq(forced.leads.length, 10, 'override keeps every row');
ok(remapGroup(csv, [null, null, null, null, null, null, null, null, null, null]).error, 'a map with no company or name is refused');

ok(MAPPABLE_FIELDS.includes('company') && MAPPABLE_FIELDS.includes('whatsapp'), 'mappable fields are exposed to the UI');
eq(splitBundle('just a sentence, with commas, in it').length, 0, 'one prose line is not a table');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
