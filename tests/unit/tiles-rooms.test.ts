import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/i18n/index.svelte', () => ({
  t: (key: string, vars: Record<string, string> = {}) => (vars.room ? `${key}:${vars.room}` : key),
  num: (v: number) => String(v),
  time: () => '12:00',
  i18n: { locale: 'de' },
}));

const { humidityTile, roomsNow } = await import('../../src/app/tiles');
const { generateDemo } = await import('../../src/demo');

/** Demo house plus humidity sensors in two rooms (synthetic values), no living-room humidity. */
function withRooms(bath: number[], office: number[], silentOfficeMs = 0) {
  const demo = generateDemo();
  const step = 180_000;
  const series = (id: string, values: number[], shift: number) => ({
    entityId: id,
    source: 'test',
    stepMs: step,
    samples: values.map((v, i) => ({ t: demo.now - shift - (values.length - 1 - i) * step, v })),
  });
  const rest = Object.fromEntries(
    Object.entries(demo.series).filter(([id]) => id !== 'living_humidity'),
  );
  return {
    ...demo,
    entities: [
      ...demo.entities.filter((e) => e.id !== 'living_humidity'),
      { id: 'hum_bath', name: 'Bad', kind: 'humidity' as const, room: 'bath', unit: '%' },
      { id: 'hum_office', name: 'Büro', kind: 'humidity' as const, room: 'office', unit: '%' },
    ],
    series: {
      ...rest,
      hum_bath: series('hum_bath', bath, 0),
      hum_office: series('hum_office', office, silentOfficeMs),
    },
  };
}

describe('rooms now (all room sensors of one kind)', () => {
  it('lists every room with 24-h low/high and the current value', () => {
    const rooms = roomsNow(withRooms([50, 61, 55], [48, 52]), 'humidity');
    expect(rooms.map((r) => [r.name, r.low, r.high, r.now])).toEqual([
      ['Bad', 50, 61, 55],
      ['Büro', 48, 52, 52],
    ]);
  });
  it('a silent sensor keeps its range but has no current value', () => {
    const office = roomsNow(withRooms([50], [48, 52], 6 * 3_600_000), 'humidity').find(
      (r) => r.name === 'Büro',
    )!;
    expect(office.now).toBeNull();
    expect(office.high).toBe(52);
  });
  it('without a living-room sensor the humidity tile shows the most humid room', () => {
    const tile = humidityTile(withRooms([50, 58], [48, 52]));
    expect(tile.label).toBe('tile.humidity');
    expect(tile.sub).toBe('sub.comfortRoom:Bad');
    expect(tile.value).toBe('58');
  });
  it('a held value keeps its room in front of "last reported" (Audit04 DA-05)', () => {
    const data = withRooms([50, 58], [48, 52]);
    const bath = data.series.hum_bath!;
    // sends on change: the value is held, the last real report was two hours ago
    (bath as { held?: { reports: number[] } }).held = { reports: [data.now - 2 * 3_600_000] };
    const tile = humidityTile(data);
    expect(tile.sub).toBe('Bad · state.lastReport');
  });
});
