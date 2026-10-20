/**
 * Consumption incl. conversion losses = balance of the meters (W): sun − battery
 * (+ charging) − grid (+ feed-in). null when one is unknown (guideline "Verbrauch").
 */
export const balanceW = (pv?: number | null, battery?: number | null, grid?: number | null) =>
  pv == null || battery == null || grid == null ? null : Math.max(0, pv - battery - grid);
