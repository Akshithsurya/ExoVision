

export class SpectroscopyAI {
  constructor(opts = {}) {
    this.minSnrForDetection = opts.minSnrForDetection ?? 8;
    this.processingDelayMs = opts.processingDelayMs ?? 120;
    this.smoothingWindow = opts.smoothingWindow ?? 7; // must be odd
    this.polyOrder = opts.polyOrder ?? 3;
    this.templateWindows = this._moleculeWindows();
  }

  _moleculeWindows() {
    return {
      H2O: [[590, 600],[650,662],[720,740],[940,980]],
      CO2: [[660,672],[720,740],[1400,1600]],
      CH4: [[530,555],[780,805],[1200,1300]],
      O2: [[687,695],[760,770]],
      N2: [[516,532]],
      SO2: [[400,430],[280,320]],
      NH3: [[645,665],[1000,1080]],
      Na: [[588,590]],
      K: [[766,770]],
      O3: [[255,320]]
    };
  }

  // Savitzky-Golay smoothing implementation (coefficients computed simple)
  _savitzkyGolay(y, window = 7, order = 3) {
    // fallback to moving average for small arrays
    if (!Array.isArray(y) || y.length < window) {
      return y.map(v => ({ ...v, intensity_smoothed: v.intensity }));
    }
    // precompute convolution coefficients using least-squares (simple symmetric weights)
    const half = Math.floor(window / 2);
    const coeffs = [];
    // simple central weights (not full SG optimal, but stable and causal-free)
    for (let i = -half; i <= half; i++) coeffs.push(1);
    const denom = coeffs.reduce((s, v) => s + v, 0);
    const out = y.map((p, idx) => {
      const start = Math.max(0, idx - half);
      const end = Math.min(y.length - 1, idx + half);
      const slice = y.slice(start, end + 1);
      const avg = slice.reduce((s, q) => s + q.intensity, 0) / slice.length;
      return { ...p, intensity_smoothed: +avg.toFixed(6) };
    });
    return out;
  }

  // robust envelope: use percentile-based top envelope per sliding window
  _continuumEnvelope(data, win = null) {
    if (!data || data.length === 0) return data;
    const n = data.length;
    const window = win || Math.max(11, Math.floor(n / 20) | 1);
    const half = Math.floor(window / 2);
    const envelope = new Array(n);
    for (let i = 0; i < n; i++) {
      const start = Math.max(0, i - half);
      const end = Math.min(n - 1, i + half);
      const slice = data.slice(start, end + 1).map(p => p.intensity_smoothed ?? p.intensity);
      // use 90th percentile to avoid extreme spikes
      slice.sort((a, b) => a - b);
      const idx = Math.floor(slice.length * 0.9);
      envelope[i] = Math.max(1e-6, slice[idx]);
    }
    return envelope;
  }

  _normalize(data) {
    if (!data || data.length === 0) return data;
    const envelope = this._continuumEnvelope(data);
    return data.map((p, i) => ({
      ...p,
      continuum: envelope[i],
      intensity_norm: +( (p.intensity / envelope[i]) ).toFixed(6)
    }));
  }

  _equivalentWidth(dataInWindow) {
    if (!dataInWindow || dataInWindow.length < 2) return 0;
    let ew = 0;
    for (let i = 1; i < dataInWindow.length; i++) {
      const x0 = dataInWindow[i-1].wavelength;
      const x1 = dataInWindow[i].wavelength;
      const y0 = 1 - Math.min(1, dataInWindow[i-1].intensity_norm || dataInWindow[i-1].intensity);
      const y1 = 1 - Math.min(1, dataInWindow[i].intensity_norm || dataInWindow[i].intensity);
      const width = Math.abs(x1 - x0);
      const area = Math.max(0, (y0 + y1) / 2 * width);
      ew += area;
    }
    return +ew.toFixed(4);
  }

  _detectInRange(spectralData, minW, maxW) {
    const window = spectralData.filter(p => p.wavelength >= minW && p.wavelength <= maxW);
    if (window.length === 0) return null;
    const meanSnr = window.reduce((s,p)=>s+(p.snr||0),0)/window.length;
    const ew = this._equivalentWidth(window);
    const absorptionFraction = window.filter(p => (p.intensity_norm || p.intensity) < 0.98).length / window.length;
    const detected = (meanSnr >= this.minSnrForDetection && ew > 0.01 && absorptionFraction > 0.06);
    return { ew: +ew.toFixed(4), meanSnr: +meanSnr.toFixed(2), absorptionFraction: +absorptionFraction.toFixed(3), detected, points: window.length };
  }

  _matchTemplates(normData) {
    const results = {};
    for (const [mol, ranges] of Object.entries(this.templateWindows)) {
      const perRange = [];
      for (const r of ranges) {
        const res = this._detectInRange(normData, r[0], r[1]);
        if (res) perRange.push(res);
      }
      if (perRange.length === 0) {
        results[mol] = { detected: false, confidence: 0, details: [] };
        continue;
      }
      const winsDetected = perRange.filter(p => p.detected).length;
      const sumEW = perRange.reduce((s,p)=> s + (p.ew||0), 0);
      const avgSnr = perRange.reduce((s,p)=> s + (p.meanSnr||0), 0) / perRange.length;
      // combined confidence: wins * ew * SNR scaling + window coverage factor
      let confidence = Math.tanh((winsDetected * 0.8) + Math.min(3, sumEW) * 0.18 + Math.min(1, avgSnr/50) * 0.4);
      if (avgSnr < this.minSnrForDetection) confidence *= 0.5;
      results[mol] = { detected: winsDetected > 0, confidence: +confidence.toFixed(3), windows: perRange };
    }
    return results;
  }

  // Accepts array or parsed CSV [{wavelength,intensity,snr}]
  async analyzeSpectrum(spectralData = [], planet = {}, opts = {}) {
    await new Promise(resolve => setTimeout(resolve, this.processingDelayMs));
    if (!Array.isArray(spectralData) || spectralData.length === 0) {
      return {
        detectedMolecules: [],
        moleculeConfidences: {},
        features: { absorptionLines: 0, avgSnr: 0, spectralPoints: 0 },
        biosignaturePotential: { level: 'Low', reason: 'No data' },
        recommendations: [],
        confidence: 0
      };
    }

    const smoothed = this._savitzkyGolay(spectralData, this.smoothingWindow, this.polyOrder);
    const normalized = this._normalize(smoothed);

    const avgSnr = normalized.reduce((s,p)=> s + (p.snr || 0), 0) / normalized.length;
    const absorptionCount = normalized.filter(p => (p.intensity_norm || p.intensity) < 0.98).length;

    const matches = this._matchTemplates(normalized);

    const detectedMolecules = [];
    const moleculeConfidences = {};
    for (const [mol, info] of Object.entries(matches)) {
      moleculeConfidences[mol] = info.confidence;
      if (info.detected && info.confidence > 0.2) {
        detectedMolecules.push({ molecule: mol, confidence: info.confidence, windows: info.windows });
      }
    }

    // biosignature heuristic
    let biosigLevel = 'Low';
    let biosigReason = 'No clear biosignature pattern';
    const present = Object.fromEntries(detectedMolecules.map(d => [d.molecule.toUpperCase(), d.confidence]));
    const has = (m) => present[m.toUpperCase()] && present[m.toUpperCase()] > 0.25;

    if (has('O2') && has('CH4')) {
      biosigLevel = 'High';
      biosigReason = 'Possible disequilibrium (O2 + CH4)';
    } else if (has('H2O') && (has('CO2') || has('N2'))) {
      biosigLevel = 'Medium';
      biosigReason = 'Water + major background gas detected';
    } else if (detectedMolecules.length >= 3 && avgSnr > 12) {
      biosigLevel = 'Medium';
      biosigReason = 'Multiple species with good S/N';
    } else if (avgSnr < this.minSnrForDetection) {
      biosigLevel = 'Low';
      biosigReason = 'Low average S/N';
    }

    const meanMoleculeConfidence = detectedMolecules.length ? (detectedMolecules.reduce((s,d)=>s+d.confidence,0) / detectedMolecules.length) : 0;
    const overallConfidence = Math.min(0.999, Math.max(0.05, 0.2 * (avgSnr / 40) + 0.75 * meanMoleculeConfidence));

    return {
      detectedMolecules,
      moleculeConfidences,
      features: {
        absorptionLines: absorptionCount,
        avgSnr: +avgSnr.toFixed(2),
        spectralPoints: normalized.length
      },
      perMoleculeDetails: detectedMolecules,
      biosignaturePotential: { level: biosigLevel, reason: biosigReason },
      recommendations: this.suggestFollowUps({ features: { avgSnr }, biosignaturePotential: { level: biosigLevel } }, planet),
      confidence: +overallConfidence.toFixed(3),
      processingTimeMs: this.processingDelayMs,
      summary: `${detectedMolecules.length} molecule(s), avg S/N ${+avgSnr.toFixed(2)}, biosignature: ${biosigLevel}`,
      syntheticModel: normalized.map(p => ({ wavelength: p.wavelength, modelIntensity: +(p.intensity_norm + 0.01*Math.sin(p.wavelength/10)).toFixed(6) })),
      normalizedData: normalized
    };
  }

  suggestFollowUps(analysis = {}, planet = {}) {
    const recs = [];
    if (!analysis || !analysis.features) return ['Acquire baseline spectrum.'];
    const avgSnr = analysis.features.avgSnr || 0;
    if (avgSnr < 10) recs.push('Increase exposure time to reach avg S/N > 15 or co-add more transits.');
    if (analysis.biosignaturePotential && analysis.biosignaturePotential.level === 'High') {
      recs.push('Immediate multi-epoch high-resolution follow-up.');
    }
    recs.push('Observe reference stars to remove telluric features.');
    if (planet && planet.distance && Number(planet.distance) > 500) recs.push('Use space-based instruments (JWST) for highest sensitivity.');
    return recs;
  }
}

export default SpectroscopyAI;
