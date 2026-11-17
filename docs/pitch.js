// YIN pitch detection (de Cheveigné & Kawahara, 2002)
// buf: Float32Array of time-domain samples
(function (global) {
  function yin(buf, sampleRate, minFreq, maxFreq, threshold) {
    minFreq = minFreq || 60;
    maxFreq = maxFreq || 1400;
    threshold = threshold || 0.15;

    const maxTau = Math.min(Math.floor(sampleRate / minFreq), Math.floor(buf.length / 2));
    const minTau = Math.max(2, Math.floor(sampleRate / maxFreq));
    const W = buf.length - maxTau;

    // 1. difference function
    const d = new Float32Array(maxTau + 2);
    for (let tau = 1; tau <= maxTau; tau++) {
      let s = 0;
      for (let i = 0; i < W; i++) {
        const x = buf[i] - buf[i + tau];
        s += x * x;
      }
      d[tau] = s;
    }

    // 2. cumulative mean normalized difference
    const c = new Float32Array(maxTau + 2);
    c[0] = 1;
    let run = 0;
    for (let tau = 1; tau <= maxTau; tau++) {
      run += d[tau];
      c[tau] = run > 0 ? (d[tau] * tau) / run : 1;
    }

    // 3. absolute threshold -> first dip below threshold, then walk to its local minimum
    let tau = -1;
    for (let t = minTau; t <= maxTau; t++) {
      if (c[t] < threshold) {
        while (t + 1 <= maxTau && c[t + 1] < c[t]) t++;
        tau = t;
        break;
      }
    }
    if (tau < 0) return null;

    // 4. parabolic interpolation on the raw difference function
    let better = tau;
    if (tau > 1 && tau < maxTau) {
      const s0 = d[tau - 1], s1 = d[tau], s2 = d[tau + 1];
      const den = s0 + s2 - 2 * s1;
      if (den > 0) better = tau + (s0 - s2) / (2 * den);
    }
    return { freq: sampleRate / better, clarity: 1 - c[tau] };
  }

  global.PitchDetector = { yin: yin };
})(typeof self !== 'undefined' ? self : globalThis);
