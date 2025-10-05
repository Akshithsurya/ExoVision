// ExoplanetClassifier.js (improved)
// - async model loading (placeholder for real model)
// - calibrated probabilistic outputs with optional Platt-ish scaling
// - caching, batch classification, explainability output

export class ExoplanetClassifier {
  constructor(options = {}) {
    this.modelLoaded = false;
    this.loadingDelayMs = options.loadingDelayMs ?? 200;
    this.calibration = options.calibration ?? { a: 1.0, b: 0.0 }; // optional platt params
    this.cache = new Map(); // cache by planet id/hash
    this.labels = options.labels ?? [
      'Terrestrial','Super Earth','Mini-Neptune','Gas Giant','Hot Jupiter',
      'Ice Giant','Puffy Planet','Ocean World','Desert World'
    ];
    this.weights = Object.assign({
      temperature: 0.35,
      mass: 0.25,
      distance: 0.2,
      atmosphere: 0.15,
      other: 0.05
    }, options.weights || {});
    // optional external model URL (not used in heuristics)
    this.externalModelUrl = options.externalModelUrl || null;
  }

  async loadModel() {
    if (this.modelLoaded) return true;
    // placeholder: if externalModelUrl is provided, you can fetch weights here
    await new Promise(r => setTimeout(r, this.loadingDelayMs));
    this.modelLoaded = true;
    // eslint-disable-next-line no-console
    console.log('[ExoplanetClassifier] model loaded (simulated)');
    return true;
  }

  _hashPlanet(planet) {
    // stable-ish key for caching
    if (!planet) return 'null';
    return `${planet.name || 'unknown'}|${planet.mass}|${planet.radius}|${planet.temperature}|${planet.atmosphere||'na'}`;
  }

  _featureVector(planet = {}) {
    return {
      mass: Number(planet.mass) || 1,
      radius: Number(planet.radius) || 1,
      temperature: Number(planet.temperature) || 288,
      orbital_period: Number(planet.orbital_period) || 365,
      distance: Number(planet.distance) || 100,
      atmosphere: (planet.atmosphere && planet.atmosphere !== 'Unknown') ? 1 : 0,
      follow_up: Number(planet.follow_up_observations) || 0,
      ai_confidence: Number(planet.ai_confidence) || 0.75
    };
  }

  // small calibration of probability (Platt-like)
  _calibrate(prob) {
    if (!this.calibration) return prob;
    const { a, b } = this.calibration;
    // logistic transform: 1/(1+exp(a*x + b)) is platt-ish; invert for mapping
    // we apply a simple affine then logistic to keep prob in (0,1)
    const x = Math.max(1e-6, Math.min(1 - 1e-6, prob));
    const z = a * (x - 0.5) + b;
    const calibrated = 1 / (1 + Math.exp(-z));
    return calibrated;
  }

  // produce per-feature "importance" using simple gradient-like heuristics
  _explainFeatures(f) {
    // heuristic feature importance (normalized)
    const imp = {
      temperature: Math.abs(0.5 - Math.exp(-Math.pow((f.temperature - 288) / 60, 2))),
      mass: Math.abs(Math.log(Math.max(0.1, f.mass)) - Math.log(1)),
      distance: Math.min(1, f.distance / 500),
      atmosphere: f.atmosphere ? 0.1 : 0.02,
      follow_up: Math.min(1, f.follow_up / 20)
    };
    const sum = Object.values(imp).reduce((s, v) => s + v, 0) || 1;
    Object.keys(imp).forEach(k => imp[k] = +(imp[k] / sum).toFixed(3));
    return imp;
  }

  // classify a single planet with caching and explainability
  async classifyPlanet(planet = {}) {
    if (!this.modelLoaded) await this.loadModel();
    const key = this._hashPlanet(planet);
    if (this.cache.has(key)) {
      return this.cache.get(key);
    }

    const f = this._featureVector(planet);

    const base = {
      'Terrestrial': Math.max(0, 0.6 - Math.abs(f.mass - 1) * 0.12 - Math.abs(f.radius - 1) * 0.08),
      'Super Earth': Math.max(0, 0.25 + (f.mass > 1.5 ? 0.15 : 0) + (f.radius > 1.2 ? 0.1 : 0)),
      'Mini-Neptune': Math.max(0, 0.12 + (f.radius > 1.8 ? 0.12 : 0)),
      'Gas Giant': Math.max(0, (f.mass > 15 ? 0.7 : 0.05) + (f.radius > 3 ? 0.2 : 0)),
      'Hot Jupiter': Math.max(0, (f.orbital_period < 10 ? 0.4 : 0.01)),
      'Ice Giant': Math.max(0, (f.temperature < 180 ? 0.25 : 0.01)),
      'Puffy Planet': Math.max(0, (f.mass < 10 && f.radius > 6 ? 0.2 : 0.01)),
      'Ocean World': Math.max(0, (planet.atmosphere && planet.atmosphere.toLowerCase().includes('h2o') ? 0.35 : 0.02)),
      'Desert World': Math.max(0, (f.temperature > 400 ? 0.2 : 0.02))
    };

    let sum = Object.values(base).reduce((s, v) => s + v, 0) || 1;
    const probsRaw = {};
    Object.keys(base).forEach(k => { probsRaw[k] = base[k] / sum; });

    // incorporate ai_confidence smoothing and calibration
    const smoothed = {};
    Object.keys(probsRaw).forEach(k => {
      const raw = probsRaw[k];
      const biased = raw * (0.6 + 0.4 * f.ai_confidence);
      smoothed[k] = this._calibrate(biased);
    });

    // normalize
    const s2 = Object.values(smoothed).reduce((s, v) => s + v, 0) || 1;
    Object.keys(smoothed).forEach(k => smoothed[k] = +(smoothed[k] / s2).toFixed(4));

    const entries = Object.entries(smoothed).sort((a,b)=> b[1]-a[1]);
    const predictedType = entries[0][0];
    // combine top probability and ai_confidence for final confidence
    const confidence = Math.min(0.999, 0.45 + entries[0][1]*0.45 + (f.ai_confidence - 0.7)*0.25);

    const explanation = {
      features: f,
      importances: this._explainFeatures(f),
      topFactors: entries.slice(0,3).map(e => ({ label: e[0], prob: +e[1].toFixed(4) }))
    };

    const result = {
      predictedType,
      probabilities: smoothed,
      confidence: +(confidence.toFixed(3)),
      explanation,
      modelMeta: { engine: 'heuristic-sim-v2', labels: this.labels }
    };

    // cache lightweight result
    try { this.cache.set(key, result); } catch(e) { /* ignore */ }

    // small async gap to mimic IO
    await new Promise(r => setTimeout(r, 25));
    return result;
  }

  // batch classification (parallel-friendly)
  async classifyBatch(planets = []) {
    if (!this.modelLoaded) await this.loadModel();
    const promises = planets.map(p => this.classifyPlanet(p));
    return Promise.all(promises);
  }

  // allow clearing cache
  clearCache() {
    this.cache.clear();
  }
}

export default ExoplanetClassifier;
