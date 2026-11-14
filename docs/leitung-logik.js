// Marktleitung: Eingaben prüfen und Protokollzeilen darstellen. Reine Logik, kein DOM.
import { leseDatum, zeigeDatum } from './datum.js';

export const AKTIONSNAMEN = {
  geprueft: 'Geprüft',
  reduziert: 'Reduziert',
  aussortiert: 'Aussortiert',
  ohne_bestand: 'Ohne Bestand',
  ruht: 'Aus dem Sortiment genommen',
};

const GANZE_ZAHL = /^\d+$/;

// Regel einer Warengruppe aus drei Textfeldern: { werte } zum Senden oder { fehler, feld } fürs Formular.
// feld: 'pruef' | 'reduzier' | 'max'
export function pruefeRegel({ pruef, reduzier, max }) {
  const zahl = (text) => (GANZE_ZAHL.test(String(text ?? '').trim()) ? Number(String(text).trim()) : null);
  const p = zahl(pruef);
  const r = zahl(reduzier);
  const m = zahl(max);
  const ganz = 'Bitte eine ganze Zahl eingeben (0 oder größer).';
  if (p === null) return { fehler: ganz, feld: 'pruef' };
  if (r === null) return { fehler: ganz, feld: 'reduzier' };
  if (m === null) return { fehler: ganz, feld: 'max' };
  if (r > p) return { fehler: 'Reduzieren darf nicht früher kommen als Prüfen (die Zahl bei Reduzieren darf nicht größer sein).', feld: 'reduzier' };
  if (m < 1) return { fehler: 'Der Höchstabstand muss mindestens 1 Tag sein.', feld: 'max' };
  return { werte: { pruef_vorlauf_tage: p, reduzier_vorlauf_tage: r, max_intervall_tage: m } };
}

// null, wenn die PIN passt, sonst die Meldung fürs Feld.
export function pruefePin(text) {
  return /^\d{4,6}$/.test(String(text ?? '')) ? null : 'Die PIN muss aus 4 bis 6 Ziffern bestehen.';
}

// '2026-11-14T08:05:00+00:00' → '14.11. 09:05' (Europe/Berlin)
export function zeitText(zeitstempel) {
  const teile = Object.fromEntries(new Intl.DateTimeFormat('de-DE', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Berlin',
  }).formatToParts(new Date(zeitstempel)).map((t) => [t.type, t.value]));
  return `${teile.day}.${teile.month}. ${teile.hour}:${teile.minute}`;
}

// Eine Zeile der Protokolltabelle als Anzeigetexte.
export function protokollZeile(z) {
  const datum = (iso) => (iso ? zeigeDatum(iso) : '–');
  return {
    zeit: zeitText(z.zeitpunkt),
    mitarbeiter: z.mitarbeiter || '–',
    artikel: z.artikel || '–',
    aktion: AKTIONSNAMEN[z.art] ?? z.art,
    mhd: z.mhd_alt || z.mhd_neu ? `${datum(z.mhd_alt)} → ${datum(z.mhd_neu)}` : '–',
  };
}

// Letzte 7 Tage einschließlich heute.
export function standardZeitraum(heuteIso) {
  const von = new Date(Date.parse(`${heuteIso}T00:00:00Z`) - 6 * 86400000);
  return { von: von.toISOString().slice(0, 10), bis: heuteIso };
}

// Liest die beiden Datumsfelder; { von, bis } (ISO) oder { fehler }.
export function leseZeitraum(vonText, bisText, heuteIso) {
  const von = leseDatum(vonText, heuteIso);
  if (!von) return { fehler: 'Von: Bitte ein Datum eingeben, z. B. 081126.' };
  const bis = leseDatum(bisText, heuteIso);
  if (!bis) return { fehler: 'Bis: Bitte ein Datum eingeben, z. B. 141126.' };
  if (von > bis) return { fehler: 'Das Von-Datum liegt nach dem Bis-Datum.' };
  return { von, bis };
}
