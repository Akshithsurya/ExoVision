export { ExoplanetClassifier } from './ExoplanetClassifier';
export { PredictiveAnalytics } from './PredictiveAnalytics';
export { SpectroscopyAI } from './SpectroscopyAI';

try {
  // Quick runtime check so you can see the services are available when the bundle runs
  // (harmless, only prints once when the module is evaluated)
  // eslint-disable-next-line no-console
  console.log('[ai-services] index loaded: ExoplanetClassifier, PredictiveAnalytics, SpectroscopyAI');
} catch (e) {
  // swallow any console errors in weird environments
}
