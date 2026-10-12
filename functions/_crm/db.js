// Data access helpers. Every write that touches a prospect keeps
// the "last message" fields and the rung history consistent, so analytics stay honest.

export const QUEUE = 0;
export const RUNGS = ['Touch', 'Interest', 'Read', 'Diagnostic', 'Proposal', 'Close']; // rungs 1–6
export const CHANNELS = ['email', 'whatsapp', 'call', 'meeting', 'note'];
export const DIRECTIONS = ['out', 'in', 'none'];

// Why deals die. Fixed list so analytics can count them; add a note for nuance.
export const REJECTIONS = {
  ghosted: 'Ghosted — never replied',
  not_interested: 'Not interested',
  in_house: 'Has an in-house / internal team',
  defensive: 'Defensive about the findings',
  no_budget: 'No budget',
  price: 'Price too high',
  timing: 'Bad timing — maybe later',
  no_authority: 'Not the decision maker',
  competitor: 'Chose someone else',
  bad_data: 'Bad or wrong contact info',
  not_a_fit: 'Not a fit for DATRUM',
  other: 'Other',
};

// Phone-first outreach: every dial is a touch, but only "connected" is a conversation.
export const OUTCOMES = {
  connected: 'Connected — talked',
  no_answer: 'No answer',
  voicemail: 'Voicemail',
  gatekeeper: 'Gatekeeper / reception',
  callback: 'Asked me to call back',
  wrong_number: 'Wrong number',
};
export const CONVERSED = ['connected', 'callback'];

export const nowIso = () => new Date().toISOString();

export function normPhone(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  let d = s.replace(/\D/g, '');
  if (!d) return null;
  if (!s.startsWith('+') && (d.length === 7 || d.length === 8)) d = '507' + d; // Panama local numbers
  return d;
}

export const normEmail = (e) => (e ? String(e).trim().toLowerCase() : null);

export function normDomain(raw) {
  if (!raw) return null;
  return String(raw).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[\/?#]/)[0] || null;
}

// "Cheng y Asociados (HLB Panama)" → "cheng asociados hlb" — for duplicate detection only.
export function normCompany(raw) {
  if (!raw) return null;
  return String(raw).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\b(s\.?\s?a\.?|inc|corp(oration)?|ltd|llc|group|grupo|panama|y|and|de|del|la|el|the|&)\b/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim() || null;
}

export const GENERIC_DOMAINS = new Set([
  'gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com', 'icloud.com', 'live.com',
  'msn.com', 'protonmail.com', 'proton.me', 'aol.com', 'me.com', 'yahoo.es', 'hotmail.es',
]);

export async function findProspect(db, { email, phone, website, company }) {
  email = normEmail(email);
  if (email) {
    const p = await db.prepare('SELECT * FROM prospects WHERE email = ?').bind(email).first();
    if (p) return p;
  }
  const domain = normDomain(website) || (email && email.split('@')[1]);
  if (domain && !GENERIC_DOMAINS.has(domain)) {
    const p = await db.prepare('SELECT * FROM prospects WHERE website = ? OR email LIKE ? ORDER BY updated_at DESC LIMIT 1')
      .bind(domain, '%@' + domain).first();
    if (p) return p;
  }
  const phones = Array.isArray(phone) ? phone : [phone];
  for (const ph of phones) {
    const d = normPhone(ph);
    if (!d || d.length < 7) continue;
    const p = await db.prepare('SELECT * FROM prospects WHERE phone LIKE ?').bind('%' + d.slice(-8)).first();
    if (p) return p;
  }
  const key = normCompany(company);
  if (key && key.length >= 4) {
    const rows = (await db.prepare('SELECT * FROM prospects WHERE company IS NOT NULL').all()).results;
    const p = rows.find((r) => normCompany(r.company) === key);
    if (p) return p;
  }
  return null;
}

const EDITABLE = [
  'name', 'company', 'phone', 'email', 'website', 'industry', 'focus', 'region', 'kind', 'rung', 'status',
  'rejection_type', 'rejection_note', 'finding', 'next_step', 'next_step_at', 'notes',
  'qualified_at', 'meeting_agreed_at', 'meeting_at', 'met_at',
];

function cleanField(k, v) {
  if (v === '' || v === undefined) return null;
  if (k === 'phone') return normPhone(v);
  if (k === 'email') return normEmail(v);
  if (k === 'website') return normDomain(v);
  if (k === 'rung') return clampRung(v);
  if (k === 'kind') return ['ghost', 'vampire'].includes(v) ? v : null;
  if (k === 'rejection_type') return v in REJECTIONS ? v : null;
  if (['qualified_at', 'meeting_agreed_at', 'meeting_at', 'met_at'].includes(k)) {
    const t = new Date(v); return Number.isNaN(t.getTime()) ? null : t.toISOString();
  }
  return typeof v === 'string' ? v.trim() : v;
}

export async function createProspect(db, data) {
  const rung = clampRung(data.rung ?? 1);
  const row = await db
    .prepare(
      `INSERT INTO prospects (name, company, phone, email, website, industry, focus, region, kind, rung, status,
         finding, next_step, next_step_at, notes, flags, source, batch_id, lead_ref)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
    )
    .bind(
      (data.name || data.company || 'Unknown').trim(),
      cleanField('company', data.company), cleanField('phone', data.phone), cleanField('email', data.email),
      cleanField('website', data.website), cleanField('industry', data.industry), cleanField('focus', data.focus),
      cleanField('region', data.region), cleanField('kind', data.kind), rung,
      cleanField('finding', data.finding), cleanField('next_step', data.next_step), cleanField('next_step_at', data.next_step_at),
      cleanField('notes', data.notes),
      data.flags?.length ? JSON.stringify(data.flags) : null,
      data.source || null, data.batch_id || null, data.lead_ref || null
    )
    .first();
  await db.prepare('INSERT INTO rung_history (prospect_id, from_rung, to_rung) VALUES (?, NULL, ?)').bind(row.id, rung).run();
  return row;
}

export async function updateProspect(db, id, patch) {
  const current = await db.prepare('SELECT * FROM prospects WHERE id = ?').bind(id).first();
  if (!current) return null;
  patch = { ...patch };
  // Winning means the Close rung was reached; reopening clears the rejection.
  if (patch.status === 'won' && !('rung' in patch)) patch.rung = 6;
  if (patch.status === 'active') { patch.rejection_type = null; patch.rejection_note = null; }
  if (patch.status && !['active', 'won', 'lost'].includes(patch.status)) delete patch.status;

  const sets = [], vals = [];
  for (const k of EDITABLE) {
    if (!(k in patch)) continue;
    sets.push(`${k} = ?`);
    vals.push(cleanField(k, patch[k]));
  }
  if ('flags' in patch) { sets.push('flags = ?'); vals.push(patch.flags?.length ? JSON.stringify(patch.flags) : null); }
  if (!sets.length) return current;
  sets.push('updated_at = ?'); vals.push(nowIso());
  const row = await db.prepare(`UPDATE prospects SET ${sets.join(', ')} WHERE id = ? RETURNING *`).bind(...vals, id).first();
  if ('rung' in patch && row.rung !== current.rung) {
    await db.prepare('INSERT INTO rung_history (prospect_id, from_rung, to_rung) VALUES (?, ?, ?)').bind(id, current.rung, row.rung).run();
  }
  return row;
}

export async function addEvent(db, ev, opts = {}) {
  const channel = CHANNELS.includes(ev.channel) ? ev.channel : 'note';
  const direction = DIRECTIONS.includes(ev.direction) ? ev.direction : 'none';
  const occurred = ev.occurred_at ? new Date(ev.occurred_at).toISOString() : nowIso();
  const outcome = channel === 'call' && ev.outcome in OUTCOMES ? ev.outcome : null;
  const summary = ev.summary || (outcome ? `Call — ${OUTCOMES[outcome]}` : null);
  const row = await db
    .prepare(
      `INSERT INTO events (prospect_id, channel, direction, occurred_at, summary, body, source, meta, outcome)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
    )
    .bind(ev.prospect_id ?? null, channel, direction, occurred, summary, ev.body || null,
      ev.source || 'manual', ev.meta ? JSON.stringify(ev.meta) : null, outcome)
    .first();
  if (row.prospect_id) await afterEvent(db, row, opts);
  return row;
}

// Recompute the "last message" fields and the touch counters from the timeline
// (runs after every add, assign and delete, so the numbers can't drift).
export async function refreshLast(db, prospectId) {
  const last = await db.prepare(
    `SELECT occurred_at, summary, direction, channel, outcome FROM events WHERE prospect_id = ? ORDER BY occurred_at DESC, id DESC LIMIT 1`
  ).bind(prospectId).first();
  const counts = (await db.prepare(
    `SELECT channel, COUNT(*) AS n FROM events WHERE prospect_id = ? AND direction = 'out' GROUP BY channel`
  ).bind(prospectId).all()).results;
  const byChannel = Object.fromEntries(counts.map((c) => [c.channel, c.n]));
  const total = counts.reduce((s, c) => s + c.n, 0);
  await db.prepare(
    `UPDATE prospects SET last_touch_at = ?, last_message = ?, last_direction = ?, last_channel = ?, last_outcome = ?,
            touches = ?, touch_channels = ?, updated_at = ? WHERE id = ?`
  ).bind(last?.occurred_at ?? null, last?.summary ?? null, last?.direction ?? null, last?.channel ?? null, last?.outcome ?? null,
    total, total ? JSON.stringify(byChannel) : null, nowIso(), prospectId).run();
}

// Ladder automation:
//  • first outbound touch takes a queued lead (0) to Touch (1)
//  • Interest gate: any inbound reply that is not an explicit "no" moves Touch → Interest
//  • a connected call counts as a reply; a held meeting marks "met"
export async function afterEvent(db, ev, { explicitNo = false } = {}) {
  await refreshLast(db, ev.prospect_id);
  const p = await db.prepare('SELECT rung, status, flags, meeting_agreed_at, met_at FROM prospects WHERE id = ?').bind(ev.prospect_id).first();
  if (!p) return;
  const patch = {};
  if (ev.channel === 'meeting' && ev.occurred_at <= nowIso() && !p.met_at) {
    patch.met_at = ev.occurred_at;
    if (!p.meeting_agreed_at) patch.meeting_agreed_at = ev.occurred_at;
  }
  if (ev.outcome === 'wrong_number') {
    const flags = p.flags ? JSON.parse(p.flags) : [];
    if (!flags.includes('Wrong number reported on a call')) patch.flags = [...flags, 'Wrong number reported on a call'];
  }
  if (p.status === 'active') {
    const replied = ev.direction === 'in' || CONVERSED.includes(ev.outcome) || ev.channel === 'meeting';
    if (replied && !explicitNo && p.rung <= 1) patch.rung = 2;
    else if (ev.direction !== 'none' && p.rung === QUEUE) patch.rung = 1;
  }
  if (Object.keys(patch).length) await updateProspect(db, ev.prospect_id, patch);
}

export function clampRung(r) {
  const n = parseInt(r, 10);
  if (Number.isNaN(n)) return 1;
  return Math.min(6, Math.max(0, n));
}
