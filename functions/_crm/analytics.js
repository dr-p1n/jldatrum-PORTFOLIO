// Analytics read straight from the event stream and the rung history.

import { RUNGS, REJECTIONS, OUTCOMES } from './db.js';

const DAY = 86_400_000;

export async function analytics(env, { days = 30 } = {}) {
  const db = env.DB;
  const tz = parseInt(env.TZ_OFFSET_HOURS || '-5', 10);
  const tzMod = `${tz >= 0 ? '+' : ''}${tz} hours`;
  const target = parseInt(env.DAILY_TOUCH_TARGET || '20', 10);
  const staleDays = parseInt(env.STALE_DAYS || '5', 10);
  const now = Date.now();
  const since = new Date(now - days * DAY).toISOString();
  const localToday = new Date(now + tz * 3600_000).toISOString().slice(0, 10);

  // 1 ─ Ladder conversion: furthest rung each prospect ever reached (cohort = created in window).
  const reachedRows = (await db.prepare(
    `SELECT p.id, p.status,
            MAX(p.rung, COALESCE((SELECT MAX(h.to_rung) FROM rung_history h WHERE h.prospect_id = p.id), 1)) AS reached
       FROM prospects p WHERE p.created_at >= ?`
  ).bind(since).all()).results;
  const ladder = RUNGS.map((name, i) => ({ rung: i + 1, name, reached: reachedRows.filter((r) => r.reached >= i + 1).length }));
  ladder.forEach((step, i) => {
    const next = ladder[i + 1];
    step.to_next = next && step.reached ? next.reached / step.reached : null;
  });

  // 2 ─ Daily outreach volume: distinct prospects touched outbound per local day, by channel.
  const dailyRows = (await db.prepare(
    `SELECT date(occurred_at, ?) AS d, channel, COUNT(DISTINCT prospect_id) AS n
       FROM events WHERE direction = 'out' AND prospect_id IS NOT NULL AND occurred_at >= ?
      GROUP BY d, channel`
  ).bind(tzMod, since).all()).results;
  const daily = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now + tz * 3600_000 - i * DAY).toISOString().slice(0, 10);
    const row = { date: d, email: 0, whatsapp: 0, call: 0, meeting: 0, note: 0, total: 0 };
    for (const r of dailyRows) if (r.d === d) { row[r.channel] += r.n; row.total += r.n; }
    daily.push(row);
  }
  const todayRow = daily[daily.length - 1] || { total: 0 };
  const last7 = daily.slice(-7);
  const weekTotal = last7.reduce((s, r) => s + r.total, 0);

  // 3 ─ Reply rate by outreach channel: of prospects first contacted on a channel,
  //     how many answered (on any channel) afterwards.
  const replyRows = (await db.prepare(
    `WITH firsts AS (
       SELECT prospect_id, channel, MIN(occurred_at) AS first_out
         FROM events WHERE direction = 'out' AND prospect_id IS NOT NULL AND occurred_at >= ?
        GROUP BY prospect_id, channel)
     SELECT f.channel, COUNT(*) AS reached,
            SUM(EXISTS (SELECT 1 FROM events e WHERE e.prospect_id = f.prospect_id
                          AND e.occurred_at >= f.first_out
                          AND (e.direction = 'in' OR e.channel = 'meeting'
                               OR (e.channel = 'call' AND e.outcome IN ('connected','callback'))))) AS replied
       FROM firsts f GROUP BY f.channel`
  ).bind(since).all()).results;
  const replyRate = replyRows.map((r) => ({ ...r, rate: r.reached ? r.replied / r.reached : 0 }))
    .sort((a, b) => b.reached - a.reached);

  // 4 ─ Stale prospects: who needs you, who went quiet, what is overdue.
  const active = (await db.prepare(
    `SELECT p.id, p.name, p.company, p.phone, p.rung, p.next_step, p.next_step_at, p.created_at, p.last_message,
            p.last_direction AS last_dir, p.last_channel, p.last_outcome, p.touches, p.touch_channels,
            p.meeting_at, p.met_at, p.last_touch_at,
            (SELECT COUNT(*) FROM events e WHERE e.prospect_id = p.id AND e.channel = 'call'
                AND e.outcome IN ('no_answer','voicemail','gatekeeper')
                AND e.occurred_at > COALESCE((SELECT MAX(x.occurred_at) FROM events x WHERE x.prospect_id = p.id
                    AND (x.direction = 'in' OR x.outcome IN ('connected','callback'))), '')) AS missed_calls
       FROM prospects p WHERE p.status = 'active' AND p.rung >= 1`
  ).all()).results;
  const stale = [];
  const in48h = new Date(now + 2 * DAY).toISOString();
  for (const p of active) {
    const lastAt = p.last_touch_at ? Date.parse(p.last_touch_at) : null;
    const ageDays = lastAt ? (now - lastAt) / DAY : (now - Date.parse(p.created_at)) / DAY;
    let reason = null, priority = 9;
    const unanswered = p.last_channel === 'call' && ['no_answer', 'voicemail', 'gatekeeper'].includes(p.last_outcome);
    if (p.meeting_at && !p.met_at && p.meeting_at <= in48h && p.meeting_at >= new Date(now - DAY).toISOString()) {
      reason = `Meeting ${new Date(Date.parse(p.meeting_at) + tz * 3600_000).toISOString().slice(5, 16).replace('T', ' ')}`; priority = -1;
    }
    else if (p.last_outcome === 'callback' && p.last_channel === 'call') { reason = 'Call back — they asked'; priority = 0; }
    else if (p.last_dir === 'in' && ageDays >= 0.5) { reason = 'You owe a reply'; priority = 0; }
    else if (unanswered && ageDays >= 1) { reason = `Redial — ${p.missed_calls} unanswered`; priority = 1.5; }
    else if (p.next_step_at && p.next_step_at < localToday) { reason = 'Next step overdue'; priority = 1; }
    else if (p.last_dir === 'out' && ageDays >= staleDays) { reason = 'Silent — run the silent track'; priority = 2; }
    else if (!lastAt && ageDays >= staleDays) { reason = 'Never touched'; priority = 3; }
    if (reason) stale.push({ ...p, rung_name: RUNGS[p.rung - 1], reason, priority, days_since: Math.floor(ageDays) });
  }
  stale.sort((a, b) => a.priority - b.priority || b.days_since - a.days_since);

  // 4b ─ Channel mix and phone performance.
  const mixRows = (await db.prepare(
    `SELECT channel, COUNT(*) AS touches, COUNT(DISTINCT prospect_id) AS prospects
       FROM events WHERE direction = 'out' AND prospect_id IS NOT NULL AND occurred_at >= ? GROUP BY channel ORDER BY touches DESC`
  ).bind(since).all()).results;
  const callRows = (await db.prepare(
    `SELECT COALESCE(outcome, 'unlogged') AS outcome, COUNT(*) AS n FROM events
      WHERE channel = 'call' AND direction = 'out' AND occurred_at >= ? GROUP BY outcome ORDER BY n DESC`
  ).bind(since).all()).results;
  const dials = callRows.reduce((t, r) => t + r.n, 0);
  const connects = callRows.filter((r) => ['connected', 'callback'].includes(r.outcome)).reduce((t, r) => t + r.n, 0);
  const calls = {
    dials, connects, connect_rate: dials ? connects / dials : null,
    outcomes: callRows.map((r) => ({ ...r, label: OUTCOMES[r.outcome] || 'Outcome not logged' })),
  };

  const pipeline = RUNGS.map((name, i) => ({ rung: i + 1, name, count: active.filter((p) => p.rung === i + 1).length }));
  const unmatched = (await db.prepare('SELECT COUNT(*) AS n FROM events WHERE prospect_id IS NULL').first()).n;
  const queued = (await db.prepare("SELECT COUNT(*) AS n FROM prospects WHERE status = 'active' AND rung = 0").first()).n;

  // 5 ─ Why deals die (lost in this window).
  const rejRows = (await db.prepare(
    `SELECT COALESCE(rejection_type, 'unspecified') AS type, COUNT(*) AS n,
            ROUND(AVG(rung), 1) AS avg_rung
       FROM prospects WHERE status = 'lost' AND updated_at >= ? GROUP BY type ORDER BY n DESC`
  ).bind(since).all()).results;
  const rejections = rejRows.map((r) => ({ ...r, label: REJECTIONS[r.type] || 'Not specified' }));

  // 6 ─ Which segments convert: every prospect with the furthest rung it reached.
  const segRows = (await db.prepare(
    `SELECT p.industry, p.region, p.batch_id, b.label AS batch_label, p.status, p.qualified_at, p.meeting_agreed_at, p.met_at,
            MAX(p.rung, COALESCE((SELECT MAX(h.to_rung) FROM rung_history h WHERE h.prospect_id = p.id), 0)) AS reached
       FROM prospects p LEFT JOIN batches b ON b.id = p.batch_id WHERE p.created_at >= ?`
  ).bind(since).all()).results;
  const segment = (keyFn) => {
    const m = new Map();
    for (const r of segRows) {
      const k = keyFn(r) || 'Not set';
      const s = m.get(k) || { key: k, leads: 0, touched: 0, replied: 0, qualified: 0, meeting: 0, met: 0, diagnostic: 0, won: 0 };
      s.leads++;
      if (r.reached >= 1) s.touched++;
      if (r.reached >= 2) s.replied++;
      if (r.qualified_at) s.qualified++;
      if (r.meeting_agreed_at || r.met_at) s.meeting++;
      if (r.met_at) s.met++;
      if (r.reached >= 4) s.diagnostic++;
      if (r.status === 'won') s.won++;
      m.set(k, s);
    }
    return [...m.values()].map((s) => ({ ...s, reply_rate: s.touched ? s.replied / s.touched : null }))
      .sort((a, b) => b.leads - a.leads);
  };

  // 7 ─ Conversation-stage funnel for prospects opened in this window.
  const stage = (pred) => segRows.filter(pred).length;
  const funnel = [
    { key: 'touched', name: 'Touched', n: stage((r) => r.reached >= 1) },
    { key: 'replied', name: 'Replied / picked up', n: stage((r) => r.reached >= 2) },
    { key: 'qualified', name: 'Qualified', n: stage((r) => r.qualified_at) },
    { key: 'meeting', name: 'Agreed to meet', n: stage((r) => r.meeting_agreed_at || r.met_at) },
    { key: 'met', name: 'Met', n: stage((r) => r.met_at) },
    { key: 'proposal', name: 'Proposal', n: stage((r) => r.reached >= 5) },
    { key: 'won', name: 'Won', n: stage((r) => r.status === 'won') },
  ];

  return {
    days, target, stale_days: staleDays,
    funnel, channel_mix: mixRows, calls,
    kpis: {
      today: todayRow.total,
      week: weekTotal,
      week_target: target * 5,
      active: active.length,
      proposals_out: pipeline[4].count,
      owe_reply: stale.filter((s) => s.priority <= 0).length,
      dials, connects,
      inbox: unmatched,
      queued,
    },
    rejections,
    by_industry: segment((r) => r.industry),
    by_region: segment((r) => r.region),
    by_batch: segment((r) => r.batch_label).filter((s) => s.key !== 'Not set'),
    ladder, daily, reply_rate: replyRate, stale, pipeline,
  };
}
