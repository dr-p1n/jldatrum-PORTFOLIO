// DATRUM CRM — vanilla front end. Hash routes:
// #/today  #/pipeline  #/p/:id  #/log  #/inbox  #/analytics

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const view = $('#view');
const state = { config: null };

// ── utilities ────────────────────────────────────────
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The CRM is mounted under /admin on the public site, so every API path
// carries that prefix. One constant; nothing else in this file hardcodes it.
const API_BASE = '/admin/api/';

async function api(path, opts = {}) {
  const init = { method: opts.method || 'GET', headers: {} };
  if (opts.body instanceof FormData) init.body = opts.body;
  else if (opts.body !== undefined) { init.body = JSON.stringify(opts.body); init.headers['content-type'] = 'application/json'; }
  const res = await fetch(API_BASE + path, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 409) throw new Error(data.error || `Request failed (${res.status})`);
  return { status: res.status, data };
}

function toast(msg, ms = 3200) {
  const t = document.createElement('div');
  t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

function ago(iso) {
  if (!iso) return 'never';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
const fmtWhen = (iso) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const localInput = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);
const rungName = (r) => (r === 0 ? 'Queue' : state.config?.rungs?.[r - 1] || `Rung ${r}`);
const CH_LABEL = { call: 'Call', whatsapp: 'WhatsApp', email: 'Email', meeting: 'Meeting', note: 'Note' };
// "7 touches · Call 4 · WhatsApp 2 · Email 1"
function touchLine(p) {
  let ch = {}; try { ch = p.touch_channels ? JSON.parse(p.touch_channels) : {}; } catch { /* */ }
  if (!p.touches) return 'No touches yet';
  const parts = Object.entries(ch).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${CH_LABEL[c] || c} ${n}`);
  return `${p.touches} touch${p.touches === 1 ? '' : 'es'} · ${parts.join(' · ')}`;
}
// " · calls: 1 of 4 connected" (prospect page has the full event list)
function callStats(p) {
  const calls = (p.events || []).filter((e) => e.channel === 'call' && e.direction === 'out');
  if (!calls.length) return '';
  const conn = calls.filter((e) => ['connected', 'callback'].includes(e.outcome)).length;
  return ` · calls: ${conn} of ${calls.length} connected`;
}
const shortDay = (iso) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
// Conversation stage, as a short label for lists
function stageLabel(p) {
  if (p.met_at) return 'Met';
  if (p.meeting_at) return `Meeting ${shortDay(p.meeting_at)}`;
  if (p.meeting_agreed_at) return 'Agreed to meet';
  if (p.qualified_at) return 'Qualified';
  return '';
}
const outcomeOptions = (sel = '') => Object.entries(state.config.outcomes).map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${esc(v)}</option>`).join('');
// WhatsApp only works on mobiles: Panama 6xxx-xxxx, or any foreign number
const isMobile = (d) => !d.startsWith('507') || (d.length === 11 && d[3] === '6');
const flagsOf = (p) => { try { return p.flags ? JSON.parse(p.flags) : []; } catch { return []; } };
const fmtPhone = (d) => (!d ? '' : d.startsWith('507') && d.length >= 10 ? `+507 ${d.slice(3, d.length - 4)}-${d.slice(-4)}` : '+' + d);
// "You · 2d ago: Sent the scan findings" — the last message, everywhere a prospect is listed
const lastLine = (p) => p.last_message
  ? `${p.last_direction === 'in' ? 'They' : p.last_direction === 'out' ? 'You' : 'Note'} · ${ago(p.last_touch_at)}: ${p.last_message}`
  : 'No messages yet';

const ICON = {
  email: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3.5" y="6" width="17" height="12" rx="2"/><path d="M4 7l8 6 8-6"/></svg>',
  whatsapp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M5 19l1.2-3.6A7.5 7.5 0 1 1 9 18.2z"/></svg>',
  call: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M6.5 4h3l1.5 4-2 1.2a10 10 0 0 0 5.8 5.8L16 13l4 1.5v3a2 2 0 0 1-2.2 2A15.5 15.5 0 0 1 4.5 6.2 2 2 0 0 1 6.5 4z"/></svg>',
  meeting: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="9" cy="9" r="3"/><circle cx="16.5" cy="10" r="2.5"/><path d="M3.5 19c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5M14.5 15.2c2.6-.5 4.8.8 5.5 3.8"/></svg>',
  note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M6 4h9l3 3v13H6z"/><path d="M9 11h6M9 15h4"/></svg>',
  mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M6 11a6 6 0 0 0 12 0M12 17v3.5"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
};

// ── tooltip for charts ───────────────────────────────
const tip = $('#tip');
function showTip(e, html) {
  tip.innerHTML = html; tip.classList.remove('hidden');
  const r = tip.getBoundingClientRect();
  let x = e.clientX + 14, y = e.clientY + 14;
  if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
  if (y + r.height > innerHeight - 8) y = e.clientY - r.height - 14;
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
}
const hideTip = () => tip.classList.add('hidden');

// ── router ───────────────────────────────────────────
const routes = {
  today: viewToday,
  leads: viewLeads,
  pipeline: viewPipeline,
  p: viewProspect,
  log: viewLog,
  inbox: viewInbox,
  analytics: viewAnalytics,
};

async function router() {
  hideTip();
  const [path, query] = (location.hash.slice(2) || 'today').split('?');
  const [name, arg] = path.split('/');
  const params = new URLSearchParams(query || '');
  $$('.nav a').forEach((a) => a.toggleAttribute('aria-current', a.dataset.nav === name || (name === 'p' && a.dataset.nav === 'pipeline')));
  $$('.nav a[aria-current]').forEach((a) => a.setAttribute('aria-current', 'page'));
  const fn = routes[name] || viewToday;
  view.innerHTML = '<p class="faint">Loading…</p>';
  try { await fn(arg, params); } catch (err) { view.innerHTML = `<div class="panel"><h2>Something broke</h2><p class="muted">${esc(err.message)}</p></div>`; }
  view.focus({ preventScroll: true });
  refreshInboxBadge();
}

async function refreshInboxBadge() {
  try {
    const [{ data: inbox }, { data: q }] = await Promise.all([api('inbox'), api('prospects?status=queue')]);
    $('#inbox-badge').textContent = inbox.length ? inbox.length : '';
    $('#queue-badge').textContent = q.length ? q.length : '';
  } catch { /* ignore */ }
}

// ── prospect picker (search existing / create new) ───
function mountPicker(el, { onPick, initial = null, allowCreate = true }) {
  let chosen = initial;
  const render = () => {
    if (chosen) {
      el.innerHTML = `<div class="chosen"><span class="one-line"><b>${esc(chosen.name)}</b> <span class="faint">${esc(chosen.company || '')}</span></span><span class="spacer"></span><button type="button" class="btn ghost" data-act="change">Change</button></div>`;
      $('[data-act=change]', el).onclick = () => { chosen = null; onPick(null); render(); $('input', el)?.focus(); };
      return;
    }
    el.innerHTML = `<div class="picker"><input type="search" placeholder="Search prospects by name, company, phone…" aria-label="Prospect" autocomplete="off"><ul class="hidden" role="listbox"></ul></div>`;
    const input = $('input', el), list = $('ul', el);
    let t;
    input.oninput = () => {
      clearTimeout(t);
      t = setTimeout(async () => {
        const q = input.value.trim();
        if (!q) { list.classList.add('hidden'); return; }
        const { data } = await api('prospects?status=all&q=' + encodeURIComponent(q));
        list.innerHTML = data.slice(0, 8).map((p) => `<li><button type="button" data-id="${p.id}"><span class="one-line">${esc(p.name)} <span class="faint">${esc(p.company || '')}</span></span><span class="faint tiny">${esc(rungName(p.rung))}</span></button></li>`).join('') +
          (allowCreate ? `<li><button type="button" data-new="1"><span class="one-line">New prospect “${esc(q)}”</span><span class="faint tiny">create</span></button></li>` : '');
        list.classList.remove('hidden');
        $$('button[data-id]', list).forEach((b) => (b.onclick = () => { chosen = data.find((p) => p.id == b.dataset.id); onPick(chosen); render(); }));
        const nb = $('button[data-new]', list);
        if (nb) nb.onclick = async () => {
          const { status, data: p } = await api('prospects', { method: 'POST', body: { name: q } });
          chosen = status === 409 ? p.duplicate : p; onPick(chosen); render();
        };
      }, 160);
    };
  };
  render();
}

// ═════════════════════════════════════════════════════
// TODAY — the action queue
// ═════════════════════════════════════════════════════
async function viewToday() {
  const { data: a } = await api('analytics?days=7');
  const k = a.kpis;
  const queue = a.stale.slice(0, 12);
  view.innerHTML = `
    <div class="page-head">
      <div><h1>Today</h1><p class="muted">${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p></div>
      <div class="row"><a class="btn primary" href="#/log">${ICON.arrow} Log something</a></div>
    </div>
    <div class="kpis">
      <div class="kpi hero"><div class="v">${k.today} <small>of ${a.target} touches</small></div><div class="l">Prospects reached today</div></div>
      <div class="kpi"><div class="v">${k.owe_reply}</div><div class="l">Owe a reply</div></div>
      <div class="kpi"><div class="v">${k.queued}</div><div class="l"><a href="#/leads">Leads in queue</a></div></div>
      <div class="kpi"><div class="v">${k.proposals_out}</div><div class="l">Proposals out</div></div>
    </div>
    <div class="today">
      <section class="panel">
        <div class="panel-head"><h2>Who needs you</h2><span class="faint small">${a.stale.length} total</span></div>
        ${queue.length ? `<ul class="list">${queue.map((s) => `
          <li><a href="#/p/${s.id}">
            <span class="one-line">${esc(s.name)} <span class="faint">· ${esc(s.last_message || s.company || s.rung_name)}</span></span>
            <span class="reason ${s.priority > 1 ? 'calm' : ''}">${esc(s.reason)} · ${s.days_since}d</span>
          </a></li>`).join('')}</ul>` : '<p class="empty">Nobody is waiting on you. Go start new conversations.</p>'}
      </section>
      <aside class="stack">
        <section class="panel">
          <h3>Log email automatically</h3>
          <p class="muted small">BCC this address when you email a prospect. Forward their replies to it.</p>
          <div class="row"><span class="mono one-line" id="logaddr">${esc(state.config.log_address)}</span><button class="btn ghost" id="copy">Copy</button></div>
        </section>
        <section class="panel">
          <h3>This week</h3>
          <p class="muted small" style="margin:4px 0 0">${k.week} touches against a ${k.week_target} weekday target · ${k.active} active prospects</p>
        </section>
      </aside>
    </div>`;
  $('#copy').onclick = async () => { await navigator.clipboard.writeText(state.config.log_address); toast('Address copied'); };
}

// ═════════════════════════════════════════════════════
// PIPELINE
// ═════════════════════════════════════════════════════
async function viewPipeline(_, params) {
  const status = params.get('status') || 'active';
  const q = params.get('q') || '';
  const { data } = await api(`prospects?status=${status}&q=${encodeURIComponent(q)}`);
  const rungs = state.config.rungs;
  view.innerHTML = `
    <div class="page-head">
      <div><h1>Pipeline</h1><p class="muted">${data.length} ${status === 'all' ? '' : status} prospects</p></div>
      <div class="row">
        <div class="seg" role="group" aria-label="Status">${['active', 'won', 'lost', 'all'].map((s) => `<button data-s="${s}" aria-pressed="${s === status}">${s[0].toUpperCase() + s.slice(1)}</button>`).join('')}</div>
        <button class="btn primary" id="new">New prospect</button>
      </div>
    </div>
    <div class="row" style="margin-bottom:16px"><input type="search" id="q" placeholder="Filter by name, company, industry, region, phone…" value="${esc(q)}" style="max-width:420px"></div>
    <div id="newform"></div>
    <div class="board">
      ${rungs.map((name, i) => {
        const items = data.filter((p) => p.rung === i + 1);
        return `<div class="col"><h3><span>${i + 1} · ${esc(name)}</span><span>${items.length}</span></h3>
          ${items.map((p) => `<a class="card" href="#/p/${p.id}"><div class="n one-line">${esc(p.name)}</div><div class="c one-line">${esc(p.company && p.company !== p.name ? p.company : p.industry || '—')}</div><div class="c one-line ${p.last_direction === 'in' ? 'theirs' : ''}">${esc(lastLine(p))}</div><div class="c one-line tiny">${esc([stageLabel(p), p.touches ? touchLine(p) : ''].filter(Boolean).join(' · '))}</div></a>`).join('') || '<p class="faint small">—</p>'}
        </div>`;
      }).join('')}
    </div>`;
  $$('.seg button').forEach((b) => (b.onclick = () => (location.hash = `#/pipeline?status=${b.dataset.s}&q=${encodeURIComponent($('#q').value)}`)));
  $('#q').onkeydown = (e) => { if (e.key === 'Enter') location.hash = `#/pipeline?status=${status}&q=${encodeURIComponent(e.target.value)}`; };
  $('#new').onclick = () => renderNewProspect($('#newform'));
}

function prospectFields(p = {}) {
  return `
    <div class="grid-2">
      <label class="field">Contact name<input type="text" name="name" value="${esc(p.name)}" required></label>
      <label class="field">Company<input type="text" name="company" value="${esc(p.company)}"></label>
      <label class="field">WhatsApp / phone<input type="tel" name="phone" value="${esc(p.phone ? fmtPhone(p.phone) : '')}" placeholder="6123-4567"></label>
      <label class="field">Email<input type="email" name="email" value="${esc(p.email)}"></label>
      <label class="field">Website<input type="text" name="website" value="${esc(p.website)}" placeholder="firm.com.pa"></label>
      <label class="field">Industry<input type="text" name="industry" value="${esc(p.industry)}" placeholder="Law, insurance, real estate…" list="dl-industry"></label>
      <label class="field">Focus<input type="text" name="focus" value="${esc(p.focus)}" placeholder="Specialty inside the industry"></label>
      <label class="field">Region<input type="text" name="region" value="${esc(p.region)}" placeholder="Panama City, Chiriquí, Colón…" list="dl-region"></label>
      <label class="field">Type<select name="kind"><option value="">—</option><option value="vampire" ${p.kind === 'vampire' ? 'selected' : ''}>Vampire (exists, invisible)</option><option value="ghost" ${p.kind === 'ghost' ? 'selected' : ''}>Ghost (no presence)</option></select></label>
    </div>
    <datalist id="dl-industry">${(state.facets?.industry || []).map((v) => `<option value="${esc(v)}">`).join('')}</datalist>
    <datalist id="dl-region">${(state.facets?.region || []).map((v) => `<option value="${esc(v)}">`).join('')}</datalist>`;
}

function renderNewProspect(el) {
  el.innerHTML = `<form class="panel" style="margin-bottom:16px"><div class="panel-head"><h2>New prospect</h2><button type="button" class="btn ghost" id="x">Cancel</button></div>
    ${prospectFields()}
    <label class="field" style="margin-top:12px">Notes<textarea name="notes" style="min-height:80px"></textarea></label>
    <div class="row" style="margin-top:16px"><button class="btn primary">Save</button><span class="faint small" id="dupe"></span></div></form>`;
  $('#x', el).onclick = () => (el.innerHTML = '');
  $('form', el).onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    const { status, data } = await api('prospects', { method: 'POST', body });
    if (status === 409) { $('#dupe', el).innerHTML = `Already exists: <a href="#/p/${data.duplicate.id}">${esc(data.duplicate.name)}</a>`; return; }
    location.hash = `#/p/${data.id}`;
  };
  $('input', el).focus();
}

async function viewProspect(id) {
  const { data: p } = await api('prospects/' + id);
  const rungs = state.config.rungs;
  const rej = state.config.rejections;
  const flags = flagsOf(p);
  const wa = p.phone ? `https://wa.me/${p.phone}` : null;
  const mail = p.email ? `mailto:${encodeURIComponent(p.email)}?bcc=${encodeURIComponent(state.config.log_address)}` : null;
  const sub = [p.company && p.company !== p.name ? p.company : null, p.industry, p.focus, p.region].filter(Boolean).join(' · ');

  view.innerHTML = `
    <div class="page-head">
      <div><h1>${esc(p.name)}</h1><p class="muted">${esc(sub || 'No company yet')}</p></div>
      <div class="row">
        ${p.status === 'active'
          ? `<button class="btn" data-status="won">Mark won</button><button class="btn ghost" id="lose">Mark lost</button>`
          : `<span class="muted">${p.status === 'won' ? 'Won' : 'Lost — ' + esc(rej[p.rejection_type] || 'no reason given')}</span><button class="btn ghost" data-status="active">Reopen</button>`}
      </div>
    </div>
    <form class="panel hidden" id="loseform" style="margin-bottom:16px">
      <div class="panel-head"><h2>Why was it lost?</h2></div>
      <div class="grid-2">
        <label class="field">Rejection type<select name="rejection_type" required>${Object.entries(rej).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></label>
        <label class="field">In their words (optional)<input type="text" name="rejection_note" placeholder="“Nuestro equipo interno de IA lo maneja”"></label>
      </div>
      <div class="row" style="margin-top:12px"><button class="btn primary">Mark lost</button><button type="button" class="btn ghost" id="loseX">Cancel</button></div>
    </form>
    <div class="detail">
      <div class="stack">
        <section class="panel">
          <div class="panel-head"><h2>Ladder</h2><span class="faint small">${p.rung === 0 ? 'In queue — not contacted yet' : esc(rungName(p.rung))}</span></div>
          <div class="ladder" role="group" aria-label="Ladder rung">${rungs.map((r, i) => `<button data-rung="${i + 1}" class="${i + 1 < p.rung ? 'done' : i + 1 === p.rung ? 'current' : ''}" aria-pressed="${i + 1 === p.rung}">${esc(r)}</button>`).join('')}</div>
          <p class="small" style="margin:12px 0 0"><span class="faint">Last message:</span> ${esc(lastLine(p))}</p>
          <p class="small" style="margin:4px 0 0"><span class="faint">Touches:</span> ${esc(touchLine(p))}${callStats(p)}</p>
          <div class="stages" role="group" aria-label="Conversation stage">
            ${[
              ['qualified_at', 'Qualified', 'Budget and decision-maker confirmed'],
              ['meeting_agreed_at', 'Agreed to meet', 'They said yes to a meeting'],
              ['met_at', 'Met', 'The meeting happened'],
            ].map(([k, label, hint]) => `<button type="button" class="stage ${p[k] ? 'on' : ''}" data-stage="${k}" aria-pressed="${!!p[k]}" title="${hint}">
                <span class="tick" aria-hidden="true">${p[k] ? '✓' : ''}</span><span>${label}</span><span class="faint tiny">${p[k] ? shortDay(p[k]) : ''}</span></button>`).join('')}
            <label class="field stage-when">Meeting on<input type="datetime-local" id="meeting_at" value="${p.meeting_at ? localInput(new Date(p.meeting_at)) : ''}"></label>
          </div>
          <form id="next" class="grid-2" style="margin-top:12px">
            <label class="field">Next step<input type="text" name="next_step" value="${esc(p.next_step)}" placeholder="Send diagnostic questions"></label>
            <label class="field">By<input type="date" name="next_step_at" value="${esc(p.next_step_at || '')}"></label>
          </form>
          <label class="field" style="margin-top:12px">Finding to lead with (verifiable on their own screen)
            <input type="text" id="finding" value="${esc(p.finding)}" placeholder="No aparecen en Google Maps para “abogados en Panamá”"></label>
          ${p.status === 'lost' && p.rejection_note ? `<p class="small muted" style="margin:12px 0 0">They said: “${esc(p.rejection_note)}”</p>` : ''}
        </section>
        <section class="panel">
          <div class="panel-head"><h2>Timeline</h2><a class="btn ghost" href="#/log?p=${p.id}">Paste a chat</a></div>
          <form id="quick" class="stack" style="gap:8px;margin-bottom:16px">
            <div class="row">
              <select name="channel" style="width:auto"><option value="whatsapp">WhatsApp</option><option value="call">Call</option><option value="email">Email</option><option value="meeting">Meeting</option><option value="note">Note</option></select>
              <select name="direction" style="width:auto"><option value="out">I reached out</option><option value="in">They reached out</option><option value="none">No direction</option></select>
              <select name="outcome" id="q-outcome" class="hidden" style="width:auto"><option value="">Call result…</option>${outcomeOptions()}</select>
              <input type="datetime-local" name="occurred_at" value="${localInput()}" style="width:auto">
            </div>
            <div class="row"><input type="text" name="summary" id="q-summary" placeholder="What happened?" required style="flex:1"><button class="btn primary">Add</button></div>
          </form>
          ${p.events.length ? `<ul class="timeline">${p.events.map((e) => `
            <li>
              <span class="ico ${e.direction === 'in' ? 'in' : ''}" title="${esc(e.channel)} · ${e.direction === 'in' ? 'inbound' : e.direction === 'out' ? 'outbound' : ''}">${ICON[e.channel] || ICON.note}</span>
              <div style="min-width:0">
                <div>${esc(e.summary || '(no summary)')}</div>
                <div class="faint small">${esc(e.channel)}${e.outcome ? ' · ' + esc(state.config.outcomes[e.outcome] || e.outcome) : ''} · ${e.direction === 'in' ? 'from them' : e.direction === 'out' ? 'from you' : 'note'} · ${fmtWhen(e.occurred_at)}</div>
                ${e.body ? `<details><summary>Full text</summary><pre>${esc(e.body)}</pre></details>` : ''}
              </div>
              <button class="btn ghost small" data-del="${e.id}" aria-label="Delete event">Delete</button>
            </li>`).join('')}</ul>` : '<p class="empty">No touches yet.</p>'}
        </section>
      </div>
      <aside class="stack">
        <section class="panel">
          <h3>Contact</h3>
          <p class="muted small" style="margin:8px 0 0">${p.phone ? esc(fmtPhone(p.phone)) : 'No phone'}<br>${esc(p.email || 'No email')}${p.website ? `<br><a href="https://${esc(p.website)}" target="_blank" rel="noopener">${esc(p.website)}</a>` : ''}</p>
          ${flags.length ? `<ul class="flags">${flags.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
          <div class="contact-actions">
            ${wa && isMobile(p.phone) ? `<a class="btn" href="${wa}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
            ${p.phone ? `<a class="btn" href="tel:+${esc(p.phone)}">Call</a>` : ''}
            ${mail ? `<a class="btn" href="${mail}">Email (auto-logged)</a>` : ''}
          </div>
        </section>
        <section class="panel">
          <h3>Notes</h3>
          <textarea id="notes" style="min-height:120px;margin-top:8px" placeholder="Anything worth remembering — saved when you leave the box">${esc(p.notes)}</textarea>
        </section>
        <form class="panel" id="edit">
          <div class="panel-head"><h3>Details</h3></div>
          ${prospectFields(p)}
          <div class="row" style="margin-top:12px"><button class="btn">Save details</button><span class="spacer"></span><button type="button" class="btn ghost danger" id="del">Delete</button></div>
        </form>
      </aside>
    </div>`;

  const patch = async (body, msg, rerender = true) => {
    await api('prospects/' + p.id, { method: 'PATCH', body });
    if (msg) toast(msg);
    if (rerender) viewProspect(p.id);
  };
  $$('[data-rung]').forEach((b) => (b.onclick = () => patch({ rung: +b.dataset.rung }, `Moved to ${rungName(+b.dataset.rung)}`)));
  // stage toggles: on = stamped now, off = cleared
  $$('[data-stage]').forEach((b) => (b.onclick = () => {
    const k = b.dataset.stage;
    const body = { [k]: p[k] ? null : new Date().toISOString() };
    if (k === 'met_at' && !p[k] && !p.meeting_agreed_at) body.meeting_agreed_at = body.met_at;
    patch(body);
  }));
  $('#meeting_at').onchange = (e) => {
    const v = e.target.value ? new Date(e.target.value).toISOString() : null;
    const body = { meeting_at: v };
    if (v && !p.meeting_agreed_at) body.meeting_agreed_at = new Date().toISOString();
    if (v) { body.next_step = p.next_step || 'Meeting'; body.next_step_at = e.target.value.slice(0, 10); }
    patch(body, v ? 'Meeting scheduled' : 'Meeting cleared');
  };
  const qch = $('#quick [name=channel]');
  const syncOutcome = () => {
    const isCall = qch.value === 'call';
    $('#q-outcome').classList.toggle('hidden', !isCall);
    $('#q-summary').required = !isCall; // a call result alone is enough
  };
  qch.onchange = syncOutcome; syncOutcome();
  $$('[data-status]').forEach((b) => (b.onclick = () => patch({ status: b.dataset.status })));
  const lose = $('#lose');
  if (lose) lose.onclick = () => { $('#loseform').classList.remove('hidden'); $('#loseform select').focus(); };
  $('#loseX').onclick = () => $('#loseform').classList.add('hidden');
  $('#loseform').onsubmit = (e) => { e.preventDefault(); patch({ status: 'lost', ...Object.fromEntries(new FormData(e.target)) }, 'Marked lost'); };
  $$('#next input').forEach((i) => (i.onchange = () => patch(Object.fromEntries(new FormData($('#next'))), 'Next step saved')));
  $('#finding').onchange = (e) => patch({ finding: e.target.value }, 'Finding saved', false);
  $('#notes').onchange = (e) => patch({ notes: e.target.value }, 'Notes saved', false);
  $('#edit').onsubmit = (e) => { e.preventDefault(); patch(Object.fromEntries(new FormData(e.target)), 'Saved'); };
  $('#del').onclick = async () => {
    if (!confirm(`Delete ${p.name} and their whole timeline? This cannot be undone.`)) return;
    await api('prospects/' + p.id, { method: 'DELETE' }); location.hash = '#/pipeline';
  };
  $('#quick').onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    body.prospect_id = p.id; body.occurred_at = new Date(body.occurred_at).toISOString();
    if (body.channel !== 'call' || !body.outcome) delete body.outcome;
    if (body.channel === 'call' && !body.outcome && !body.summary) return toast('Pick the call result or write what happened');
    await api('events', { method: 'POST', body }); toast('Logged'); viewProspect(p.id);
  };
  $$('[data-del]').forEach((b) => (b.onclick = async () => {
    if (!confirm('Delete this event?')) return;
    await api('events/' + b.dataset.del, { method: 'DELETE' }); viewProspect(p.id);
  }));
}

// ═════════════════════════════════════════════════════
// LEADS — daily batches in, today's queue out
// ═════════════════════════════════════════════════════
async function viewLeads(_, params) {
  const { data: q } = await api('queue');
  const left = Math.max(0, q.target - q.touched_today);
  view.innerHTML = `
    <div class="page-head">
      <div><h1>Leads</h1><p class="muted">${q.leads.length} researched, not contacted yet · ${q.touched_today} of ${q.target} touches today</p></div>
      <button class="btn primary" id="imp">Import a batch</button>
    </div>
    <div id="importer" class="${params.get('import') ? '' : 'hidden'}"></div>
    <section class="panel">
      <div class="panel-head"><h2>Today’s queue</h2><span class="faint small">${left ? `Next ${Math.min(left, q.leads.length)} to reach your target` : 'Target hit — anything more is a bonus'}</span></div>
      ${q.leads.length ? `<ul class="list">${q.leads.map((l, i) => {
        const f = flagsOf(l);
        const warn = f.find((x) => /Placeholder|No usable|Foreign/.test(x));
        return `<li class="${i === Math.min(left, q.leads.length) && left ? 'cut' : ''}"><div class="item queue-item">
          <a href="#/p/${l.id}" class="one-line" style="padding:0;display:block">${esc(l.company || l.name)} <span class="faint">· ${esc(l.focus || l.industry || l.batch_label || '')}</span></a>
          <div class="row queue-actions">
            ${warn ? `<span class="reason" title="${esc(warn)}">Verify</span>` : ''}
            ${l.phone && isMobile(l.phone) ? `<a class="btn ghost" href="https://wa.me/${esc(l.phone)}" target="_blank" rel="noopener">WhatsApp</a>` : l.phone ? `<a class="btn ghost" href="tel:+${esc(l.phone)}">Call</a>` : ''}
            ${l.email ? `<a class="btn ghost" href="mailto:${encodeURIComponent(l.email)}?bcc=${encodeURIComponent(state.config.log_address)}">Email</a>` : ''}
            ${l.phone && !isMobile(l.phone)
              ? `<select class="call-result" data-call="${l.id}" aria-label="Log call result"><option value="">Log call…</option>${outcomeOptions()}</select>`
              : `<button class="btn" data-sent="${l.id}">Sent</button>`}
          </div>
        </div></li>`;
      }).join('')}</ul>` : '<p class="empty">Queue is empty. Import today’s batch to start.</p>'}
    </section>`;
  $('#imp').onclick = () => { const box = $('#importer'); box.classList.toggle('hidden'); if (!box.innerHTML) renderImporter(box); };
  if (params.get('import')) renderImporter($('#importer'));
  // "Sent" = I contacted them on WhatsApp → first outbound touch, lead moves Queue → Touch.
  // Phone-first: one pick logs the dial and its result; any dial moves the lead Queue → Touch.
  $$('[data-call]').forEach((sel) => (sel.onchange = async () => {
    if (!sel.value) return;
    const lead = q.leads.find((l) => l.id == sel.dataset.call);
    await api('events', { method: 'POST', body: { prospect_id: lead.id, channel: 'call', direction: 'out', outcome: sel.value } });
    sel.closest('li').remove();
    toast(`${lead.company || lead.name}: ${state.config.outcomes[sel.value]}`);
    if (['connected', 'callback'].includes(sel.value)) location.hash = `#/p/${lead.id}`; // add what was said
    refreshInboxBadge();
  }));
  $$('[data-sent]').forEach((b) => (b.onclick = async () => {
    const lead = q.leads.find((l) => l.id == b.dataset.sent);
    const channel = lead.phone && isMobile(lead.phone) ? 'whatsapp' : lead.phone ? 'call' : 'email';
    await api('events', { method: 'POST', body: { prospect_id: lead.id, channel, direction: 'out', summary: lead.finding ? `First touch: ${lead.finding}` : 'First touch' } });
    b.closest('li').remove();
    toast(`${lead.company || lead.name} → Touch`);
    refreshInboxBadge();
  }));
}

function renderImporter(el) {
  el.innerHTML = `
    <section class="panel stack" style="margin-bottom:16px">
      <div class="panel-head"><h2>Import a batch</h2><span class="faint small">CSV, a table copied from Sheets, or a table pasted from Gemini / Manus</span></div>
      <textarea id="batch" placeholder="ID,Firm Name,Focus Area,Primary Email,WhatsApp Contact,Office Telephone&#10;CRM-01,…"></textarea>
      <div class="grid-3">
        <label class="field">Batch name<input type="text" id="b-label" value="${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} batch"></label>
        <label class="field">Industry (whole batch)<input type="text" id="b-industry" list="dl-industry" placeholder="Corporate services"></label>
        <label class="field">Region (whole batch)<input type="text" id="b-region" list="dl-region" placeholder="Panama City"></label>
      </div>
      <div class="row">
        <label class="field" style="display:flex;gap:8px;align-items:center">Source
          <select id="b-source" style="width:auto"><option>gemini</option><option>manus</option><option>scanner</option><option>chatgpt</option><option>referral</option><option>manual</option></select></label>
        <label class="btn ghost">Attach .csv<input type="file" id="b-file" accept=".csv,.tsv,.txt,text/csv" class="sr-only"></label>
        <span class="spacer"></span>
        <button class="btn primary" id="b-read">Check batch</button>
      </div>
      <datalist id="dl-industry">${(state.facets?.industry || []).map((v) => `<option value="${esc(v)}">`).join('')}</datalist>
      <datalist id="dl-region">${(state.facets?.region || []).map((v) => `<option value="${esc(v)}">`).join('')}</datalist>
    </section>
    <div id="b-preview"></div>`;
  $('#b-file', el).onchange = async (e) => { const f = e.target.files[0]; if (f) $('#batch', el).value = await f.text(); };
  $('#b-read', el).onclick = async () => {
    try {
      const { data } = await api('import/preview', { method: 'POST', body: { text: $('#batch', el).value, industry: $('#b-industry', el).value, region: $('#b-region', el).value } });
      renderBatchPreview($('#b-preview', el), data, el);
    } catch (err) { toast(err.message, 5000); }
  };
}

function renderBatchPreview(el, data, root) {
  const leads = data.leads.map((l) => ({ ...l, keep: !l.duplicate && !l.duplicate_in_batch && !!(l.phone || l.email) }));
  const unmapped = data.columns.filter((c) => !c.field).map((c) => c.header);
  const draw = () => {
    const n = leads.filter((l) => l.keep).length;
    el.innerHTML = `
      <section class="panel" style="margin-bottom:16px">
        <div class="panel-head"><h2>${data.leads.length} leads read</h2><span class="faint small">${n} selected</span></div>
        <p class="small muted" style="margin:0 0 12px">Columns: ${data.columns.map((c) => `${esc(c.header)} → <b>${esc(c.field || 'notes')}</b>`).join(' · ')}${unmapped.length ? ' (unrecognised columns go to notes)' : ''}</p>
        <div class="table-scroll"><table class="data-table import-table">
          <thead><tr><th></th><th>Company</th><th>Phone used</th><th>Email</th><th>Check</th></tr></thead>
          <tbody>${leads.map((l, i) => `<tr class="${l.keep ? '' : 'off'}">
            <td><input type="checkbox" data-i="${i}" ${l.keep ? 'checked' : ''} aria-label="Import ${esc(l.company)}"></td>
            <td><div class="one-line" style="max-width:260px">${esc(l.company || l.name)}</div><div class="faint tiny one-line" style="max-width:260px">${esc(l.focus || '')}</div></td>
            <td>${l.phone ? esc(fmtPhone(l.phone)) : '<span class="faint">—</span>'}</td>
            <td><div class="one-line" style="max-width:220px">${esc(l.email || '—')}</div></td>
            <td class="checks">${l.duplicate ? `<div class="reason">Already in CRM: <a href="#/p/${l.duplicate.id}">${esc(l.duplicate.company || l.duplicate.name)}</a> (${esc(l.duplicate.status === 'active' ? rungName(l.duplicate.rung) : l.duplicate.status)})</div>` : ''}
              ${l.duplicate_in_batch ? `<div class="reason">Repeats ${esc(l.duplicate_in_batch)} in this batch</div>` : ''}
              ${l.flags.map((f) => `<div class="${/Placeholder|No usable|Foreign/.test(f) ? 'reason' : 'faint'} tiny">${esc(f)}</div>`).join('')}</td>
          </tr>`).join('')}</tbody>
        </table></div>
        <div class="row" style="margin-top:16px"><button class="btn primary" id="b-commit" ${n ? '' : 'disabled'}>Add ${n} to the queue</button><span class="faint small">Duplicates and leads with no phone or email start unticked.</span></div>
      </section>`;
    $$('input[data-i]', el).forEach((c) => (c.onchange = () => { leads[c.dataset.i].keep = c.checked; draw(); }));
    $('#b-commit', el).onclick = async () => {
      const body = {
        label: $('#b-label', root).value, industry: $('#b-industry', root).value || null,
        region: $('#b-region', root).value || null, source: $('#b-source', root).value,
        leads: leads.filter((l) => l.keep).map(({ keep, duplicate, duplicate_in_batch, ...l }) => l),
      };
      const { data: r } = await api('import/commit', { method: 'POST', body });
      toast(`${r.imported} leads queued${r.skipped ? ` · ${r.skipped} skipped as duplicates` : ''}`);
      await loadFacets();
      viewLeads(null, new URLSearchParams());
      refreshInboxBadge();
    };
  };
  draw();
}

async function loadFacets() {
  try {
    const { data } = await api('prospects?status=all');
    const uniq = (k) => [...new Set(data.map((p) => p[k]).filter(Boolean))].sort();
    state.facets = { industry: uniq('industry'), region: uniq('region') };
  } catch { state.facets = { industry: [], region: [] }; }
}

// ═════════════════════════════════════════════════════
// LOG — paste a chat, or log a call / meeting / note
// ═════════════════════════════════════════════════════
async function viewLog(_, params) {
  const mode = params.get('mode') || 'chat';
  const shared = sessionStorage.getItem('shared-text') || '';
  sessionStorage.removeItem('shared-text');
  let preset = null;
  if (params.get('p')) preset = (await api('prospects/' + params.get('p'))).data;

  view.innerHTML = `
    <div class="page-head">
      <div><h1>Log</h1><p class="muted">Paste it, say it, or type it. You confirm; the CRM files it.</p></div>
      <div class="seg" role="group" aria-label="What are you logging">
        <button data-m="chat" aria-pressed="${mode === 'chat'}">WhatsApp chat</button>
        <button data-m="call" aria-pressed="${mode === 'call'}">Call / meeting / note</button>
      </div>
    </div>
    <div id="logbody"></div>`;
  $$('[data-m]').forEach((b) => (b.onclick = () => (location.hash = `#/log?mode=${b.dataset.m}${preset ? '&p=' + preset.id : ''}`)));
  if (mode === 'chat') renderChatLog($('#logbody'), preset, shared);
  else renderCallLog($('#logbody'), preset);
}

function renderChatLog(el, preset, shared) {
  el.innerHTML = `
    <section class="panel stack">
      <label class="field">Paste messages (select them in WhatsApp → Copy), or attach an exported chat
        <textarea id="chat" placeholder="[10/10/26, 3:41 p. m.] Jelv: Hola…">${esc(shared)}</textarea></label>
      <div class="row">
        <label class="btn ghost">Attach .txt export<input type="file" id="file" accept=".txt,text/plain" class="sr-only"></label>
        <span class="spacer"></span>
        <button class="btn primary" id="parse">Read conversation</button>
      </div>
    </section>
    <div id="preview"></div>`;
  $('#file').onchange = async (e) => { const f = e.target.files[0]; if (f) $('#chat').value = await f.text(); };
  $('#parse').onclick = async () => {
    const btn = $('#parse'); btn.disabled = true; btn.textContent = 'Reading…';
    try {
      const { data } = await api('parse/conversation', { method: 'POST', body: { text: $('#chat').value, prospect_id: preset?.id } });
      renderChatPreview($('#preview'), data, preset);
    } catch (err) { toast(err.message); }
    btn.disabled = false; btn.textContent = 'Read conversation';
  };
  if (shared) $('#parse').click();
}

function renderChatPreview(el, data, preset) {
  const ai = data.ai || {};
  let prospect = preset || data.match || null;
  const events = data.events.map((e) => ({ ...e, keep: true }));
  const suggested = Math.max(prospect?.rung || 1, ai.suggested_rung || 1);

  el.innerHTML = `
    <section class="panel stack" style="margin-top:16px">
      <div class="panel-head"><h2>Check before saving</h2><span class="faint small">${data.parsed_messages ? `${data.parsed_messages} messages → ${events.length} touches` : 'No timestamps found — logged as one touch'}</span></div>
      ${ai.summary ? `<p class="ai-note"><b>Read:</b> ${esc(ai.summary)}${ai.explicit_no ? ' <b>— reads as a clear no.</b>' : ''}</p>` : ''}
      <div>
        <div class="faint small" style="margin-bottom:6px">Prospect</div>
        <div id="pick"></div>
        <div id="newp" class="${prospect ? 'hidden' : ''}" style="margin-top:12px">
          <p class="faint small" style="margin:0 0 8px">No match found — this creates a new prospect:</p>
          <div class="grid-3">
            <label class="field">Name<input type="text" name="name" value="${esc(ai.contact_name || data.contact_name || '')}"></label>
            <label class="field">Company<input type="text" name="company" value="${esc(ai.company || '')}"></label>
            <label class="field">Phone<input type="tel" name="phone" value="${esc(data.phone || '')}"></label>
          </div>
        </div>
      </div>
      <div>
        <div class="faint small" style="margin-bottom:6px">Touches · tap the arrow to flip who sent it</div>
        <div id="evs">${events.map((e, i) => `
          <div class="preview-ev">
            <input type="checkbox" data-i="${i}" checked aria-label="Include">
            <button type="button" class="dir ${e.direction}" data-flip="${i}">${e.direction === 'in' ? 'In' : 'Out'}</button>
            <span class="one-line">${esc(e.summary)}</span>
            <span class="faint small">${fmtWhen(e.occurred_at)}</span>
          </div>`).join('')}</div>
      </div>
      <div class="grid-3">
        <label class="field">Ladder rung<select id="rung">${state.config.rungs.map((r, i) => `<option value="${i + 1}" ${i + 1 === suggested ? 'selected' : ''}>${i + 1} · ${esc(r)}</option>`).join('')}</select></label>
        <label class="field">Next step<input type="text" id="ns" value="${esc(ai.next_step || '')}"></label>
        <label class="field">By<input type="date" id="nsat"></label>
      </div>
      <div class="row"><button class="btn primary" id="save">Save to CRM</button></div>
    </section>`;

  mountPicker($('#pick', el), { initial: prospect, onPick: (p) => { prospect = p; $('#newp', el).classList.toggle('hidden', !!p); } });
  $$('[data-flip]', el).forEach((b) => (b.onclick = () => {
    const ev = events[b.dataset.flip]; ev.direction = ev.direction === 'in' ? 'out' : 'in';
    b.className = 'dir ' + ev.direction; b.textContent = ev.direction === 'in' ? 'In' : 'Out';
  }));
  $$('#evs input[type=checkbox]', el).forEach((c) => (c.onchange = () => (events[c.dataset.i].keep = c.checked)));

  $('#save', el).onclick = async () => {
    const body = {
      events: events.filter((e) => e.keep).map(({ channel, direction, occurred_at, summary, body }) => ({ channel, direction, occurred_at, summary, body })),
      rung: +$('#rung', el).value,
      next_step: $('#ns', el).value || undefined,
      next_step_at: $('#nsat', el).value || undefined,
      explicit_no: !!ai.explicit_no,
    };
    if (prospect) body.prospect_id = prospect.id;
    else body.prospect = Object.fromEntries($$('#newp input', el).map((i) => [i.name, i.value]));
    try {
      const { data: r } = await api('log/conversation', { method: 'POST', body });
      toast(`Logged ${r.added} touch${r.added === 1 ? '' : 'es'}${r.skipped ? ` · ${r.skipped} already there` : ''}`);
      location.hash = `#/p/${r.prospect_id}`;
    } catch (err) { toast(err.message); }
  };
}

function renderCallLog(el, preset) {
  let prospect = preset;
  let recorder = null, chunks = [];
  el.innerHTML = `
    <form class="panel stack" id="callform">
      <div><div class="faint small" style="margin-bottom:6px">Prospect</div><div id="pick"></div></div>
      <div class="grid-3">
        <label class="field">Type<select name="channel" id="cl-channel"><option value="call">Call</option><option value="meeting">Meeting</option><option value="note">Note</option></select></label>
        <label class="field" id="cl-outcome-wrap">Call result<select name="outcome">${outcomeOptions('connected')}</select></label>
        <label class="field">Who started it<select name="direction"><option value="out">I reached out</option><option value="in">They reached out</option><option value="none">Just a note</option></select></label>
        <label class="field">When<input type="datetime-local" name="occurred_at" value="${localInput()}"></label>
      </div>
      <label class="field">What was said — type, or record a voice note and let it transcribe
        <textarea name="body" id="body" placeholder="Spoke with Carla. She confirmed the partners decide together…"></textarea></label>
      <div class="row">
        <button type="button" class="btn" id="rec">${ICON.mic} Record voice note</button>
        <label class="btn ghost">Upload audio<input type="file" id="audio" accept="audio/*" class="sr-only"></label>
        <span id="recstate" class="faint small"></span>
        <span class="spacer"></span>
        <button type="button" class="btn" id="assist">Summarize</button>
      </div>
      <label class="field">Summary (shows on the timeline)<input type="text" name="summary" id="summary" placeholder="Optional for a call — the result is logged either way"></label>
      <div class="grid-3">
        <label class="field">Move to rung<select name="rung" id="rung"><option value="">Keep current</option>${state.config.rungs.map((r, i) => `<option value="${i + 1}">${i + 1} · ${esc(r)}</option>`).join('')}</select></label>
        <label class="field">Next step<input type="text" name="next_step" id="ns"></label>
        <label class="field">By<input type="date" name="next_step_at"></label>
      </div>
      <div class="row"><button class="btn primary">Save to CRM</button></div>
    </form>`;
  mountPicker($('#pick', el), { initial: prospect, onPick: (p) => (prospect = p) });
  $('#cl-channel').onchange = (e) => $('#cl-outcome-wrap').classList.toggle('hidden', e.target.value !== 'call');

  const applyAssist = (r) => {
    if (r.transcript && !$('#body').value.includes(r.transcript)) $('#body').value = ($('#body').value ? $('#body').value + '\n\n' : '') + r.transcript;
    if (r.ai?.summary) $('#summary').value = r.ai.summary;
    if (r.ai?.next_step) $('#ns').value = r.ai.next_step;
    if (r.ai?.suggested_rung && prospect && r.ai.suggested_rung > prospect.rung) $('#rung').value = r.ai.suggested_rung;
  };
  const sendAudio = async (blob, name) => {
    $('#recstate').textContent = 'Transcribing…';
    const fd = new FormData(); fd.append('audio', blob, name);
    try { const { data } = await api('assist/call', { method: 'POST', body: fd }); applyAssist(data); $('#recstate').textContent = 'Transcribed — check it'; }
    catch (err) { $('#recstate').textContent = ''; toast(err.message); }
  };

  $('#rec').onclick = async () => {
    if (recorder?.state === 'recording') { recorder.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const type = ['audio/webm', 'audio/mp4', 'audio/ogg'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
      recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined); chunks = [];
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        $('#rec').innerHTML = `${ICON.mic} Record voice note`;
        sendAudio(new Blob(chunks, { type: recorder.mimeType }), 'note.' + (recorder.mimeType.includes('mp4') ? 'm4a' : 'webm'));
      };
      recorder.start();
      $('#rec').innerHTML = '<span class="rec-dot"></span> Stop';
      $('#recstate').textContent = 'Recording…';
    } catch { toast('Microphone not available — upload a voice memo instead'); }
  };
  $('#audio').onchange = (e) => { const f = e.target.files[0]; if (f) sendAudio(f, f.name); };
  $('#assist').onclick = async () => {
    const text = $('#body').value.trim(); if (!text) return toast('Type or record something first');
    $('#assist').disabled = true;
    try { const { data } = await api('assist/call', { method: 'POST', body: { text } }); applyAssist({ ai: data.ai }); }
    catch (err) { toast(err.message); }
    $('#assist').disabled = false;
  };
  $('#callform').onsubmit = async (e) => {
    e.preventDefault();
    if (!prospect) return toast('Choose a prospect first');
    const body = Object.fromEntries(new FormData(e.target));
    if (body.channel !== 'call') delete body.outcome;
    if (body.channel !== 'call' && !body.summary) return toast('Add a short summary');
    body.prospect_id = prospect.id;
    body.occurred_at = new Date(body.occurred_at).toISOString();
    body.source = body.body && $('#recstate').textContent ? 'voice' : 'manual';
    if (!body.rung) delete body.rung; else body.rung = +body.rung;
    if (!body.next_step) delete body.next_step;
    if (!body.next_step_at) delete body.next_step_at;
    await api('events', { method: 'POST', body });
    toast('Logged'); location.hash = `#/p/${prospect.id}`;
  };
}

// ═════════════════════════════════════════════════════
// INBOX — emails that matched nobody
// ═════════════════════════════════════════════════════
async function viewInbox() {
  const { data } = await api('inbox');
  view.innerHTML = `
    <div class="page-head"><div><h1>Inbox</h1><p class="muted">Emails that reached the log address but matched no prospect.</p></div></div>
    <section class="panel">${data.length ? `<ul class="list">${data.map((e) => {
      const m = e.meta ? JSON.parse(e.meta) : {};
      return `<li><div class="item" style="grid-template-columns:minmax(0,1fr) auto">
        <div style="min-width:0"><div class="one-line">${esc(e.summary)}</div><div class="faint small one-line">${esc(m.counterpart_name || '')} ${esc(m.counterpart || '')} · ${fmtWhen(e.occurred_at)}</div><div class="assign hidden" data-for="${e.id}" style="margin-top:8px"></div></div>
        <div class="row"><button class="btn" data-assign="${e.id}">Assign</button><button class="btn ghost" data-create="${e.id}">New prospect</button><button class="btn ghost" data-drop="${e.id}">Dismiss</button></div>
      </div></li>`;
    }).join('')}</ul>` : '<p class="empty">Empty. Every logged email found its prospect.</p>'}</section>`;
  $$('[data-assign]').forEach((b) => (b.onclick = () => {
    const box = $(`.assign[data-for="${b.dataset.assign}"]`); box.classList.remove('hidden');
    mountPicker(box, { allowCreate: false, onPick: async (p) => { if (!p) return; await api('events/' + b.dataset.assign, { method: 'PATCH', body: { prospect_id: p.id } }); toast(`Filed under ${p.name}`); viewInbox(); refreshInboxBadge(); } });
  }));
  $$('[data-create]').forEach((b) => (b.onclick = async () => { const { data: r } = await api('events/' + b.dataset.create, { method: 'PATCH', body: { create_prospect: {} } }); location.hash = `#/p/${r.prospect_id}`; }));
  $$('[data-drop]').forEach((b) => (b.onclick = async () => { await api('events/' + b.dataset.drop, { method: 'DELETE' }); viewInbox(); refreshInboxBadge(); }));
}

// ═════════════════════════════════════════════════════
// ANALYTICS
// ═════════════════════════════════════════════════════
async function viewAnalytics(_, params) {
  const days = +(params.get('days') || 30);
  const { data: a } = await api('analytics?days=' + days);
  const k = a.kpis;
  const avg = a.daily.length ? (a.daily.reduce((s, d) => s + d.total, 0) / a.daily.length) : 0;
  const daysHit = a.daily.filter((d) => d.total >= a.target).length;

  view.innerHTML = `
    <div class="page-head">
      <div><h1>Analytics</h1><p class="muted">Last ${days} days · <a href="${API_BASE}export" class="faint">export all data</a></p></div>
      <div class="seg" role="group" aria-label="Range">${[7, 30, 90].map((d) => `<button data-d="${d}" aria-pressed="${d === days}">${d} days</button>`).join('')}</div>
    </div>
    <div class="kpis">
      <div class="kpi hero"><div class="v">${avg.toFixed(1)} <small>touches / day</small></div><div class="l">Target ${a.target} · hit on ${daysHit} of ${days} days</div></div>
      <div class="kpi"><div class="v">${a.calls.dials}</div><div class="l">Dials · ${pct(a.calls.connect_rate)} connected</div></div>
      <div class="kpi"><div class="v">${a.funnel.find((f) => f.key === 'met').n}</div><div class="l">Meetings held</div></div>
      <div class="kpi"><div class="v">${a.funnel.find((f) => f.key === 'won').n}</div><div class="l">Won</div></div>
    </div>
    <div class="charts">
      <section class="panel chart wide"><div class="panel-head"><h2>Daily outreach</h2><span class="faint small">Prospects touched outbound per day · dashed line is your target</span></div><div id="c-daily"></div></section>
      <section class="panel chart"><div class="panel-head"><h2>Conversation stages</h2><span class="faint small">Prospects opened in this window</span></div><div id="c-funnel"></div></section>
      <section class="panel chart"><div class="panel-head"><h2>Channel mix</h2><span class="faint small">Outbound touches by channel</span></div><div id="c-mix"></div></section>
      <section class="panel chart"><div class="panel-head"><h2>Call results</h2><span class="faint small">${a.calls.dials} dials · ${a.calls.connects} conversations</span></div><div id="c-calls"></div></section>
      <section class="panel chart"><div class="panel-head"><h2>Ladder conversion</h2><span class="faint small">Prospects opened in this window, furthest rung reached</span></div><div id="c-ladder"></div></section>
      <section class="panel chart"><div class="panel-head"><h2>Reply rate by channel</h2><span class="faint small">First contact on channel → any reply</span></div><div id="c-reply"></div></section>
      <section class="panel chart"><div class="panel-head"><h2>Why deals die</h2><span class="faint small">Lost in this window, by rejection type</span></div><div id="c-rej"></div></section>
      <section class="panel wide"><div class="panel-head"><h2>What converts</h2><div class="seg" role="group" aria-label="Segment by">${['industry', 'region', 'batch'].map((k, i) => `<button data-seg="${k}" aria-pressed="${i === 0}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</div></div><div id="c-seg"></div></section>
      <section class="panel wide"><div class="panel-head"><h2>Stale prospects</h2><span class="faint small">Silent after ${a.stale_days} days, overdue, or waiting on you</span></div><div id="c-stale"></div></section>
    </div>`;
  $$('[data-d]').forEach((b) => (b.onclick = () => (location.hash = `#/analytics?days=${b.dataset.d}`)));

  dailyChart($('#c-daily'), a.daily, a.target);
  const top = a.funnel[0].n || 1;
  hbarChart($('#c-funnel'), a.funnel.map((f, i) => ({
    label: f.name, value: f.n, max: top,
    right: `${f.n}${i > 0 && a.funnel[i - 1].n && f.n <= a.funnel[i - 1].n ? ` · ${pct(f.n / a.funnel[i - 1].n)}` : ''}`,
    tip: `<div class="t">${esc(f.name)}</div>${f.n} prospects${i > 0 && a.funnel[i - 1].n ? `<br>${pct(f.n / a.funnel[i - 1].n)} of ${esc(a.funnel[i - 1].name.toLowerCase())}` : ''}`,
  })), ['Stage', 'Prospects', 'From previous'], a.funnel.map((f, i) => [f.name, f.n, i && a.funnel[i - 1].n ? pct(f.n / a.funnel[i - 1].n) : '—']));
  const mixMax = Math.max(1, ...a.channel_mix.map((m) => m.touches));
  hbarChart($('#c-mix'), a.channel_mix.map((m) => ({
    label: CH_LABEL[m.channel] || m.channel, value: m.touches, max: mixMax,
    right: `${m.touches} · ${m.prospects} prospects`,
    tip: `<div class="t">${esc(CH_LABEL[m.channel] || m.channel)}</div>${m.touches} touches to ${m.prospects} prospects<br>${(m.touches / m.prospects).toFixed(1)} per prospect`,
  })), ['Channel', 'Touches', 'Prospects'], a.channel_mix.map((m) => [CH_LABEL[m.channel] || m.channel, m.touches, m.prospects]));
  const callMax = Math.max(1, ...a.calls.outcomes.map((o) => o.n));
  hbarChart($('#c-calls'), a.calls.outcomes.map((o) => ({
    label: o.label.split(' — ')[0], value: o.n, max: callMax,
    right: `${o.n} · ${pct(a.calls.dials ? o.n / a.calls.dials : null)}`,
    tip: `<div class="t">${esc(o.label)}</div>${o.n} of ${a.calls.dials} dials`,
  })), ['Result', 'Dials', 'Share'], a.calls.outcomes.map((o) => [o.label, o.n, pct(a.calls.dials ? o.n / a.calls.dials : null)]));
  hbarChart($('#c-ladder'), a.ladder.map((s, i) => ({
    label: `${s.rung} · ${s.name}`, value: s.reached, max: a.ladder[0].reached || 1,
    right: `${s.reached}${i > 0 && a.ladder[i - 1].reached ? ` · ${pct(s.reached / a.ladder[i - 1].reached)}` : ''}`,
    tip: `<div class="t">${esc(s.name)}</div>${s.reached} reached${s.to_next != null && i < 5 ? `<br>${pct(s.to_next)} moved on to ${esc(a.ladder[i + 1].name)}` : ''}`,
  })), ['Rung', 'Reached', 'Step conversion'], a.ladder.map((s, i) => [`${s.rung} · ${s.name}`, s.reached, i ? pct(a.ladder[i - 1].reached ? s.reached / a.ladder[i - 1].reached : null) : '—']));
  hbarChart($('#c-reply'), a.reply_rate.map((r) => ({
    label: r.channel[0].toUpperCase() + r.channel.slice(1), value: r.rate, max: 1,
    right: `${pct(r.rate)} · ${r.replied} of ${r.reached}`,
    tip: `<div class="t">${esc(r.channel)}</div>${r.replied} of ${r.reached} replied`,
  })), ['Channel', 'Reached', 'Replied', 'Rate'], a.reply_rate.map((r) => [r.channel, r.reached, r.replied, pct(r.rate)]));

  hbarChart($('#c-rej'), a.rejections.map((r) => ({
    label: r.label.split(' — ')[0], value: r.n, max: Math.max(...a.rejections.map((x) => x.n)),
    right: `${r.n} · lost at ${rungName(Math.round(r.avg_rung))}`,
    tip: `<div class="t">${esc(r.label)}</div>${r.n} lost · on average at the ${esc(rungName(Math.round(r.avg_rung)))} rung`,
  })), ['Reason', 'Lost', 'Avg rung'], a.rejections.map((r) => [r.label, r.n, r.avg_rung]));

  const segTable = (rows) => rows.length ? `<div class="table-scroll"><table class="data-table"><thead><tr><th>Segment</th><th class="num">Leads</th><th class="num">Touched</th><th class="num">Replied</th><th class="num">Reply rate</th><th class="num">Qualified</th><th class="num">Agreed to meet</th><th class="num">Met</th><th class="num">Won</th></tr></thead><tbody>${rows.map((r) =>
    `<tr><td>${esc(r.key)}</td><td class="num">${r.leads}</td><td class="num">${r.touched}</td><td class="num">${r.replied}</td><td class="num">${pct(r.reply_rate)}</td><td class="num">${r.qualified}</td><td class="num">${r.meeting}</td><td class="num">${r.met}</td><td class="num">${r.won}</td></tr>`).join('')}</tbody></table></div>`
    : '<p class="empty">No prospects opened in this window yet.</p>';
  const segs = { industry: a.by_industry, region: a.by_region, batch: a.by_batch };
  $('#c-seg').innerHTML = segTable(segs.industry);
  $$('[data-seg]').forEach((b) => (b.onclick = () => {
    $$('[data-seg]').forEach((x) => x.setAttribute('aria-pressed', x === b));
    $('#c-seg').innerHTML = segTable(segs[b.dataset.seg]);
  }));

  $('#c-stale').innerHTML = a.stale.length ? `<div class="table-scroll"><table class="data-table"><thead><tr><th>Prospect</th><th>Rung</th><th>Why</th><th class="num">Days</th></tr></thead><tbody>${a.stale.map((s) =>
    `<tr><td><a href="#/p/${s.id}">${esc(s.name)}</a> <span class="faint">${esc(s.company && s.company !== s.name ? s.company : '')}</span></td><td>${esc(s.rung_name)}</td><td>${esc(s.reason)}</td><td class="num">${s.days_since}</td></tr>`).join('')}</tbody></table></div>`
    : '<p class="empty">Nothing stale.</p>';
}

function tableHtml(head, rows) {
  return `<details class="table-view"><summary>Show as table</summary><div class="table-scroll"><table class="data-table"><thead><tr>${head.map((h, i) => `<th class="${i ? 'num' : ''}">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td class="${i ? 'num' : ''}">${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`;
}

// Vertical bars, one series, rounded data-end, 2px gaps, target reference line.
function dailyChart(el, daily, target) {
  const W = Math.max(300, el.clientWidth || 900), H = 240, L = 32, R = 8, T = 12, B = 26;
  const iw = W - L - R, ih = H - T - B;
  const max = Math.max(target, ...daily.map((d) => d.total)) * 1.12 || 1;
  const bw = iw / daily.length;
  const y = (v) => T + ih - (v / max) * ih;
  const ticks = niceTicks(max);
  const step = Math.ceil(daily.length / Math.max(3, Math.floor(W / 80)));
  const bar = (x, w, v) => {
    if (!v) return '';
    const top = y(v), r = Math.min(4, w / 2, (T + ih - top));
    return `<path class="bar" d="M${x},${T + ih} V${top + r} Q${x},${top} ${x + r},${top} H${x + w - r} Q${x + w},${top} ${x + w},${top + r} V${T + ih} Z"/>`;
  };
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily outreach bar chart">
    <g class="axis">${ticks.map((t) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text x="${L - 8}" y="${y(t) + 4}" text-anchor="end">${t}</text>`).join('')}</g>
    ${daily.map((d, i) => `<g class="b" data-i="${i}">${bar(L + i * bw + 1, Math.max(1, bw - 2), d.total)}<rect class="hitbox" x="${L + i * bw}" y="${T}" width="${bw}" height="${ih}"/></g>`).join('')}
    <line class="target" x1="${L}" x2="${W - R}" y1="${y(target)}" y2="${y(target)}"/>
    <text class="lbl" x="${W - R}" y="${y(target) - 6}" text-anchor="end">target ${target}</text>
    <g class="axis">${daily.map((d, i) => (i % step === 0 || i === daily.length - 1) ? `<text x="${L + i * bw + bw / 2}" y="${H - 6}" text-anchor="middle">${shortDate(d.date)}</text>` : '').join('')}</g>
  </svg>` + tableHtml(['Day', 'Total', 'WhatsApp', 'Email', 'Call', 'Meeting'], daily.map((d) => [d.date, d.total, d.whatsapp, d.email, d.call, d.meeting]));
  $$('g.b', el).forEach((g) => {
    const d = daily[g.dataset.i];
    const parts = ['whatsapp', 'email', 'call', 'meeting'].filter((c) => d[c]).map((c) => `${c} ${d[c]}`).join(' · ');
    g.onmousemove = (e) => showTip(e, `<div class="t">${shortDate(d.date, true)}</div>${d.total} touched${parts ? `<br><span class="faint">${parts}</span>` : ''}`);
    g.onmouseleave = hideTip;
  });
}

// Horizontal bars with a label on the left and value text on the right.
function hbarChart(el, rows, head, tableRows) {
  if (!rows.length) { el.innerHTML = '<p class="empty">No data in this window yet.</p>'; return; }
  const W = Math.max(280, el.clientWidth || 520), rowH = 34, LBL = W < 400 ? 96 : 120, RT = 110, H = rows.length * rowH;
  const iw = W - LBL - RT;
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(head[0])} chart">
    ${rows.map((r, i) => {
      const w = Math.max(0, (r.value / r.max) * iw), yy = i * rowH + 8, h = rowH - 16, rad = Math.min(4, w / 2, h / 2);
      const path = w > 0 ? `<path class="bar" d="M${LBL},${yy} H${LBL + w - rad} Q${LBL + w},${yy} ${LBL + w},${yy + rad} V${yy + h - rad} Q${LBL + w},${yy + h} ${LBL + w - rad},${yy + h} H${LBL} Z"/>` : `<line class="grid" x1="${LBL}" x2="${LBL}" y1="${yy}" y2="${yy + h}"/>`;
      const maxChars = Math.floor((LBL - 8) / 6.2);
      const label = r.label.length > maxChars ? r.label.slice(0, maxChars - 1) + '…' : r.label;
      return `<g class="b" data-i="${i}"><text class="lbl" x="0" y="${yy + h / 2 + 4}">${esc(label)}</text>${path}<text class="val" x="${LBL + w + 8}" y="${yy + h / 2 + 4}">${esc(r.right)}</text><rect class="hitbox" x="0" y="${i * rowH}" width="${W}" height="${rowH}"/></g>`;
    }).join('')}
  </svg>` + tableHtml(head, tableRows);
  $$('g.b', el).forEach((g) => { g.onmousemove = (e) => showTip(e, rows[g.dataset.i].tip); g.onmouseleave = hideTip; });
}

function niceTicks(max) {
  const raw = max / 4, mag = 10 ** Math.floor(Math.log10(raw || 1));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) || mag;
  const out = []; for (let v = 0; v <= max; v += step) out.push(v); return out;
}
function shortDate(d, long) {
  const dt = new Date(d + 'T12:00:00');
  return dt.toLocaleDateString(undefined, long ? { weekday: 'short', month: 'short', day: 'numeric' } : { month: 'numeric', day: 'numeric' });
}

// ── boot ─────────────────────────────────────────────
(async function boot() {
  // Android "Share to CRM" from WhatsApp (installed as an app) lands here with the text.
  const sp = new URLSearchParams(location.search);
  const sharedText = [sp.get('share_title'), sp.get('share_text'), sp.get('share_url')].filter(Boolean).join('\n');
  if (sharedText) {
    sessionStorage.setItem('shared-text', sharedText);
    history.replaceState(null, '', '/#/log?mode=chat');
  }
  try { state.config = (await api('config')).data; await loadFacets(); }
  catch (err) { view.innerHTML = `<div class="panel"><h2>Can't reach the CRM</h2><p class="muted">${esc(err.message)}</p></div>`; return; }
  addEventListener('hashchange', router);
  router();
})();
