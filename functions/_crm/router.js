// DATRUM CRM — JSON API router.
// Lifted from the source worker's route(); the only change is the path prefix,
// which is /admin/api/ here instead of /api/. Everything below this header is
// the source logic unchanged.
//
// This file lives under functions/ on purpose: Pages uploads the repo root as
// static assets, so a root-level crm/ folder would serve these modules as
// public source. functions/ is never served.

import {
  RUNGS, REJECTIONS, OUTCOMES, addEvent, afterEvent, refreshLast, createProspect,
  findProspect, normPhone, updateProspect, nowIso,
} from './db.js';
import { readBatch } from './leads.js';
import { aiJSON, transcribe, PROMPTS } from './ai.js';
import { parseWhatsApp, groupIntoEvents } from './whatsapp.js';
import { analytics } from './analytics.js';

const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'microphone=(self), camera=(), geolocation=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Cache-Control': 'no-store',
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
const bad = (msg, status = 400) => json({ error: msg }, status);

function withHeaders(res) {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
  return out;
}

export { SECURITY_HEADERS, json, bad, withHeaders };

export async function route(request, env, url) {
  const db = env.DB;
  const method = request.method;
  const parts = url.pathname.replace(/^\/admin\/api\//, '').split('/').filter(Boolean);
  const body = ['POST', 'PATCH', 'PUT'].includes(method) && request.headers.get('content-type')?.includes('json')
    ? await request.json() : null;

  // ── config ───────────────────────────────────────────
  if (parts[0] === 'config' && method === 'GET') {
    return json({
      rungs: RUNGS,
      rejections: REJECTIONS,
      outcomes: OUTCOMES,
      log_address: env.LOG_ADDRESS,
      daily_target: parseInt(env.DAILY_TOUCH_TARGET || '20', 10),
      ai: env.ANTHROPIC_API_KEY ? 'claude' : env.AI ? 'workers-ai' : 'off',
    });
  }

  // ── prospects ────────────────────────────────────────
  if (parts[0] === 'prospects') {
    const id = parts[1] ? parseInt(parts[1], 10) : null;
    if (!id && method === 'GET') {
      const q = (url.searchParams.get('q') || '').trim();
      const status = url.searchParams.get('status') || 'active';
      let sql = `SELECT * FROM prospects WHERE 1=1`;
      const binds = [];
      // active = in the pipeline (Touch and up); queue = researched, not yet contacted
      if (status === 'queue') sql += " AND status = 'active' AND rung = 0";
      else if (status === 'active') sql += " AND status = 'active' AND rung >= 1";
      else if (status !== 'all') { sql += ' AND status = ?'; binds.push(status); }
      for (const f of ['industry', 'region']) {
        const v = url.searchParams.get(f);
        if (v) { sql += ` AND ${f} = ?`; binds.push(v); }
      }
      if (q) {
        sql += ' AND (name LIKE ? OR company LIKE ? OR email LIKE ? OR phone LIKE ? OR industry LIKE ? OR focus LIKE ? OR region LIKE ? OR website LIKE ?)';
        const like = `%${q}%`;
        binds.push(like, like, like, `%${q.replace(/\D/g, '') || q}%`, like, like, like, like);
      }
      sql += ' ORDER BY COALESCE(last_touch_at, created_at) DESC LIMIT 500';
      return json((await db.prepare(sql).bind(...binds).all()).results);
    }
    if (!id && method === 'POST') {
      if (!body?.name && !body?.company) return bad('A name or company is required');
      const existing = await findProspect(db, { email: body.email, phone: body.phone, website: body.website, company: body.company });
      if (existing && !body.force) return json({ duplicate: existing }, 409);
      return json(await createProspect(db, body), 201);
    }
    if (id && method === 'GET') {
      const p = await db.prepare('SELECT * FROM prospects WHERE id = ?').bind(id).first();
      if (!p) return bad('Not found', 404);
      const events = (await db.prepare('SELECT * FROM events WHERE prospect_id = ? ORDER BY occurred_at DESC').bind(id).all()).results;
      const history = (await db.prepare('SELECT * FROM rung_history WHERE prospect_id = ? ORDER BY changed_at').bind(id).all()).results;
      return json({ ...p, events, history });
    }
    if (id && method === 'PATCH') {
      const p = await updateProspect(db, id, body || {});
      return p ? json(p) : bad('Not found', 404);
    }
    if (id && method === 'DELETE') {
      await db.prepare('DELETE FROM prospects WHERE id = ?').bind(id).run();
      return json({ ok: true });
    }
  }

  // ── events ───────────────────────────────────────────
  if (parts[0] === 'events') {
    const id = parts[1] ? parseInt(parts[1], 10) : null;
    if (!id && method === 'POST') {
      if (!body?.prospect_id) return bad('prospect_id is required');
      const ev = await addEvent(db, { ...body, source: body.source || 'manual' }, { explicitNo: !!body.explicit_no });
      if (body.next_step !== undefined || body.next_step_at !== undefined || body.rung) {
        await updateProspect(db, body.prospect_id, pick(body, ['next_step', 'next_step_at', 'rung']));
      }
      return json(ev, 201);
    }
    if (id && method === 'PATCH') {
      // used by the Inbox to assign an unmatched email to a prospect
      const ev = await db.prepare('SELECT * FROM events WHERE id = ?').bind(id).first();
      if (!ev) return bad('Not found', 404);
      let prospectId = body?.prospect_id;
      if (!prospectId && body?.create_prospect) {
        const meta = ev.meta ? JSON.parse(ev.meta) : {};
        const p = await createProspect(db, { name: meta.counterpart_name || meta.counterpart, email: meta.counterpart, ...body.create_prospect });
        prospectId = p.id;
      }
      if (!prospectId) return bad('prospect_id or create_prospect is required');
      await db.prepare('UPDATE events SET prospect_id = ? WHERE id = ?').bind(prospectId, id).run();
      await afterEvent(db, { ...ev, prospect_id: prospectId });
      return json({ ok: true, prospect_id: prospectId });
    }
    if (id && method === 'DELETE') {
      const ev = await db.prepare('SELECT prospect_id FROM events WHERE id = ?').bind(id).first();
      await db.prepare('DELETE FROM events WHERE id = ?').bind(id).run();
      if (ev?.prospect_id) await refreshLast(db, ev.prospect_id); // keep "last message" truthful
      return json({ ok: true });
    }
  }

  // ── lead batches: preview → commit ───────────────────
  if (parts[0] === 'import' && parts[1] === 'preview' && method === 'POST') {
    const result = readBatch(String(body?.text || '').slice(0, 500_000), { industry: body?.industry, region: body?.region });
    if (result.error) return bad(result.error);
    const seen = new Map();
    for (const lead of result.leads) {
      const match = await findProspect(db, { email: lead.email, phone: lead.phone, website: lead.website, company: lead.company });
      if (match) lead.duplicate = { id: match.id, name: match.name, company: match.company, rung: match.rung, status: match.status };
      const key = lead.website || lead.email || (lead.company || '').toLowerCase();
      if (key && seen.has(key)) lead.duplicate_in_batch = seen.get(key);
      else if (key) seen.set(key, lead.lead_ref || lead.company);
    }
    return json(result);
  }

  if (parts[0] === 'import' && parts[1] === 'commit' && method === 'POST') {
    const leads = (body?.leads || []).slice(0, 1000);
    if (!leads.length) return bad('No leads selected');
    const label = (body.label || '').trim() || `Batch ${new Date().toISOString().slice(0, 10)}`;
    // re-check at commit time: nothing is ever imported twice
    const fresh = [], keys = new Set();
    for (const lead of leads) {
      const key = lead.website || lead.email || lead.phone || (lead.company || '').toLowerCase();
      if (key && keys.has(key)) continue; // same lead twice in one batch
      if (await findProspect(db, { email: lead.email, phone: lead.phone, website: lead.website, company: lead.company })) continue;
      if (key) keys.add(key);
      fresh.push(lead);
    }
    const skipped = leads.length - fresh.length;
    if (!fresh.length) return json({ batch_id: null, label, imported: 0, skipped });
    const batch = await db.prepare('INSERT INTO batches (label, source, industry, region) VALUES (?, ?, ?, ?) RETURNING *')
      .bind(label, body.source || null, body.industry || null, body.region || null).first();
    let imported = 0;
    for (const lead of fresh) {
      await createProspect(db, { ...lead, rung: 0, source: body.source || null, batch_id: batch.id });
      imported++;
    }
    await db.prepare('UPDATE batches SET imported = ? WHERE id = ?').bind(imported, batch.id).run();
    return json({ batch_id: batch.id, label, imported, skipped }, 201);
  }

  // ── today's queue: next leads to contact, oldest batch first ──
  if (parts[0] === 'queue' && method === 'GET') {
    const tz = parseInt(env.TZ_OFFSET_HOURS || '-5', 10);
    const tzMod = `${tz >= 0 ? '+' : ''}${tz} hours`;
    const leads = (await db.prepare(
      `SELECT p.*, b.label AS batch_label FROM prospects p LEFT JOIN batches b ON b.id = p.batch_id
        WHERE p.status = 'active' AND p.rung = 0
        ORDER BY (p.flags IS NOT NULL AND p.flags LIKE '%No usable phone%' AND p.email IS NULL), p.batch_id, p.id LIMIT 300`
    ).all()).results;
    const touched = await db.prepare(
      `SELECT COUNT(DISTINCT prospect_id) AS n FROM events
        WHERE direction = 'out' AND prospect_id IS NOT NULL AND date(occurred_at, ?) = date('now', ?)`
    ).bind(tzMod, tzMod).first();
    return json({ leads, touched_today: touched.n, target: parseInt(env.DAILY_TOUCH_TARGET || '20', 10) });
  }

  if (parts[0] === 'batches' && method === 'GET') {
    return json((await db.prepare('SELECT * FROM batches ORDER BY created_at DESC LIMIT 100').all()).results);
  }

  // ── inbox: emails that matched no prospect ───────────
  if (parts[0] === 'inbox' && method === 'GET') {
    return json((await db.prepare('SELECT * FROM events WHERE prospect_id IS NULL ORDER BY occurred_at DESC LIMIT 200').all()).results);
  }

  // ── conversation paste (WhatsApp / any chat) → preview ──
  if (parts[0] === 'parse' && parts[1] === 'conversation' && method === 'POST') {
    const text = String(body?.text || '').slice(0, 60000);
    if (!text.trim()) return bad('Paste a conversation first');
    const tz = parseInt(env.TZ_OFFSET_HOURS || '-5', 10);
    const ownerNames = (env.OWNER_WA_NAMES || '').split(',');
    const { messages, contactName } = parseWhatsApp(text, { ownerNames, tzOffsetHours: tz });
    const ai = await aiJSON(env, PROMPTS.conversation, text.slice(-8000));

    let events = groupIntoEvents(messages, tz);
    if (!events.length) {
      // Plain text without WhatsApp timestamps: one event, now.
      events = [{ channel: 'whatsapp', direction: ai?.direction_if_unclear || 'out', occurred_at: nowIso(), body: text, summary: ai?.summary || text.slice(0, 120), count: 1 }];
    }

    const senderPhone = contactName && /^\+?[\d\s\-()]{7,}$/.test(contactName) ? contactName : null;
    let match = null;
    if (body.prospect_id) match = await db.prepare('SELECT * FROM prospects WHERE id = ?').bind(body.prospect_id).first();
    if (!match) match = await findProspect(db, { email: ai?.email, phone: ai?.phone || senderPhone });
    if (!match && (contactName || ai?.contact_name)) {
      const n = (ai?.contact_name || contactName).trim();
      match = await db.prepare('SELECT * FROM prospects WHERE name LIKE ? OR company LIKE ? ORDER BY updated_at DESC LIMIT 1')
        .bind(`%${n}%`, `%${n}%`).first();
    }
    return json({
      events,
      parsed_messages: messages.length,
      contact_name: senderPhone ? (ai?.contact_name || null) : contactName || ai?.contact_name || null,
      phone: normPhone(ai?.phone || senderPhone),
      ai,
      match,
    });
  }

  // ── commit a confirmed conversation ─────────────────
  if (parts[0] === 'log' && parts[1] === 'conversation' && method === 'POST') {
    let prospectId = body?.prospect_id;
    if (!prospectId) {
      if (!body?.prospect?.name && !body?.prospect?.company) return bad('Choose a prospect or enter a name');
      prospectId = (await createProspect(db, body.prospect)).id;
    }
    let added = 0, skipped = 0;
    for (const ev of body.events || []) {
      const occurred = new Date(ev.occurred_at || Date.now()).toISOString();
      const dupe = await db.prepare(
        'SELECT id FROM events WHERE prospect_id = ? AND channel = ? AND direction = ? AND occurred_at = ?'
      ).bind(prospectId, ev.channel || 'whatsapp', ev.direction, occurred).first();
      if (dupe) { skipped++; continue; } // re-pasting the same chat never double-counts
      await addEvent(db, { ...ev, occurred_at: occurred, prospect_id: prospectId, source: 'paste' },
        { explicitNo: !!body.explicit_no });
      added++;
    }
    const patch = pick(body, ['next_step', 'next_step_at']);
    if (body.rung) {
      const cur = await db.prepare('SELECT rung FROM prospects WHERE id = ?').bind(prospectId).first();
      if (cur && body.rung > cur.rung) patch.rung = body.rung; // pastes only move forward
    }
    if (Object.keys(patch).length) await updateProspect(db, prospectId, patch);
    return json({ prospect_id: prospectId, added, skipped });
  }

  // ── call helpers: voice note → transcript → suggestion ──
  if (parts[0] === 'assist' && parts[1] === 'call' && method === 'POST') {
    let transcript = body?.text || '';
    if (!body) {
      const form = await request.formData();
      const audio = form.get('audio');
      if (!audio || typeof audio === 'string') return bad('No audio received');
      if (audio.size > 25 * 1024 * 1024) return bad('Voice note too long (25 MB max)');
      transcript = await transcribe(env, await audio.arrayBuffer());
    }
    if (!transcript.trim()) return bad('Nothing to summarize');
    const ai = await aiJSON(env, PROMPTS.call, transcript.slice(0, 12000), { maxTokens: 400 });
    return json({ transcript, ai });
  }

  // ── analytics ────────────────────────────────────────
  if (parts[0] === 'analytics' && method === 'GET') {
    const days = Math.min(180, Math.max(7, parseInt(url.searchParams.get('days') || '30', 10)));
    return json(await analytics(env, { days }));
  }

  // ── export (Ley 81: the data is yours, portable) ─────
  if (parts[0] === 'export' && method === 'GET') {
    const prospects = (await db.prepare('SELECT * FROM prospects').all()).results;
    const events = (await db.prepare('SELECT * FROM events').all()).results;
    return new Response(JSON.stringify({ exported_at: nowIso(), prospects, events }, null, 2), {
      headers: { 'content-type': 'application/json', 'content-disposition': 'attachment; filename="datrum-crm-export.json"' },
    });
  }

  return bad('Not found', 404);
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj && obj[k] !== undefined) out[k] = obj[k];
  return out;
}
