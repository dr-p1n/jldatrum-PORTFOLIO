// Batch lead import. Reads whatever the research tool produced — CSV, a table
// pasted from Sheets (tabs), or a markdown table from a Gemini/ChatGPT chat —
// maps the columns by name, cleans contacts, and flags data that looks invented.
// Deterministic on purpose: the rules catch the research tool's quirks; no AI guessing.

import { GENERIC_DOMAINS, normDomain, normEmail } from './db.js';

// header (lowercased, accents stripped) → field
const HEADERS = [
  ['lead_ref', ['id', 'ref', 'lead id', '#', 'no', 'n']],
  ['company', ['firm name', 'firm', 'company', 'company name', 'business', 'business name', 'empresa', 'firma', 'nombre de la empresa', 'organization', 'organizacion', 'brand', 'marca', 'nombre comercial']],
  ['name', ['contact', 'contact name', 'contact person', 'decision maker', 'contacto', 'nombre de contacto', 'persona', 'owner', 'dueno', 'gerente', 'name', 'nombre']],
  ['role', ['role', 'title', 'position', 'cargo', 'puesto']],
  ['industry', ['industry', 'sector', 'vertical', 'industria', 'rubro', 'category', 'categoria']],
  ['focus', ['focus area', 'focus', 'specialty', 'speciality', 'services', 'service', 'enfoque', 'especialidad', 'servicios', 'niche', 'nicho']],
  ['region', ['region', 'city', 'location', 'area', 'ciudad', 'ubicacion', 'provincia', 'country', 'pais', 'zone', 'zona']],
  ['email', ['primary email', 'email', 'e-mail', 'mail', 'correo', 'correo electronico', 'email address']],
  ['whatsapp', ['whatsapp contact', 'whatsapp', 'wa', 'whatsapp number', 'celular', 'mobile', 'movil', 'cell']],
  ['phone', ['office telephone', 'telephone', 'phone', 'office phone', 'telefono', 'tel', 'phone number', 'numero', 'landline']],
  ['website', ['website', 'web', 'url', 'site', 'sitio', 'sitio web', 'pagina web', 'domain', 'dominio']],
  ['kind', ['type', 'tipo', 'ghost/vampire', 'presence']],
  ['finding', ['finding', 'hallazgo', 'gap', 'issue', 'problem', 'problema', 'pain point', 'scan finding', 'top finding']],
  ['score', ['score', 'scan score', 'puntaje', 'scanner score']],
  ['notes', ['notes', 'notas', 'comments', 'comentarios', 'observaciones']],
];

const plain = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[_*]/g, '').trim();

function mapHeader(h) {
  const p = plain(h);
  for (const [field, names] of HEADERS) if (names.includes(p)) return field;
  for (const [field, names] of HEADERS) if (names.some((n) => n.length > 3 && p.includes(n))) return field;
  return null;
}

// ── table text → rows of cells ─────────────────────────
function parseDelimited(text, delim) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"' && cell.trim() === '') { q = true; cell = ''; }
    else if (c === delim) { row.push(cell.trim()); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell.trim()); cell = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell.trim());
  if (row.some((x) => x !== '')) rows.push(row);
  return rows;
}

function parseMarkdown(text) {
  return text.split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('|'))
    .map((l) => l.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim().replace(/^\*\*(.*)\*\*$/, '$1')))
    .filter((cells) => !cells.every((c) => /^:?-{2,}:?$/.test(c))); // drop the |---|---| separator
}

export function parseTable(text) {
  text = String(text || '').replace(/^﻿/, '').trim();
  // Gemini often wraps output in a code fence
  text = text.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '');
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  if (lines.filter((l) => l.trim().startsWith('|')).length >= 2) return parseMarkdown(text);
  const first = lines[0];
  const delim = first.includes('\t') ? '\t' : (first.split(';').length > first.split(',').length ? ';' : ',');
  return parseDelimited(text, delim);
}

// ── contact cleanup ────────────────────────────────────
// "+507 395-5607 / 265-5849" → ["5073955607", "5072655849"]
export function splitPhones(raw) {
  if (!raw) return [];
  const parts = String(raw).split(/\s*(?:\/|,|;|\bor\b|\bo\b|\by\b|\|)\s*/i);
  const out = [];
  let lastCountry = null;
  for (const part of parts) {
    const digits = part.replace(/\D/g, '');
    if (digits.length < 7) continue;
    let d;
    if (part.trim().startsWith('+')) {
      d = digits;
      if (d.startsWith('507')) lastCountry = '507';
      else lastCountry = null;
    } else if (digits.length <= 8) d = (lastCountry || '507') + digits;
    else d = digits;
    if (!out.includes(d)) out.push(d);
  }
  return out;
}

const isPanama = (d) => d.startsWith('507');
const isPanamaMobile = (d) => isPanama(d) && d.length === 11 && d[3] === '6'; // 6xxx-xxxx
// Research tools pad unknown numbers: 6670-0000, 390-0000, 1111-1111, 123-4567…
export function looksPlaceholder(d) {
  const local = isPanama(d) ? d.slice(3) : d.slice(-8);
  return /0000$/.test(local) || /(\d)\1{4,}/.test(local) || /1234567|2345678|9876543/.test(local);
}

const GENERIC_INBOX = /^(info|contacto|contact|hola|hello|admin|ventas|sales|office|oficina|recepcion|reception|mail|consultas|servicio|soporte|support)@/;

export function normalizeRow(cells, map, defaults = {}) {
  const raw = {};
  const extras = [];
  map.forEach((field, i) => {
    const v = (cells[i] ?? '').trim();
    if (!v) return;
    if (field) raw[field] = raw[field] ? raw[field] + ' / ' + v : v;
    else extras.push(v);
  });

  const flags = [];
  const lead = {
    lead_ref: raw.lead_ref || null,
    company: raw.company || null,
    name: raw.name || null,
    industry: raw.industry || defaults.industry || null,
    focus: raw.focus || null,
    region: raw.region || defaults.region || null,
    kind: /ghost/i.test(raw.kind || '') ? 'ghost' : /vamp/i.test(raw.kind || '') ? 'vampire' : null,
    finding: raw.finding || null,
    email: null, phone: null, website: null,
  };

  // email
  const em = (raw.email || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (em) {
    lead.email = normEmail(em[0]);
    if (GENERIC_INBOX.test(lead.email)) flags.push('Generic inbox — find a named contact');
  } else flags.push('No email');

  // website: column, else the email's company domain
  lead.website = normDomain(raw.website) || null;
  if (!lead.website && lead.email) {
    const dom = lead.email.split('@')[1];
    if (!GENERIC_DOMAINS.has(dom)) lead.website = dom; // the company's own mail domain is its site
  }
  if (!lead.website) flags.push('No website — possible Ghost');

  // phones: WhatsApp column first, then office lines
  const wa = splitPhones(raw.whatsapp);
  const office = splitPhones(raw.phone);
  const all = [...wa, ...office.filter((d) => !wa.includes(d))];
  const fake = all.filter(looksPlaceholder);
  const real = all.filter((d) => !looksPlaceholder(d));
  if (fake.length) flags.push(`Placeholder-looking number (${fake.map(fmt).join(', ')}) — verify before contacting`);
  const mobile = real.find(isPanamaMobile) || wa.find((d) => !looksPlaceholder(d));
  lead.phone = mobile || real[0] || null;
  if (lead.phone && !isPanamaMobile(lead.phone) && isPanama(lead.phone)) flags.push('Office line only — WhatsApp unlikely');
  if (lead.phone && !isPanama(lead.phone)) flags.push(`Foreign number (+${lead.phone.slice(0, 2)}…) — check it's a Panama prospect`);
  if (!lead.phone) flags.push('No usable phone');

  const otherPhones = real.filter((d) => d !== lead.phone);
  const notes = [];
  if (raw.role) notes.push(`Role: ${raw.role}`);
  if (raw.score) notes.push(`Scan score: ${raw.score}`);
  if (otherPhones.length) notes.push(`Other numbers: ${otherPhones.map(fmt).join(', ')}`);
  if (raw.whatsapp && !wa.length) notes.push(`WhatsApp (source said): ${raw.whatsapp}`);
  if (raw.notes) notes.push(raw.notes);
  if (extras.length) notes.push(extras.join(' · '));
  lead.notes = notes.join('\n') || null;

  // until a person is known, the firm is the contact
  if (!lead.name) lead.name = lead.company;
  if (!lead.company && !lead.name) flags.push('No company name');
  lead.flags = flags;
  return lead;
}

const fmt = (d) => (isPanama(d) && d.length >= 10 ? `+507 ${d.slice(3, d.length - 4)}-${d.slice(-4)}` : '+' + d);

export function readBatch(text, defaults = {}) {
  const rows = parseTable(text);
  if (rows.length < 2) return { error: 'Need a header row plus at least one lead. Paste the table including its column names.' };
  const header = rows[0];
  const map = header.map(mapHeader);
  if (!map.includes('company') && !map.includes('name')) {
    return { error: `Couldn't find a company or name column. Columns seen: ${header.join(', ')}` };
  }
  const leads = rows.slice(1)
    .filter((cells) => cells.some((c) => c && c.trim()))
    .map((cells) => normalizeRow(cells, map, defaults));
  return {
    columns: header.map((h, i) => ({ header: h, field: map[i] || null })),
    leads,
  };
}

// ── bundles ────────────────────────────────────────────
// One paste can carry several tables. Gemini and Manus answer with two or
// three, sometimes with a heading above each and prose in between. A block only
// becomes a group if readBatch can actually find a company or name column in
// it, which is what keeps the prose out — guessing from shape alone would turn
// a paragraph with commas into a table.

function headingParts(h) {
  if (!h) return { label: null, industry: null, region: null };
  const clean = String(h).replace(/^#+\s*/, '').replace(/^\*\*/, '').replace(/\*\*$/, '').replace(/:$/, '').trim();
  if (!clean) return { label: null, industry: null, region: null };
  const bits = clean.split(/\s*[—–·|]\s*|\s+-\s+/).map((s) => s.trim()).filter(Boolean);
  return { label: clean, industry: bits[0] || null, region: bits[1] || null };
}

function looksTabular(line) {
  const t = line.trim();
  if (!t) return false;
  if (t.startsWith('|')) return true;
  if (t.includes('\t')) return true;
  return t.split(',').length >= 3 || t.split(';').length >= 3;
}

// text → [{ heading, text }] — contiguous runs of table-shaped lines, each
// carrying the last non-table line above it as its heading.
export function splitBundle(text) {
  const src = String(text || '').replace(/^﻿/, '').replace(/```[a-z]*\n?/gi, '');
  const lines = src.split(/\r?\n/);
  const blocks = [];
  let buf = [], heading = null, lastProse = null;

  const flush = () => {
    if (buf.length >= 2) blocks.push({ heading, text: buf.join('\n') });
    buf = []; heading = null;
  };
  for (const line of lines) {
    if (looksTabular(line)) {
      if (!buf.length) heading = lastProse;
      buf.push(line);
    } else {
      flush();
      if (line.trim()) lastProse = line;
    }
  }
  flush();
  return blocks;
}

// The bundle entry point. Falls back to a single unnamed group so an ordinary
// one-table paste behaves exactly as it did before.
export function readBundle(text, defaults = {}) {
  const blocks = splitBundle(text);
  const groups = [];
  for (const b of blocks) {
    const { label, industry, region } = headingParts(b.heading);
    const parsed = readBatch(b.text, {
      industry: defaults.industry || industry || null,
      region: defaults.region || region || null,
    });
    if (parsed.error) continue;              // prose, or a table with no usable columns
    if (!parsed.leads.length) continue;
    groups.push({
      text: b.text,                          // kept so the UI can re-map columns
      label: label || null,
      industry: defaults.industry || industry || null,
      region: defaults.region || region || null,
      columns: parsed.columns,
      leads: parsed.leads,
    });
  }
  if (!groups.length) {
    const single = readBatch(text, defaults);
    if (single.error) return { error: single.error };
    return { groups: [{ text: String(text || ''), label: null, industry: defaults.industry || null, region: defaults.region || null, columns: single.columns, leads: single.leads }] };
  }
  return { groups };
}

// Re-read one group's rows under a corrected column map, so a wrong guess in
// the preview can be fixed without re-pasting. `fields` is one field name (or
// null) per column, in column order.
export function remapGroup(text, fields, defaults = {}) {
  const rows = parseTable(text);
  if (rows.length < 2) return { error: 'Need a header row plus at least one lead.' };
  const header = rows[0];
  const map = header.map((h, i) => (fields && fields[i] !== undefined ? fields[i] : mapHeader(h)));
  if (!map.includes('company') && !map.includes('name')) {
    return { error: 'Map at least one column to Company or Name.' };
  }
  const leads = rows.slice(1)
    .filter((cells) => cells.some((c) => c && c.trim()))
    .map((cells) => normalizeRow(cells, map, defaults));
  return { columns: header.map((h, i) => ({ header: h, field: map[i] || null })), leads };
}

// The fields a column can be mapped to, for the override select in the preview.
export const MAPPABLE_FIELDS = HEADERS.map(([field]) => field);
