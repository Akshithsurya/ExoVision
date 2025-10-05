// PredictiveAnalytics.js
// Provides trend analysis, simple time-series forecasting, and priority scoring utilities.
// Not a full ML pipeline but structured to accept real models later.

export class PredictiveAnalytics {
  constructor(opts = {}) {
    this.timeWindowYears = opts.timeWindowYears ?? 10;
    this.trendSmoothing = opts.trendSmoothing ?? 0.6;
  }

  // Analyze discovery patterns and return summarized insights and simple forecasts
  analyzeDiscoveryPatterns(planets = []) {
    // groups per year
    const countsByYear = {};
    planets.forEach(p => {
      const y = Number(p.discovery_year) || new Date().getFullYear();
      countsByYear[y] = (countsByYear[y] || 0) + 1;
    });

    const years = Object.keys(countsByYear).map(Number).sort((a,b) => a-b);
    const recentYears = years.slice(-this.timeWindowYears);
    const series = recentYears.map(y => ({ year: y, count: countsByYear[y] || 0 }));

    // simple exponential smoothing forecast for next 3 years
    let alpha = 0.4;
    let last = series.length > 0 ? series[0].count : 0;
    for (let i = 1; i < series.length; i++) {
      last = alpha * series[i].count + (1 - alpha) * last;
    }
    const forecasts = [];
    let base = last;
    for (let k = 1; k <= 3; k++) {
      base = alpha * base + (1 - alpha) * base; // keep smoothing
      forecasts.push({ year: (recentYears[recentYears.length -1] || new Date().getFullYear()) + k, predicted: Math.round(base * (1 + k*0.03)) });
    }

    // top discovery methods
    const methodCounts = {};
    planets.forEach(p => {
      methodCounts[p.discovery_method] = (methodCounts[p.discovery_method] || 0) + 1;
    });
    const methodRanking = Object.entries(methodCounts).sort((a,b)=>b[1]-a[1]).map(([m,c]) => ({ method: m, count: c }));

    // telescope contributions
    const telescopeCounts = {};
    planets.forEach(p => {
      telescopeCounts[p.discovery_telescope] = (telescopeCounts[p.discovery_telescope] || 0) + 1;
    });
    const topTelescopes = Object.entries(telescopeCounts).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([t,c]) => ({ telescope: t, count: c }));

    return {
      series,
      forecasts,
      methodRanking,
      topTelescopes,
      summary: {
        totalPlanets: planets.length,
        recentGrowth: series.length > 1 ? ((series[series.length-1].count - series[0].count) / Math.max(1, series[0].count)) : 0
      }
    };
  }

  // Given a planet, compute a priority score combining habitability, observability, and novelty
  calculatePriorityScore(planet = {}) {
    const habitScore = Number(planet.habitability_score) || 0;
    const aiConfidence = Number(planet.ai_confidence) || 0.7;
    const followUps = Math.min(1, (Number(planet.follow_up_observations) || 0) / 20);
    const distancePenalty = Math.exp(-Math.min(1500, Number(planet.distance) || 100) / 500);
    const novelty = planet.confirmed_status === 'Candidate' ? 0.12 : 0;

    // Tunable weights
    const score = Math.max(0, Math.min(0.999, (habitScore * 0.5) + (aiConfidence * 0.2) + (followUps * 0.1) + (distancePenalty * 0.08) + novelty));
    return parseFloat(score.toFixed(3));
  }

  // Recommend observation cadence and instrument selection
  recommendObservationPlan(planet = {}, telescopes = {}) {
    const plan = {
      target: planet.name || 'Unknown',
      recommendedInstruments: [],
      exposureEstimateHours: 2,
      suggestedCadence: 'Monthly',
      rationale: ''
    };

    const dist = Number(planet.distance) || 200;
    if (dist < 100) {
      plan.recommendedInstruments.push('Ground-based high-resolution spectrograph (e.g., HARPS/HARPS-N)');
      plan.exposureEstimateHours = 1.5;
      plan.suggestedCadence = 'Weekly';
      plan.rationale = 'Nearby target; ground-based facilities sufficient for high S/N.';
    } else if (dist < 500) {
      plan.recommendedInstruments.push('JWST NIRSpec / NIRISS');
      plan.exposureEstimateHours = 3;
      plan.suggestedCadence = 'Monthly';
      plan.rationale = 'Moderate distance; space-based IR yields better molecular access.';
    } else {
      plan.recommendedInstruments.push('JWST deep spectroscopy + ALMA (for sub-mm)');
      plan.exposureEstimateHours = 6;
      plan.suggestedCadence = 'Per-transit stacking';
      plan.rationale = 'Distant target; requires deep integrations and multi-epoch stacking.';
    }

    if (planet.atmosphere && planet.atmosphere.toLowerCase().includes('h2o')) {
      plan.recommendedInstruments.push('High-resolution optical for water-line cross correlation');
    }

    return plan;
  }
}

export default PredictiveAnalytics;
