// Parses WhatsApp text that was copied from a chat or exported as .txt
// (iOS and Android formats, Spanish or English locale). Personal WhatsApp has
// no API, so this is how a chat becomes CRM events: paste → confirm.

const RE_STD = /^\[?(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]\.?\s?m\.?)?\]?\s*[-–]?\s*([^:]{1,60}?):\s?(.*)$/i;
const RE_ANDROID_COPY = /^\[(\d{1,2}):(\d{2})(?:\s*([ap]\.?\s?m\.?))?,\s*(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})\]\s*([^:]{1,60}?):\s?(.*)$/i;

function to24(h, ampm) {
  h = parseInt(h, 10);
  if (!ampm) return h;
  const pm = /p/i.test(ampm);
  if (pm && h < 12) return h + 12;
  if (!pm && h === 12) return 0;
  return h;
}

export function parseWhatsApp(text, { ownerNames = [], tzOffsetHours = -5, dateOrder = 'dmy' } = {}) {
  const lines = String(text || '').replace(/[‎‏‪-‮]/g, '').split(/\r?\n/);
  const raw = [];
  for (const line of lines) {
    let m = line.match(RE_ANDROID_COPY);
    if (m) {
      raw.push({ a: +m[4], b: +m[5], y: +m[6], h: to24(m[1], m[3]), min: +m[2], sender: m[7].trim(), text: m[8] });
      continue;
    }
    m = line.match(RE_STD);
    if (m) {
      raw.push({ a: +m[1], b: +m[2], y: +m[3], h: to24(m[4], m[6]), min: +m[5], sender: m[7].trim(), text: m[8] });
      continue;
    }
    if (raw.length && line.trim()) raw[raw.length - 1].text += '\n' + line; // multi-line message
  }
  if (!raw.length) return { messages: [], contactName: null };

  // Day-first vs month-first: let the data decide, fall back to the locale default.
  let order = dateOrder;
  if (raw.some((r) => r.a > 12)) order = 'dmy';
  else if (raw.some((r) => r.b > 12)) order = 'mdy';

  const owners = ownerNames.map((n) => n.trim().toLowerCase()).filter(Boolean);
  const isOwner = (s) => owners.some((o) => s.toLowerCase() === o || s.toLowerCase().startsWith(o + ' '));

  const messages = raw
    .filter((r) => !/^(<.*omitted>|<multimedia omitido>|.*cifrado de extremo a extremo.*|.*end-to-end encrypted.*)$/i.test(r.text.trim()))
    .map((r) => {
      const day = order === 'dmy' ? r.a : r.b;
      const month = order === 'dmy' ? r.b : r.a;
      const year = r.y < 100 ? 2000 + r.y : r.y;
      const utc = Date.UTC(year, month - 1, day, r.h, r.min) - tzOffsetHours * 3600_000;
      return { at: new Date(utc).toISOString(), sender: r.sender, text: r.text.trim(), direction: isOwner(r.sender) ? 'out' : 'in' };
    });

  const counts = {};
  for (const m of messages) if (m.direction === 'in') counts[m.sender] = (counts[m.sender] || 0) + 1;
  const contactName = Object.entries(counts).sort((x, y) => y[1] - x[1])[0]?.[0] || null;
  return { messages, contactName };
}

// A burst of messages is one touch, not ten: group consecutive same-direction
// messages on the same local day into a single event.
export function groupIntoEvents(messages, tzOffsetHours = -5) {
  const localDay = (iso) => new Date(new Date(iso).getTime() + tzOffsetHours * 3600_000).toISOString().slice(0, 10);
  const events = [];
  for (const m of messages) {
    const last = events[events.length - 1];
    if (last && last.direction === m.direction && localDay(last.occurred_at) === localDay(m.at)) {
      last.body += '\n' + m.text;
      last.count += 1;
    } else {
      events.push({ channel: 'whatsapp', direction: m.direction, occurred_at: m.at, body: m.text, count: 1 });
    }
  }
  for (const e of events) {
    const first = e.body.split('\n')[0];
    e.summary = (e.direction === 'out' ? 'Sent: ' : 'Received: ') + (first.length > 90 ? first.slice(0, 87) + '…' : first) +
      (e.count > 1 ? ` (+${e.count - 1} more)` : '');
  }
  return events;
}
