// =====================================================================
// Cloudflare Worker — submitcalculator.julioernestolv.workers.dev
//
// Routes two calculator types:
//   1. VirtualPresenceScanner  → scans target URL, scores, logs + emails
//   2. LeadGenScorecard        → passthrough (frontend calculates score)
//
// Both send data to Google Apps Script → Google Sheet + Email
// =====================================================================

// ── CONFIG ──────────────────────────────────────────────
const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbw59uAdsZPU6TA_14TsmJp_ZmWcpJsUIm_bRSvL-LYfF4_atDM3DM0v74ExALpncHYO/exec';

// ── CORS HEADERS ────────────────────────────────────────
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

// ── MAIN HANDLER ────────────────────────────────────────
export default {
    async fetch(request, env, ctx) {
        // Handle CORS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        // Guard: GET requests return status
        if (request.method === 'GET') {
            return new Response(
                JSON.stringify({ status: 'ok', calculator: 'DATRUM-multi', version: '2.0' }),
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

            // ── ROUTE BY FORM TYPE ──────────────────────────
            let payload;

            if (formType === 'lead-gen-scorecard' || Calculator_Name === 'LeadGenScorecard') {
                // ────────────────────────────────────────────
                // LEAD GEN SCORECARD — Passthrough
                // Frontend already calculated the score.
                // Just relay everything to Apps Script as-is.
                // ────────────────────────────────────────────
                payload = {
                    url: url,
                    email: email || 'N/A',
                    fullName: body.fullName || '',
                    phone: body.phone || '',
                    consent: body.consent === true,
                    score: body.score != null ? body.score : (body.finalScore ? parseFloat(body.finalScore) / 10 : 0),
                    Calculator_Name: 'LeadGenScorecard',
                    q1: body.q1 != null ? body.q1 : '',
                    q2: body.q2 != null ? body.q2 : '',
                    q3: body.q3 != null ? body.q3 : '',
                    q4: body.q4 != null ? body.q4 : '',
                    q5: body.q5 != null ? body.q5 : '',
                    scoreColor: body.scoreColor || '#f59e0b',
                    interpretation: body.interpretation || '',
                    details: [
                        body.q1 != null ? body.q1 : 0,
                        body.q2 != null ? body.q2 : 0,
                        body.q3 != null ? body.q3 : 0,
                        body.q4 != null ? body.q4 : 0,
                        body.q5 != null ? body.q5 : 0
                    ]
                };

            } else {
                // ────────────────────────────────────────────
                // VIRTUAL PRESENCE SCANNER — Scan the URL
                // Worker fetches target site and checks for
                // Facebook Pixel, GTM, GA, HTTPS, Viewport
                // ────────────────────────────────────────────
                const scanResults = await scanWebsite(url);
                const score = scanResults.reduce((a, b) => a + b, 0) / scanResults.length;

                let scoreColor, interpretation;
                if (score >= 0.8) {
                    scoreColor = '#10b981';
                    interpretation = 'Your virtual presence is strong.';
                } else if (score >= 0.5) {
                    scoreColor = '#f59e0b';
                    interpretation = 'Your virtual presence needs improvement.';
                } else {
                    scoreColor = '#ef4444';
                    interpretation = 'Your website is hurting your practice.';
                }

                payload = {
                    url: url,
                    email: email || 'N/A',
                    consent: body.consent === true,
                    score: score,
                    Calculator_Name: 'VirtualPresenceScanner',
                    q1: scanResults[0],
                    q2: scanResults[1],
                    q3: scanResults[2],
                    q4: scanResults[3],
                    q5: scanResults[4],
                    scoreColor: scoreColor,
                    interpretation: interpretation,
                    details: scanResults
                };
            }

            // ── SEND TO GOOGLE APPS SCRIPT (non-blocking) ───
            ctx.waitUntil(
                fetch(GOOGLE_SCRIPT_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                    redirect: 'follow'
                }).catch(err => console.error('Apps Script error:', err))
            );

            // ── RETURN RESULTS TO FRONTEND ──────────────────
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

// ── SCAN FUNCTIONS (VP Scanner only) ────────────────────
async function scanWebsite(url) {
    try {
        const response = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ScanBot/1.0)' },
            redirect: 'follow'
        });
        const html = await response.text();

        const q1 = /fbq\(|facebook\.net\/en_US\/fbevents/i.test(html) ? 1 : 0;   // Facebook Pixel
        const q2 = /googletagmanager\.com\/gtm/i.test(html) ? 1 : 0;              // GTM
        const q3 = /google-analytics\.com|gtag\(/i.test(html) ? 1 : 0;            // Google Analytics
        const q4 = url.startsWith('https://') ? 1 : 0;                             // HTTPS/SSL
        const q5 = /meta\s+name=["']viewport/i.test(html) ? 1 : 0;                // Mobile Viewport

        return [q1, q2, q3, q4, q5];
    } catch {
        return [0, 0, 0, 0, 0];
    }
}
