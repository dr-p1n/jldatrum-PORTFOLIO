// =====================================================================
// Cloudflare Worker — submitcalculator.julioernestolv.workers.dev
// Version: 4.0
//
// Routes two calculator types:
//   1. VirtualPresenceScanner  → scans URL, scores, emails results
//   2. LeadGenScorecard        → passthrough score, emails results
//
// Emails sent via Resend (env.RESEND_API_KEY)
// Data logged via Google Apps Script → Google Sheet
// =====================================================================

const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbw59uAdsZPU6TA_14TsmJp_ZmWcpJsUIm_bRSvL-LYfF4_atDM3DM0v74ExALpncHYO/exec';
const FROM_EMAIL        = 'DATRUM <julio@jldatrum.com>';
const NOTIFY_EMAIL      = 'julio@jldatrum.com';
const RESEND_API        = 'https://api.resend.com/emails';

// ── CORS ─────────────────────────────────────────────────
const corsHeaders = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

// ── MAIN HANDLER ─────────────────────────────────────────
export default {
    async fetch(request, env, ctx) {

        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        if (request.method === 'GET') {
            return new Response(
                JSON.stringify({ status: 'ok', calculator: 'DATRUM-LEY81', version: '4.0' }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        try {
            const body = await request.json();
            const { url, email, formType, Calculator_Name } = body;

            if (!url) {
                return new Response(
                    JSON.stringify({ error: 'No URL provided' }),
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            const fullName = body.fullName || '';
            const phone    = body.phone    || '';
            const consent  = body.consent === true;
            const ts       = new Date().toISOString();

            // ── ROUTE ────────────────────────────────────
            let payload;
            let prospectHtml;
            let notifyHtml;
            let prospectSubject;
            let notifySubject;

            if (formType === 'lead-gen-scorecard' || Calculator_Name === 'LeadGenScorecard') {

                // ── LEAD GEN SCORECARD ───────────────────
                const score         = body.score != null ? body.score : (body.finalScore ? parseFloat(body.finalScore) / 10 : 0);
                const finalScore    = body.finalScore || (score * 10).toFixed(1);
                const scoreColor    = body.scoreColor    || '#f59e0b';
                const interpretation = body.interpretation || '';
                const q1 = body.q1 ?? ''; const q2 = body.q2 ?? '';
                const q3 = body.q3 ?? ''; const q4 = body.q4 ?? '';
                const q5 = body.q5 ?? '';

                payload = {
                    url, email: email || 'N/A', fullName, phone, consent,
                    score, Calculator_Name: 'LeadGenScorecard',
                    q1, q2, q3, q4, q5,
                    scoreColor, interpretation, timestamp: ts,
                    details: [q1, q2, q3, q4, q5]
                };

                prospectSubject = `Tu Puntaje de Generación de Leads: ${finalScore}/10`;
                prospectHtml    = buildScorecardProspectEmail({ fullName, email, url, finalScore, scoreColor, interpretation });
                notifySubject   = `🔔 Nuevo Lead — Scorecard ${finalScore}/10`;
                notifyHtml      = buildNotifyEmail({ formType: 'Lead Gen Scorecard', fullName, email, phone, url, score: finalScore, scoreColor, interpretation, consent, ts });

            } else {

                // ── VIRTUAL PRESENCE SCANNER ─────────────
                const scanResults   = await scanWebsite(url);
                const score         = scanResults.reduce((a, b) => a + b, 0) / scanResults.length;
                const finalScore    = (score * 10).toFixed(1);

                let scoreColor, interpretation;
                if (score >= 0.8) {
                    scoreColor    = '#10b981';
                    interpretation = 'Tu presencia virtual es sólida.';
                } else if (score >= 0.5) {
                    scoreColor    = '#f59e0b';
                    interpretation = 'Tienes brechas que están filtrando leads.';
                } else {
                    scoreColor    = '#ef4444';
                    interpretation = 'Tu sitio web está perjudicando tu práctica.';
                }

                payload = {
                    url, email: email || 'N/A', consent,
                    score, Calculator_Name: 'VirtualPresenceScanner',
                    q1: scanResults[0], q2: scanResults[1], q3: scanResults[2],
                    q4: scanResults[3], q5: scanResults[4],
                    scoreColor, interpretation, timestamp: ts,
                    details: scanResults
                };

                prospectSubject = `Tu Puntaje de Presencia Virtual: ${finalScore}/10`;
                prospectHtml    = buildScannerProspectEmail({ email, url, finalScore, scoreColor, interpretation, scanResults });
                notifySubject   = `🔔 Nuevo Lead — Scanner ${finalScore}/10`;
                notifyHtml      = buildNotifyEmail({ formType: 'Virtual Presence Scanner', fullName: '', email, phone: '', url, score: finalScore, scoreColor, interpretation, consent, ts });
            }

            // ── SEND EMAILS + LOG (non-blocking) ─────────
            ctx.waitUntil(Promise.all([

                // 1. Email to prospect
                email && email !== 'N/A'
                    ? sendEmail(env.RESEND_API_KEY, FROM_EMAIL, email, prospectSubject, prospectHtml)
                    : Promise.resolve(),

                // 2. Notification to Julio
                sendEmail(env.RESEND_API_KEY, FROM_EMAIL, NOTIFY_EMAIL, notifySubject, notifyHtml),

                // 3. Log to Google Sheet via Apps Script
                fetch(GOOGLE_SCRIPT_URL, {
                    method:   'POST',
                    headers:  { 'Content-Type': 'application/json' },
                    body:     JSON.stringify(payload),
                    redirect: 'follow'
                }).catch(err => console.error('Apps Script error:', err))

            ]));

            return new Response(
                JSON.stringify(payload),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );

        } catch (error) {
            return new Response(
                JSON.stringify({ error: error.message }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }
    }
};

// ── RESEND HELPER ─────────────────────────────────────────
async function sendEmail(apiKey, from, to, subject, html) {
    if (!apiKey) { console.error('RESEND_API_KEY not set'); return; }
    try {
        const res = await fetch(RESEND_API, {
            method:  'POST',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body:    JSON.stringify({ from, to, subject, html })
        });
        const data = await res.json();
        if (!res.ok) console.error('Resend error:', JSON.stringify(data));
        else console.log('Email sent:', data.id);
    } catch (err) {
        console.error('sendEmail exception:', err);
    }
}

// ── SCAN FUNCTION ─────────────────────────────────────────
async function scanWebsite(url) {
    try {
        const response = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ScanBot/1.0)' },
            redirect: 'follow'
        });
        const html = await response.text();
        const q1 = /fbq\(|facebook\.net\/en_US\/fbevents/i.test(html) ? 1 : 0;
        const q2 = /googletagmanager\.com\/gtm/i.test(html)            ? 1 : 0;
        const q3 = /google-analytics\.com|gtag\(/i.test(html)          ? 1 : 0;
        const q4 = url.startsWith('https://')                           ? 1 : 0;
        const q5 = /meta\s+name=["']viewport/i.test(html)              ? 1 : 0;
        return [q1, q2, q3, q4, q5];
    } catch { return [0, 0, 0, 0, 0]; }
}

// ── EMAIL TEMPLATES ───────────────────────────────────────

function emailWrapper(content) {
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{margin:0;padding:0;background:#1A1A1A;font-family:'Helvetica Neue',Arial,sans-serif;color:#F5F5F5}
  .wrap{max-width:600px;margin:0 auto;padding:32px 16px}
  .card{background:#222;border:1px solid #2A2A2A;border-radius:12px;padding:32px;margin-bottom:16px}
  .accent{color:#FF6B35}
  .teal{color:#497174}
  .muted{color:rgba(245,245,245,0.55);font-size:13px}
  .score-circle{width:96px;height:96px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:28px;font-weight:800;color:#fff;margin-bottom:16px}
  .btn{display:inline-block;background:#FF6B35;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;letter-spacing:.05em;text-transform:uppercase;margin-top:16px}
  .row{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #2A2A2A;font-size:14px}
  .row:last-child{border-bottom:none}
  h1{font-size:26px;font-weight:800;margin:0 0 8px}
  h2{font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#497174;margin:0 0 16px}
  p{font-size:15px;line-height:1.7;color:rgba(245,245,245,0.8);margin:0 0 12px}
  .footer{text-align:center;padding-top:24px}
</style></head><body><div class="wrap">${content}<div class="footer">
  <p class="muted">© 2026 Julio Luque Vald&eacute;s · DATRUM<br>
  Ciudad de Panamá, Panamá · <a href="mailto:julio@jldatrum.com" style="color:#497174">julio@jldatrum.com</a></p>
  <p class="muted" style="margin-top:8px">
  <a href="https://jldatrum.com/privacy.html" style="color:#497174">Política de Privacidad · LEY 81</a></p>
</div></div></body></html>`;
}

function buildScorecardProspectEmail({ fullName, email, url, finalScore, scoreColor, interpretation }) {
    const greeting = fullName ? `Hola ${fullName.split(' ')[0]},` : 'Hola,';
    return emailWrapper(`
    <div class="card" style="text-align:center;border-color:${scoreColor}40">
        <h2>Lead Gen Scorecard — DATRUM</h2>
        <div class="score-circle" style="background:${scoreColor}">${finalScore}</div>
        <h1>${finalScore}<span style="font-size:16px;font-weight:400">/10</span></h1>
        <p style="color:${scoreColor};font-weight:600">${interpretation}</p>
    </div>
    <div class="card">
        <p>${greeting}</p>
        <p>Aquí está el desglose detallado de tu puntaje de generación de leads para <strong style="color:#FF6B35">${url}</strong>.</p>
        <p>Este puntaje mide qué tan bien tu sitio web genera leads calificados. Cuanto más alto, más predecible es tu flujo de clientes potenciales.</p>
    </div>
    <div class="card">
        <h2>Siguiente Paso</h2>
        <p>Agenda una llamada de descubrimiento gratuita de 30 minutos. Revisamos tu puntaje juntos e identificamos las 2-3 palancas que más impactarán tu generación de leads.</p>
        <a href="https://jldatrum.com" class="btn">Agenda Tu Llamada →</a>
    </div>`);
}

function buildScannerProspectEmail({ email, url, finalScore, scoreColor, interpretation, scanResults }) {
    const checks = [
        { label: 'Facebook Pixel',    pass: scanResults[0] },
        { label: 'Google Tag Manager',pass: scanResults[1] },
        { label: 'Google Analytics',  pass: scanResults[2] },
        { label: 'HTTPS / SSL',       pass: scanResults[3] },
        { label: 'Mobile Viewport',   pass: scanResults[4] },
    ];
    const rows = checks.map(c =>
        `<div class="row"><span>${c.label}</span><span style="color:${c.pass ? '#10b981' : '#ef4444'};font-weight:700">${c.pass ? '✓ Activo' : '✗ No encontrado'}</span></div>`
    ).join('');

    return emailWrapper(`
    <div class="card" style="text-align:center;border-color:${scoreColor}40">
        <h2>Virtual Presence Scanner — DATRUM</h2>
        <div class="score-circle" style="background:${scoreColor}">${finalScore}</div>
        <h1>${finalScore}<span style="font-size:16px;font-weight:400">/10</span></h1>
        <p style="color:${scoreColor};font-weight:600">${interpretation}</p>
    </div>
    <div class="card">
        <h2>Resultados del Escaneo — ${url}</h2>
        ${rows}
    </div>
    <div class="card">
        <h2>Siguiente Paso</h2>
        <p>Cada punto rojo representa leads que se están escapando ahora mismo. Agenda una llamada de descubrimiento gratuita y te explico exactamente cómo cerrar esas brechas.</p>
        <a href="https://jldatrum.com" class="btn">Agenda Tu Llamada →</a>
    </div>`);
}

function buildNotifyEmail({ formType, fullName, email, phone, url, score, scoreColor, interpretation, consent, ts }) {
    return emailWrapper(`
    <div class="card" style="border-color:#FF6B3540">
        <h2>Nuevo Lead — ${formType}</h2>
        <h1 style="color:#FF6B35">🔔 Nueva Entrada</h1>
        <p class="muted">${ts}</p>
    </div>
    <div class="card">
        <h2>Datos del Lead</h2>
        ${fullName ? `<div class="row"><span class="teal">Nombre</span><span>${fullName}</span></div>` : ''}
        <div class="row"><span class="teal">Email</span><span>${email}</span></div>
        ${phone    ? `<div class="row"><span class="teal">Teléfono</span><span>${phone}</span></div>` : ''}
        <div class="row"><span class="teal">URL</span><span>${url}</span></div>
        <div class="row"><span class="teal">Puntaje</span><span style="color:${scoreColor};font-weight:700">${score}/10</span></div>
        <div class="row"><span class="teal">Interpretación</span><span>${interpretation}</span></div>
        <div class="row"><span class="teal">Consentimiento LEY 81</span><span style="color:${consent ? '#10b981' : '#ef4444'}">${consent ? '✓ Aceptado' : '✗ No aceptado'}</span></div>
    </div>`);
}
