// ── SCORECARD WIDGET ───────────────────────────────────
const WORKER_URL = 'https://submitcalculator.julioernestolv.workers.dev/';
const WEIGHTS = [30, 25, 20, 15, 10];

let currentStep = 0;
const answers      = [null, null, null, null, null]; // Q1-Q5 numeric values
const answerLabels = ['', '', '', '', ''];            // Q1-Q5 selected text
let currentEmail = '';
let currentUrl   = '';
let lastScore    = null;
let scoreRaf     = null;
let lastColor    = '';
let lastTier     = '';
let lastDesc     = '';

const QUESTION_META = [
  { label: 'Volumen de Leads',       weight: 30, question: 'Leads calificados nuevos por mes' },
  { label: 'Calidad de Leads',       weight: 25, question: 'Porcentaje de leads que están calificados' },
  { label: 'Visibilidad en Búsqueda', weight: 20, question: 'Visibilidad cuando los prospectos te buscan' },
  { label: 'Ajuste de Cliente',      weight: 15, question: 'Calidad de ajuste en los leads que recibes' },
  { label: 'Esfuerzo Outbound',      weight: 10, question: 'Horas semanales dedicadas a marketing outbound' },
];

function updateProgress() {
  const segs = document.querySelectorAll('.progress-seg');
  segs.forEach((seg, i) => {
    seg.classList.remove('active', 'completed');
    if (i < currentStep)      seg.classList.add('completed');
    else if (i === currentStep) seg.classList.add('active');
  });
  const total = 6;
  document.getElementById('stepCounter').textContent = `Paso ${currentStep + 1} de ${total}`;
}

function selectOption(stepIdx, value, btn) {
  // Deselect all in same step
  btn.closest('.options').querySelectorAll('.option-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  answers[stepIdx]      = value;
  answerLabels[stepIdx] = btn.querySelector('.opt-text').textContent.trim();
  // Enable next
  const nextBtn = document.getElementById('btnNext');
  nextBtn.classList.add('enabled');
  // Update button text for email step
  if (currentStep === 5) {
    nextBtn.textContent = 'Ver Mi Puntaje →';
  }
}

function nextStep() {
  const nextBtn = document.getElementById('btnNext');

  // Email/URL step (step 5 = index 5, which is the 6th panel)
  if (currentStep === 5) {
    const email = document.getElementById('emailInput').value.trim();
    const url   = document.getElementById('urlInput').value.trim();
    if (!email || !url) {
      document.getElementById('emailInput').focus();
      return;
    }
    showScore(email, url);
    return;
  }

  // Move to next step
  document.getElementById(`step-${currentStep}`).classList.remove('active');
  currentStep++;
  document.getElementById(`step-${currentStep}`).classList.add('active');

  updateProgress();

  // Reset next button
  nextBtn.classList.remove('enabled');

  // Special handling for email step
  if (currentStep === 5) {
    nextBtn.classList.add('enabled');
    nextBtn.textContent = 'Ver Mi Puntaje →';
    // Watch inputs
    ['emailInput','urlInput'].forEach(id => {
      document.getElementById(id).addEventListener('input', checkEmailStep);
    });
  } else {
    nextBtn.textContent = 'Next →';
  }
}

function checkEmailStep() {
  const email = document.getElementById('emailInput').value.trim();
  const url   = document.getElementById('urlInput').value.trim();
  const nextBtn = document.getElementById('btnNext');
  if (email && url) {
    nextBtn.classList.add('enabled');
  } else {
    nextBtn.classList.remove('enabled');
  }
}

function showScore(email, url) {
  // Calculate
  const rawScore = (
    answers[0] * 30 +
    answers[1] * 25 +
    answers[2] * 20 +
    answers[3] * 15 +
    answers[4] * 10
  ) / 100;
  const finalScore = rawScore; // 0–10

  let color, tier, desc;
  if (finalScore >= 8) {
    color = '#2d7d4f';
    tier  = 'La distribución está funcionando.';
    desc  = 'Tu sitio web está generando leads calificados consistentemente. El sistema funciona — ahora se trata de optimizar volumen y calidad de ajuste.';
  } else if (finalScore >= 5) {
    color = '#b8860b';
    tier  = 'Fugas significativas detectadas.';
    desc  = 'Estás generando algunos leads, pero el embudo tiene huecos. Los prospectos calificados están encontrando a competidores menos capaces en vez de a ti.';
  } else {
    color = '#c0392b';
    tier  = 'Tu marca no está convirtiendo su audiencia.';
    desc  = 'Tu sitio web no está haciendo su trabajo. Los clientes correctos existen — simplemente no te están encontrando. Esto se arregla.';
  }

  // Animate ring
  const scoreResult  = document.getElementById('scoreResult');
  const widgetFooter = document.getElementById('widgetFooter');
  const ringFg       = document.getElementById('ring-fg');
  const scoreDisplay = document.getElementById('scoreDisplay');

  // Hide all steps and footer
  document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
  widgetFooter.style.display = 'none';

  // Show result
  scoreResult.classList.add('visible');
  animateScore(scoreDisplay, finalScore);
  scoreDisplay.style.color     = color;
  ringFg.style.stroke          = color;
  document.getElementById('scoreTierLabel').textContent  = tier;
  document.getElementById('scoreTierLabel').style.color  = color;
  document.getElementById('scoreDesc').textContent       = desc;

  // Store for PDF generation
  currentEmail = email;
  currentUrl   = url;
  lastScore    = finalScore;
  lastColor    = color;
  lastTier     = tier;
  lastDesc     = desc;

  // Animate ring (circumference = 2π×52 ≈ 326.7)
  const circumference = 326.7;
  const offset = circumference - (finalScore / 10) * circumference;
  setTimeout(() => { ringFg.style.strokeDashoffset = offset; }, 50);

  // Auto-generate PDF after ring animation completes
  setTimeout(() => downloadPDF(), 1400);

  // Send to Worker
  fetch(WORKER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url:            url,
      email:          email,
      formType:       'lead-gen-scorecard',
      Calculator_Name:'LeadGenScorecard',
      finalScore:     finalScore.toFixed(1),
      score:          finalScore / 10,
      q1:             answers[0],
      q2:             answers[1],
      q3:             answers[2],
      q4:             answers[3],
      q5:             answers[4],
      scoreColor:     color,
      interpretation: tier
    })
  }).catch(() => {});
}

// Count the score up in step with the ring sweep. Cosmetic only:
// downloadPDF() reads lastScore, never the DOM, so this cannot affect
// the PDF or the Worker payload.
function animateScore(el, target) {
  if (scoreRaf) { cancelAnimationFrame(scoreRaf); scoreRaf = null; }
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.textContent = target.toFixed(1);
    return;
  }
  const DUR = 1150;                    // 50ms lead-in + 1150 = 1200ms, 200ms clear of the 1400ms PDF
  let t0 = null;
  let done = false;
  const finish = () => { done = true; scoreRaf = null; el.textContent = target.toFixed(1); };
  const step = (ts) => {
    if (t0 === null) t0 = ts;
    const p = Math.min((ts - t0) / DUR, 1);
    const e = 1 - Math.pow(1 - p, 3);  // easeOutCubic, matching the ring's cubic-bezier(.4,0,.2,1)
    el.textContent = (target * e).toFixed(1);
    if (p < 1) { scoreRaf = requestAnimationFrame(step); } else { finish(); }
  };
  setTimeout(() => { scoreRaf = requestAnimationFrame(step); }, 50);  // match the ring lead-in
  // requestAnimationFrame is paused in a hidden/background tab, so the count
  // would never run and the score would sit at the placeholder. setTimeout still
  // fires there, so guarantee the final value lands before the PDF at 1400ms.
  setTimeout(() => { if (!done) finish(); }, DUR + 130);
}

function resetWidget() {
  currentStep = 0;
  answers.fill(null);

  document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
  document.getElementById('step-0').classList.add('active');
  document.getElementById('scoreResult').classList.remove('visible');
  document.getElementById('widgetFooter').style.display = '';

  document.querySelectorAll('.option-btn').forEach(b => b.classList.remove('selected'));
  document.getElementById('emailInput').value = '';
  document.getElementById('urlInput').value   = '';

  const nextBtn = document.getElementById('btnNext');
  nextBtn.classList.remove('enabled');
  nextBtn.textContent = 'Next →';

  // Reset ring
  document.getElementById('ring-fg').style.strokeDashoffset = '326.7';

  // Stop any in-flight count-up: an orphaned frame would tick a stale
  // number over the next session.
  if (scoreRaf) { cancelAnimationFrame(scoreRaf); scoreRaf = null; }
  document.getElementById('scoreDisplay').textContent = '0.0';

  updateProgress();
}

// Init on email step — enable next only when both filled
(function() {
  // Next button starts disabled on email step; handled in nextStep()
})();

// ── PDF GENERATION ────────────────────────────────────
function downloadPDF() {
  if (!window.jspdf || lastScore === null) return;

  const btn = document.getElementById('btnDownloadPDF');
  const btnLbl = document.getElementById('btnDownloadLabel');
  if (btn) { btn.classList.add('generating'); if (btnLbl) btnLbl.textContent = 'Generando…'; }

  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const W = 210, margin = 20, contentW = W - margin * 2;

    // ── Tier color as RGB
    const tierRGB = lastColor === '#2d7d4f' ? [45,125,79]
                  : lastColor === '#b8860b' ? [184,134,11]
                  : [192,57,43];

    // ── Header band
    doc.setFillColor(12, 15, 15);
    doc.rect(0, 0, W, 36, 'F');
    doc.setTextColor(232, 240, 240);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text('jl.datrum', margin, 16);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(106, 138, 138);
    doc.text('Reporte de Auditoría de Ingresos de Marca', margin, 26);
    // White dot accent
    doc.setFillColor(255, 255, 255);
    doc.circle(margin - 5, 15, 1.2, 'F');

    // ── Meta line
    const dateStr = new Date().toLocaleDateString('es-PA', { month: 'long', day: 'numeric', year: 'numeric' });
    doc.setFontSize(8);
    doc.setTextColor(140, 140, 140);
    let y = 46;
    doc.text(`Generado: ${dateStr}`, margin, y);
    doc.text(`Sitio web: ${currentUrl}`, margin, y + 6);

    // ── Score block
    y = 68;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(52);
    doc.setTextColor(...tierRGB);
    doc.text(lastScore.toFixed(1), margin, y);

    doc.setFontSize(11);
    doc.setTextColor(...tierRGB);
    doc.text(lastTier, margin, y + 10);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(90, 90, 90);
    const descLines = doc.splitTextToSize(lastDesc, contentW);
    doc.text(descLines, margin, y + 18);

    // ── Divider
    y = y + 18 + descLines.length * 5 + 8;
    doc.setDrawColor(220, 220, 220);
    doc.line(margin, y, W - margin, y);

    // ── Breakdown header
    y += 10;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(12, 15, 15);
    doc.text('DESGLOSE POR DIMENSIÓN', margin, y);

    // Column headers
    y += 7;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(106, 138, 138);
    doc.text('DIMENSIÓN',   margin,          y);
    doc.text('PESO',        margin + 70,     y);
    doc.text('PUNTAJE',     margin + 95,     y);
    doc.text('TU RESPUESTA',margin + 115,    y);
    doc.setDrawColor(220, 220, 220);
    doc.line(margin, y + 3, W - margin, y + 3);

    // Rows
    QUESTION_META.forEach((q, i) => {
      y += 14;
      const val = answers[i];
      const answerText = answerLabels[i] || '—';
      const contribution = ((val * q.weight) / 100).toFixed(2);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(30, 30, 30);
      doc.text(q.label, margin, y);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(90, 90, 90);
      doc.text(`${q.weight}%`, margin + 70, y);

      // Score pill color
      const scoreRGB = val === 10 ? [45,125,79] : val === 5 ? [184,134,11] : [192,57,43];
      doc.setFillColor(...scoreRGB);
      doc.roundedRect(margin + 90, y - 5, 18, 7, 1.5, 1.5, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.text(contribution, margin + 94, y);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(90, 90, 90);
      const answerWrapped = doc.splitTextToSize(answerText, contentW - 97);
      doc.text(answerWrapped, margin + 115, y);

      // Row separator
      doc.setDrawColor(240, 240, 240);
      doc.line(margin, y + 6, W - margin, y + 6);
    });

    // ── Total row
    y += 14;
    doc.setFillColor(245, 245, 245);
    doc.rect(margin, y - 6, contentW, 10, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(12, 15, 15);
    doc.text('PUNTAJE FINAL', margin + 2, y);
    doc.setTextColor(...tierRGB);
    doc.text(`${lastScore.toFixed(1)} / 10`, margin + 90, y);

    // ── Divider
    y += 16;
    doc.setDrawColor(220, 220, 220);
    doc.line(margin, y, W - margin, y);

    // ── Next steps block
    y += 10;
    doc.setFillColor(12, 15, 15);
    doc.rect(margin, y, contentW, 28, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(232, 240, 240);
    doc.text('¿Listo para construir una marca que vende?', margin + 6, y + 10);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(106, 138, 138);
    doc.text('Agenda una sesión de estrategia en jldatrum.com', margin + 6, y + 18);
    // White accent line
    doc.setFillColor(255, 255, 255);
    doc.rect(margin, y, 3, 28, 'F');

    // ── Footer
    doc.setFontSize(7);
    doc.setTextColor(160, 160, 160);
    doc.text('DATRUM · jldatrum.com · Diseño de imanes de ventas para deportes, moda y creativos', margin, 287);

    doc.save(`datrum-diagnostico-${lastScore.toFixed(1).replace('.','_')}.pdf`);
  } catch(e) {
    console.error('PDF generation failed:', e);
  } finally {
    if (btn) { btn.classList.remove('generating'); if (btnLbl) btnLbl.textContent = 'Descargar Reporte PDF'; }
  }
}

