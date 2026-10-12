// Email intake via Cloudflare Email Routing.
//  • Outbound: BCC the log address on any prospect email you send.
//  • Inbound:  forward a prospect's reply to the log address.
// The Worker decides direction, matches (or creates) the prospect and logs the event.

import PostalMime from 'postal-mime';
import { addEvent, createProspect, findProspect, normEmail } from './db.js';
import { aiJSON, PROMPTS } from './ai.js';

const FWD_SUBJECT = /^\s*(fwd?|fw|rv|reenv(iado)?)\s*:/i;
// "From: Name <a@b.com>" / "De: Name <a@b.com>" / "From: a@b.com" inside a forwarded body
const FWD_FROM = /^(?:>?\s*)(?:from|de)\s*:\s*(?:"?([^"<\n]*?)"?\s*)?<?([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})>?/im;

export async function handleEmail(message, env) {
  const parsed = await PostalMime.parse(message.raw);
  const owners = (env.OWNER_EMAILS || '').split(',').map(normEmail).filter(Boolean);
  const logAddr = normEmail(env.LOG_ADDRESS);
  const isOwner = (a) => owners.includes(normEmail(a));

  const from = parsed.from || {};
  const subject = parsed.subject || '(no subject)';
  const text = (parsed.text || stripHtml(parsed.html || '')).trim();
  const recipients = [...(parsed.to || []), ...(parsed.cc || [])]
    .flatMap((r) => (r.group ? r.group : [r]))
    .filter((r) => r.address && normEmail(r.address) !== logAddr && !isOwner(r.address));

  let direction, counterpart;
  if (isOwner(from.address) && FWD_SUBJECT.test(subject)) {
    // A reply you forwarded in: the original sender is inside the body.
    const m = text.match(FWD_FROM);
    direction = 'in';
    counterpart = m ? { name: (m[1] || '').trim(), address: m[2] } : null;
  } else if (isOwner(from.address)) {
    direction = 'out';
    counterpart = recipients[0] || null;
  } else {
    direction = 'in';
    counterpart = { name: from.name, address: from.address };
  }

  const ai = await aiJSON(env, PROMPTS.email, `Direction: ${direction}\nSubject: ${subject}\n\n${text.slice(0, 6000)}`, { maxTokens: 200 });
  const summary = ai?.summary || `${direction === 'out' ? 'Sent' : 'Received'}: ${subject}`;

  let prospect = counterpart ? await findProspect(env.DB, { email: counterpart.address }) : null;
  if (!prospect && direction === 'out' && counterpart) {
    // First outbound email to someone new is a Touch: open the record automatically.
    prospect = await createProspect(env.DB, {
      name: counterpart.name || counterpart.address.split('@')[0],
      email: counterpart.address,
      rung: 1,
    });
  }

  // Unmatched inbound mail lands in the Inbox for triage instead of creating noise.
  await addEvent(
    env.DB,
    {
      prospect_id: prospect?.id ?? null,
      channel: 'email',
      direction,
      occurred_at: parsed.date || new Date().toISOString(),
      summary,
      body: text.slice(0, 20000),
      source: 'email',
      meta: { subject, counterpart: counterpart?.address || null, counterpart_name: counterpart?.name || null, from: from.address },
    },
    { explicitNo: !!ai?.explicit_no }
  );
}

function stripHtml(html) {
  return html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+\n/g, '\n').replace(/[ \t]+/g, ' ');
}
