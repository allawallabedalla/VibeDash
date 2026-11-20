/** Texts of the battery night estimate (Audit05 I-4). Loaded only with those pages, never on the first page (budget). */
import { localTexts } from './local';

export const tr = localTexts({
  de: {
    'reach.empty': 'leer ≈ {at}{range} · n = {n}',
    'reach.tight': 'knapp · leer ab ≈ {at} möglich · n = {n}',
    'reach.lasts': 'reicht bis Sonne ≈ {at} · n = {n}',
    'reach.now': 'jetzt',
    'reach.grid': 'Netz',
    'reach.sun': 'Sonne {at}',
    'reach.title': 'Reicht der Akku bis Sonnenaufgang?',
    'reach.yes': 'Reicht bis Sonnenaufgang',
    'reach.yesSub': 'Sonne ab ≈ {at} · Rest ≈ {kwh} kWh ({lo}–{hi})',
    'reach.tightTitle': 'Knapp',
    'reach.tightSub': 'Bei viel Verbrauch leer ab ≈ {at}, dann Netz bis ≈ {kwh} kWh',
    'reach.emptyTitle': 'Leer ≈ {at}{range}',
    'reach.emptySub': 'Dann Netz ≈ {kwh} kWh ({lo}–{hi}) bis Sonne ≈ {sun}',
    'reach.mark': 'leer ≈ {at}',
    'reach.basis':
      'nutzbar ≈ {usable} kWh (bis {floor} %) · Bedarf ≈ {need} ± {sd} kWh · n = {n} Nächte',
    'reach.mean': 'Akku (Mittel)',
    'reach.band': '± Streuung',
    'reach.floor': 'Entladegrenze {pct} %',
    'reach.day': 'Tagsüber lädt die Sonne; die Rechnung startet ab ≈ {at}.',
    'reach.last': 'Letzte Nacht',
    'reach.lastEmpty': 'leer ab {at}, dann Netz (ganzes Haus) ≈ {kwh} kWh',
    'reach.lastLasted': 'reichte, tiefster Stand {min} %',
    'reach.info.what':
      'Nachts: Reicht der Akku, bis die Sonne das Haus trägt? Band = Streuung der letzten Nächte (± 1 Standardabweichung), danach Netz (lila).',
    'reach.info.source':
      'Ladestand, Kapazität, Entladegrenze (häufigster Tiefststand in 30 Tagen, sonst 5 %), Verbrauch über die Sonne hinaus zur selben Uhrzeit in bis zu 14 Nächten (ohne Lücken- und Ausreißer-Nächte). Ohne Verluste: Näherung.',
  },
  en: {
    'reach.empty': 'empty ≈ {at}{range} · n = {n}',
    'reach.tight': 'tight · empty from ≈ {at} possible · n = {n}',
    'reach.lasts': 'lasts until sun ≈ {at} · n = {n}',
    'reach.now': 'now',
    'reach.grid': 'grid',
    'reach.sun': 'sun {at}',
    'reach.title': 'Does the battery last until sunrise?',
    'reach.yes': 'Lasts until sunrise',
    'reach.yesSub': 'sun from ≈ {at} · left ≈ {kwh} kWh ({lo}–{hi})',
    'reach.tightTitle': 'Tight',
    'reach.tightSub': 'With high use empty from ≈ {at}, then grid up to ≈ {kwh} kWh',
    'reach.emptyTitle': 'Empty ≈ {at}{range}',
    'reach.emptySub': 'Then grid ≈ {kwh} kWh ({lo}–{hi}) until sun ≈ {sun}',
    'reach.mark': 'empty ≈ {at}',
    'reach.basis':
      'usable ≈ {usable} kWh (down to {floor} %) · need ≈ {need} ± {sd} kWh · n = {n} nights',
    'reach.mean': 'battery (mean)',
    'reach.band': '± spread',
    'reach.floor': 'discharge limit {pct} %',
    'reach.day': 'By day the sun charges; the estimate starts from ≈ {at}.',
    'reach.last': 'Last night',
    'reach.lastEmpty': 'empty from {at}, then grid (whole house) ≈ {kwh} kWh',
    'reach.lastLasted': 'lasted, lowest {min} %',
    'reach.info.what':
      'At night: does the battery last until the sun carries the house? Band = spread of the last nights (± 1 standard deviation), then grid (purple).',
    'reach.info.source':
      'Charge, capacity, discharge limit (most common daily low in 30 days, else 5 %), use beyond the sun at the same clock time in up to 14 nights (without nights with gaps or outliers). Without losses: an approximation.',
  },
});
