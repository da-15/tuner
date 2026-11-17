'use strict';

// ---------- settings ----------
const TUNINGS = {
  standard:  { name: 'レギュラー (E A D G B E)', notes: [40, 45, 50, 55, 59, 64] },
  halfdown:  { name: '半音下げ (E♭ A♭ D♭ G♭ B♭ E♭)', notes: [39, 44, 49, 54, 58, 63] },
  dropd:     { name: 'ドロップD (D A D G B E)', notes: [38, 45, 50, 55, 59, 64] },
  wholedown: { name: '全音下げ (D G C F A D)', notes: [38, 43, 48, 53, 57, 62] },
  dadgad:    { name: 'DADGAD', notes: [38, 45, 50, 55, 57, 62] },
  openg:     { name: 'オープンG (D G D G B D)', notes: [38, 43, 50, 55, 59, 62] },
  guitalele: { name: 'ギタレレ (A D G C E A)', notes: [45, 50, 55, 60, 64, 69] },
  chromatic: { name: 'クロマチック（全音名）', notes: null },
};
// fast: 短い窓 + 弱いスムージング / stable: 長い窓 + 強めのスムージング
const SPEED = {
  fast:   { fftSize: 2048, median: 1, alpha: 0.55 },
  stable: { fftSize: 4096, median: 5, alpha: 0.25 },
};
const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const GATE_RMS = 0.002;   // これより小さい音は無視（iPhoneは入力が小さめなので低めに）
const HOLD_RATIO = 0.1;   // ピークの 1/10（-20dB）まで減衰したら針を止める
const REPLUCK_RATIO = 4;  // 止めた時点の音量の 4倍（+12dB）を超えたら弾き直しとみなす
const ENV_ALPHA = 0.2;    // 音量のならし具合
const CLEAR = 0.9;        // 音程の明確さ（YIN）の基準
const SWITCH_FRAMES = 3;  // 別の音への切り替えに必要な連続フレーム数
const IDLE_MS = 15000;    // 止めた表示を残しておく時間
const IN_TUNE = 2;        // ±2 cent 以内で合格
const NEAR = 8;

const store = {
  get(k, d) { try { const v = localStorage.getItem('tuner.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('tuner.' + k, JSON.stringify(v)); } catch {} },
};
let tuningKey = store.get('tuning', 'standard');
if (!TUNINGS[tuningKey]) tuningKey = 'standard';
let a4 = store.get('a4', 440);
let speedKey = store.get('speed', 'fast');
if (!SPEED[speedKey]) speedKey = 'fast';
let locked = null; // 固定中の弦 index

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const els = {
  tuning: $('tuning'), a4: $('a4'), display: $('display'), needle: $('needle'), note: $('note'),
  cents: $('cents'), freq: $('freq'), hint: $('hint'), strings: $('strings'), lockinfo: $('lockinfo'),
  speed: $('speed'), info: $('info'), start: $('start'), startBtn: $('startBtn'), startMsg: $('startMsg'),
  okmark: $('okmark'), level: $('level'),
};

const midiToFreq = (m) => a4 * Math.pow(2, (m - 69) / 12);
const noteName = (m) => NAMES[((m % 12) + 12) % 12];
const octave = (m) => Math.floor(m / 12) - 1;
const centsBetween = (f, ref) => 1200 * Math.log2(f / ref);

// gauge ticks
(function drawTicks() {
  const g = $('ticks');
  const cx = 150, cy = 165, r = 135;
  let html = '';
  for (let c = -50; c <= 50; c += 5) {
    const a = (c / 50) * 50 * Math.PI / 180;
    const major = c % 10 === 0;
    const len = c === 0 ? 18 : major ? 12 : 6;
    const x1 = cx + r * Math.sin(a), y1 = cy - r * Math.cos(a);
    const x2 = cx + (r - len) * Math.sin(a), y2 = cy - (r - len) * Math.cos(a);
    const col = c === 0 ? 'var(--ok)' : 'var(--dim)';
    html += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col}" stroke-width="${c === 0 ? 3 : major ? 2 : 1}" stroke-linecap="round"/>`;
    if (c !== 0 && c % 20 === 0) {
      const tx = cx + (r - 26) * Math.sin(a), ty = cy - (r - 26) * Math.cos(a) + 4;
      html += `<text x="${tx}" y="${ty}" fill="var(--dim)" font-size="10" text-anchor="middle">${c > 0 ? '+' + c : c}</text>`;
    }
  }
  g.innerHTML = html;
})();

// ---------- UI build ----------
function buildTuningSelect() {
  els.tuning.innerHTML = Object.entries(TUNINGS)
    .map(([k, t]) => `<option value="${k}" ${k === tuningKey ? 'selected' : ''}>${t.name}</option>`).join('');
}
function buildStrings() {
  const t = TUNINGS[tuningKey];
  if (!t.notes) { els.strings.classList.add('hidden'); els.lockinfo.textContent = ''; return; }
  els.strings.classList.remove('hidden');
  // 6弦 → 1弦 の順に表示
  els.strings.innerHTML = t.notes.map((m, i) =>
    `<button data-i="${i}" class="${locked === i ? 'locked' : ''}">${noteName(m)}<small>${6 - i}弦</small></button>`).join('');
  els.lockinfo.textContent = locked === null
    ? '弦をタップするとその弦に固定（もう一度で自動）'
    : `${6 - locked}弦に固定中（もう一度タップで自動）`;
}
function buildSpeed() {
  [...els.speed.children].forEach((b) => b.classList.toggle('on', b.dataset.v === speedKey));
}
buildTuningSelect(); buildStrings(); buildSpeed(); els.a4.textContent = a4;

els.tuning.addEventListener('change', () => {
  tuningKey = els.tuning.value; store.set('tuning', tuningKey); locked = null; buildStrings(); resetSmoothing();
});
els.strings.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  const i = +b.dataset.i; locked = locked === i ? null : i; buildStrings(); resetSmoothing();
});
els.speed.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  speedKey = b.dataset.v; store.set('speed', speedKey); buildSpeed(); applySpeed();
});
function setA4(v) { a4 = Math.max(430, Math.min(450, v)); els.a4.textContent = a4; store.set('a4', a4); }
$('a4down').addEventListener('click', () => setA4(a4 - 1));
$('a4up').addEventListener('click', () => setA4(a4 + 1));

// ---------- audio ----------
let ctx = null, analyser = null, buf = null, stream = null, running = false;
let source = null, hp = null, mute = null; // ノードは参照を保持しておく
let wakeLock = null;

async function start() {
  els.startMsg.classList.remove('err');
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    showStartError('マイクを使うには HTTPS で開く必要があります（GitHub Pages などで公開してください）。');
    return;
  }
  try {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    }
    // iOS対策：先にマイクを取得してから AudioContext を作る（逆順だと無音になることがある）
    if (!stream) {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      stream.getAudioTracks()[0].addEventListener('ended', () => { stream = null; source = null; stop(); });
    }
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    ctx.onstatechange = () => { if (ctx.state !== 'running' && running) stop(); updateInfo(); };
    if (ctx.state !== 'running') { try { await ctx.resume(); } catch {} }
    if (!source) {
      // source はグローバルに保持（参照が切れると Safari で回収されて無音になる）
      source = ctx.createMediaStreamSource(stream);
      hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 45;
      if (!analyser) { analyser = ctx.createAnalyser(); analyser.smoothingTimeConstant = 0; }
      if (!mute) { mute = ctx.createGain(); mute.gain.value = 0; analyser.connect(mute).connect(ctx.destination); }
      source.connect(hp).connect(analyser);
      applySpeed();
    }
    if (ctx.state !== 'running') {
      // まだ止まっている場合は、もう一度タップしてもらって再開
      showStartError('音声の開始がブロックされました。もう一度タップしてください。');
      els.startBtn.textContent = 'タップして再開';
      return;
    }
    els.start.classList.add('hidden');
    els.startMsg.classList.remove('err');
    requestWakeLock();
    if (!running) { running = true; requestAnimationFrame(tick); }
  } catch (err) {
    console.error(err);
    const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
    showStartError(denied
      ? 'マイクの使用が許可されませんでした。ブラウザの設定でマイクを許可してから、もう一度タップしてください。'
      : 'マイクを開始できませんでした：' + (err && err.message ? err.message : err));
  }
}
function stop() {
  running = false;
  els.start.classList.remove('hidden');
  els.startBtn.textContent = 'タップして再開';
}
function showStartError(msg) {
  els.start.classList.remove('hidden');
  els.startMsg.textContent = msg; els.startMsg.classList.add('err');
}
function applySpeed() {
  if (!analyser) return;
  analyser.fftSize = SPEED[speedKey].fftSize;
  buf = new Float32Array(analyser.fftSize);
  resetSmoothing();
  updateInfo();
}
function updateInfo() {
  if (!ctx || !analyser) return;
  const winMs = (analyser.fftSize / ctx.sampleRate) * 1000;
  const tr = stream && stream.getAudioTracks()[0];
  const st = tr && tr.getSettings ? tr.getSettings() : {};
  const micRate = st.sampleRate ? ` / マイク ${st.sampleRate}Hz` : '';
  els.info.textContent = `${ctx.sampleRate}Hz${micRate} ・ 解析窓 ${winMs.toFixed(0)}ms ・ 状態 ${ctx.state}`;
}

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch { /* 非対応 or 拒否：無視 */ }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (ctx && ctx.state !== 'running') {
      ctx.resume().catch(() => {}).then(() => { if (ctx.state !== 'running') stop(); });
    }
    if (running) requestWakeLock();
  }
});
els.startBtn.addEventListener('click', start);

// ---------- smoothing ----------
let hist = [], smooth = null;
let cand = null, candN = 0;                    // 別の音へ切り替える候補
let envRms = 0, peakRms = 0, held = false, heldAt = 0, holdRms = 0, confirmN = 0;
function resetSmoothing() { hist = []; smooth = null; cand = null; candN = 0; }
function median(arr) {
  const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)];
}
function smoothFreq(f) {
  const cfg = SPEED[speedKey];
  hist.push(f); if (hist.length > cfg.median) hist.shift();
  const m = median(hist);
  smooth = smooth === null ? m : smooth * Math.pow(m / smooth, cfg.alpha); // 対数領域で補間
  return smooth;
}
// オクターブ誤検出の補正：基音が弱い低音弦（ギタレレの6弦Aなど）は余韻で2倍音を拾いやすい
function correctOctave(f) {
  // 追いかけている音（または止めている音）のちょうど1オクターブ上なら、倍音を拾ったとみなす
  if (smooth !== null && Math.abs(centsBetween(f, smooth) - 1200) < 60) return f / 2;
  // どの弦にも近くないのに、半分の周波数ならどれかの弦に合う場合も補正
  const t = TUNINGS[tuningKey];
  if (t.notes) {
    const targets = locked !== null ? [t.notes[locked]] : t.notes;
    const dist = (x) => Math.min(...targets.map((n) => Math.abs(centsBetween(x, midiToFreq(n)))));
    if (dist(f) > 100 && dist(f / 2) < 60) return f / 2;
  }
  return f;
}
// 今の音から近ければそのまま追従。大きく離れた音は数フレーム続いたときだけ採用（一瞬の誤検出で針が飛ばない）
function acceptFreq(f) {
  if (smooth !== null && Math.abs(centsBetween(f, smooth)) <= 35) { cand = null; candN = 0; return smoothFreq(f); }
  if (cand !== null && Math.abs(centsBetween(f, cand)) <= 30) candN++; else { cand = f; candN = 1; }
  if (candN >= (smooth === null ? 2 : SWITCH_FRAMES)) { resetSmoothing(); return smoothFreq(f); }
  return null;
}

// ---------- main loop ----------
function tick() {
  if (!running) return;
  analyser.getFloatTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  const rms = Math.sqrt(sum / buf.length);
  // 入力レベルメーター（-60dB〜0dB）
  const db = 20 * Math.log10(rms + 1e-9);
  els.level.style.width = Math.max(0, Math.min(100, (db + 60) / 60 * 100)) + '%';
  els.level.classList.toggle('gated', rms <= GATE_RMS);

  const now = performance.now();
  envRms = envRms === 0 ? rms : envRms + ENV_ALPHA * (rms - envRms); // うなり等で揺れないよう音量をならす
  const res = rms > GATE_RMS ? PitchDetector.yin(buf, ctx.sampleRate, 60, 1400, 0.15) : null;
  const clear = !!res && res.clarity >= CLEAR;
  const freq = res ? correctOctave(res.freq) : 0;

  if (held) {
    // 固定中：止めた時点よりはっきり大きく、かつ音程が明確な状態が続いたら「弾き直し」とみなして解除
    // （ペグに触れた雑音は音量が上がっても音程が不明確なので解除されない）
    if (clear && rms > Math.max(GATE_RMS * 5, holdRms * REPLUCK_RATIO)) {
      if (++confirmN >= 2) {
        held = false; confirmN = 0;
        els.display.classList.remove('held');
        peakRms = envRms = rms;
        resetSmoothing();
        render(smoothFreq(freq));
      }
    } else {
      confirmN = 0;
      if (now - heldAt > IDLE_MS) {
        held = false; peakRms = 0;
        els.display.classList.remove('held');
        resetSmoothing();
        setIdle();
      }
    }
    requestAnimationFrame(tick);
    return;
  }

  peakRms = Math.max(peakRms, envRms);
  // 余韻がピークから -20dB を下回ったら（または音が消えたら）針をその位置で止める
  if (smooth !== null && (rms <= GATE_RMS || envRms < peakRms * HOLD_RATIO)) {
    held = true; heldAt = now; holdRms = envRms; confirmN = 0;
    els.display.classList.add('held');
  } else if (res) {
    const weak = envRms < peakRms * 0.3;     // 余韻が弱くなってきたら明確な音程だけ使う
    if (!weak || clear) {
      const f = acceptFreq(freq);
      if (f !== null) render(f);
    }
  }
  requestAnimationFrame(tick);
}

function setIdle() {
  els.display.classList.add('idle');
  els.hint.textContent = ''; els.hint.className = 'hint';
  els.okmark.setAttribute('opacity', '0');
  [...els.strings.children].forEach((b) => b.classList.remove('active', 'tuned'));
}

function render(f) {
  const t = TUNINGS[tuningKey];
  let m;
  if (t.notes) {
    if (locked !== null) m = t.notes[locked];
    else {
      let best = Infinity;
      t.notes.forEach((n) => { const d = Math.abs(centsBetween(f, midiToFreq(n))); if (d < best) { best = d; m = n; } });
    }
  } else {
    m = Math.round(69 + 12 * Math.log2(f / a4));
  }
  const c = centsBetween(f, midiToFreq(m));
  const abs = Math.abs(c);
  const cls = abs <= IN_TUNE ? 'ok' : abs <= NEAR ? 'near' : 'off';

  els.display.classList.remove('idle');
  els.note.innerHTML = `<span class="${cls}">${noteName(m)}</span><sub>${octave(m)}</sub>`;
  els.cents.textContent = (c > 0 ? '+' : '') + c.toFixed(1);
  els.freq.textContent = f.toFixed(1);
  const angle = Math.max(-50, Math.min(50, c)); // ±50cent → ±50°
  els.needle.setAttribute('transform', `rotate(${angle} 150 165)`);
  els.okmark.setAttribute('opacity', cls === 'ok' ? '1' : '0');

  if (abs > 300 && t.notes) els.hint.textContent = c < 0 ? 'かなり低い' : 'かなり高い';
  else if (cls === 'ok') els.hint.textContent = '✓ OK';
  else els.hint.textContent = c < 0 ? '↑ 上げる（締める）' : '↓ 下げる（緩める）';
  els.hint.className = 'hint ' + cls;

  if (t.notes) {
    const idx = t.notes.indexOf(m);
    [...els.strings.children].forEach((b, i) => {
      b.classList.toggle('active', i === idx);
      b.classList.toggle('tuned', i === idx && cls === 'ok');
    });
  }
}

// ---------- PWA ----------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
