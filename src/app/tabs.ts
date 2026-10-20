/**
 * The person's tab choice (BL-272): hidden tabs drop out, the chosen order comes first,
 * tabs not in it (new modules) follow in their usual place. The overview stays always and
 * first. Pure, so App and the settings dialog arrange the same way.
 */

export interface TabPrefs {
  hidden: string[];
  order: string[];
}

export const NO_PREFS: TabPrefs = { hidden: [], order: [] };

/** All tabs in the person's order, hidden ones included (for the settings dialog). */
export function ordered<T extends { id: string }>(all: T[], prefs: TabPrefs): T[] {
  const byId = new Map(all.map((t) => [t.id, t]));
  const out = prefs.order.filter((id) => id !== 'overview' && byId.has(id));
  // a tab not in the chosen order (e.g. a new module) goes right after its usual predecessor
  all.forEach((t, i) => {
    if (t.id === 'overview' || out.includes(t.id)) return;
    const before = i > 0 ? out.indexOf(all[i - 1]!.id) : -1;
    out.splice(before + 1, 0, t.id);
  });
  return [...(byId.has('overview') ? ['overview'] : []), ...out].map((id) => byId.get(id)!);
}

/** The tabs to show. */
export function arrange<T extends { id: string }>(all: T[], prefs: TabPrefs): T[] {
  const hidden = new Set(prefs.hidden);
  return ordered(all, prefs).filter((t) => t.id === 'overview' || !hidden.has(t.id));
}

/** Move one tab up (-1) or down (+1) among all tabs; the overview stays first. */
export function move(ids: string[], id: string, step: -1 | 1): string[] {
  const i = ids.indexOf(id);
  const j = i + step;
  if (i < 0 || j < 0 || j >= ids.length || ids[i] === 'overview' || ids[j] === 'overview')
    return ids;
  const out = [...ids];
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}

/**
 * Tools that ship with VibeDash as modules (modules/vibedash_modules/<id>), with a name for the
 * list "not set up yet". A test keeps this list in step with the folders.
 */
export const MODULES: Record<string, { de: string; en: string; icon: string }> = {
  wartung: { de: 'Wartung', en: 'Maintenance', icon: 'wrench' },
  raeume: { de: 'Räume', en: 'Rooms', icon: 'floorplan' },
  garten: { de: 'Garten', en: 'Garden', icon: 'leaf' },
  gebaeude: { de: 'Gebäude', en: 'Building', icon: 'thermometer' },
  auto: { de: 'Auto', en: 'Car', icon: 'plugCar' },
  knx: { de: 'KNX', en: 'KNX', icon: 'home' },
  knxlog: { de: 'KNX-Log', en: 'KNX log', icon: 'clock' },
  ml: { de: 'Modelle', en: 'Models', icon: 'target' },
  korrelation: { de: 'Korrelation', en: 'Correlation', icon: 'overview' },
};
