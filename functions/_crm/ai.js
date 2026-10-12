// AI helpers. Claude (via API key secret) when present, Workers AI otherwise.
// Every AI result is a *suggestion* the UI shows for confirmation — nothing is
// written to a prospect record on the model's word alone, except email summaries.

const WORKERS_TEXT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const WORKERS_STT_MODEL = '@cf/openai/whisper-large-v3-turbo';

function extractJSON(text) {
  if (!text) return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

export async function aiJSON(env, system, user, { maxTokens = 800 } = {}) {
  try {
    if (env.ANTHROPIC_API_KEY) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: env.ANTHROPIC_MODEL || 'claude-haiku-5-5',
          max_tokens: maxTokens,
          system: system + '\nRespond with a single JSON object and nothing else.',
          messages: [{ role: 'user', content: user }],
        }),
      });
      if (!res.ok) throw new Error('Anthropic API ' + res.status);
      const data = await res.json();
      return extractJSON(data.content?.map((c) => c.text || '').join(''));
    }
    if (env.AI) {
      const out = await env.AI.run(WORKERS_TEXT_MODEL, {
        messages: [
          { role: 'system', content: system + '\nRespond with a single JSON object and nothing else.' },
          { role: 'user', content: user },
        ],
        max_tokens: maxTokens,
      });
      const text = typeof out?.response === 'string' ? out.response : JSON.stringify(out?.response ?? '');
      return extractJSON(text);
    }
  } catch (err) {
    console.error('aiJSON failed', err);
  }
  return null; // callers degrade gracefully without AI
}

export async function transcribe(env, arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  const out = await env.AI.run(WORKERS_STT_MODEL, { audio: btoa(bin) });
  return out?.text || '';
}

const LADDER = 'DATRUM sales ladder: 1 Touch (first outreach), 2 Interest (any reply that is not an explicit no), 3 Read (they engaged with findings/scan), 4 Diagnostic (budget + decision authority confirmed), 5 Proposal (proposal sent), 6 Close (signed/paid).';

export const PROMPTS = {
  conversation: `You read sales conversations for DATRUM, a marketing-engineering agency in Panama run by Jelv. Messages may be in Spanish or English.
${LADDER}
From the conversation, return JSON:
{"contact_name": string|null, "company": string|null, "phone": string|null, "email": string|null,
 "summary": "one sentence, in English, what happened",
 "explicit_no": boolean (true only if the prospect clearly declined),
 "suggested_rung": 1-6, "next_step": string|null,
 "direction_if_unclear": "out"|"in"}
Do not invent contact details that are not in the text.`,

  call: `You turn a phone-call note or transcript for DATRUM (marketing-engineering agency, Panama) into a log entry.
${LADDER}
Return JSON: {"summary": "one or two sentences in English", "explicit_no": boolean, "suggested_rung": 1-6, "next_step": string|null}`,

  email: `Summarize this sales email for a CRM timeline in one sentence in English. ${LADDER}
Return JSON: {"summary": string, "explicit_no": boolean}`,
};
