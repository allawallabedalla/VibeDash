/** Texts of the charging page (Audit05 I-2/I-5). Loaded only with those pages, never on the first page (budget). */
import { localTexts } from './local';

export const tc = localTexts({
  de: {
    'co.title': 'Strom fürs Auto',
    'co.days': '{n} Tage:',
    'co.sun': 'Sonne',
    'co.battery': 'Akku',
    'co.grid': 'Netz',
    'co.open': 'Herkunft offen',
    'co.note': 'n = {n} Ladetage · {kwh} kWh',
    'co.none': 'In {n} Tagen nicht geladen.',
    'co.info.what':
      'Je Tag ein Balken: gelb direkt von der Sonne, grün aus dem Hausakku, lila aus dem Netz. Ziel: wenig Lila. Grau = geladen, Herkunft noch offen (heute: folgt morgen); Ring = keine Aufzeichnung.',
    'co.info.source':
      'Tagesauswertung des Hauses (Zähler, Wallbox). Akku = vorher gespeicherter Strom, meist Sonne. Ganze Prozent.',
    'out.restToday': 'Rest heute',
    'out.daySun': 'Sonne ≈ {kwh} kWh{range}',
    'out.dayCar': 'Auto ≈ {kwh} kWh',
    'out.next': 'Nächste Ladung',
    'out.none': 'keine',
    'out.noneSub': 'in 48 h nichts geplant',
    'out.noGrid': 'Ohne Netz',
    'out.noGridSub': 'Auto, 30 Tage · n = {n}',
    'out.noteLoad': 'Haus: Median, n = {n} Tage',
    'out.info.what':
      'Gelb gestrichelt die erwartete Sonne, Band = 8 von 10 Wetterfällen; blau gepunktet das Haus wie üblich; grüne Blöcke = Ladefenster. Darunter der Hausakku, wenn es so kommt.',
    'out.info.source':
      'Sonne: Prognose des Hauses. Haus: Median je Uhrzeit, 14 Tage. Ladefenster: Ladeplaner. Akku: daraus gerechnet, ohne Verluste (≈).',
  },
  en: {
    'co.title': 'Power for the car',
    'co.days': '{n} days:',
    'co.sun': 'sun',
    'co.battery': 'battery',
    'co.grid': 'grid',
    'co.open': 'origin open',
    'co.note': 'n = {n} charging days · {kwh} kWh',
    'co.none': 'No charging in {n} days.',
    'co.info.what':
      'One bar per day: yellow straight from the sun, green from the house battery, purple from the grid. Goal: little purple. Grey = charged, origin still open (today: follows tomorrow); ring = no record.',
    'co.info.source':
      'Daily evaluation of the house (meters, wallbox). Battery = power stored before, mostly sun. Whole percent.',
    'out.restToday': 'Rest of today',
    'out.daySun': 'sun ≈ {kwh} kWh{range}',
    'out.dayCar': 'car ≈ {kwh} kWh',
    'out.next': 'Next charge',
    'out.none': 'none',
    'out.noneSub': 'nothing planned in 48 h',
    'out.noGrid': 'Without grid',
    'out.noGridSub': 'car, 30 days · n = {n}',
    'out.noteLoad': 'house: median, n = {n} days',
    'out.info.what':
      'Dashed yellow the expected sun, band = 8 in 10 weather cases; dotted blue the house as usual; green blocks = charge windows. Below, the house battery if it comes like this.',
    'out.info.source':
      'Sun: forecast of the house. House: median per clock hour, 14 days. Windows: charge planner. Battery: computed from these, without losses (≈).',
  },
});
