/// <reference lib="webworker" />
/** Demo backtest of the charge plan off the main thread (about a second of work). */
import { generateDemo } from '../demo/generate';
import { backtestPlans } from '../demo/plan';

self.onmessage = () => {
  self.postMessage(backtestPlans(generateDemo()));
};
