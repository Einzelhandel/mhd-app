// Datumseingabe: reine Logik, kein DOM. Intern immer ISO (JJJJ-MM-TT).

const zwei = (n) => String(n).padStart(2, '0');
const TAG_MS = 86400000;

function gueltig(jahr, monat, tag) {
  const d = new Date(Date.UTC(jahr, monat - 1, tag));
  return d.getUTCFullYear() === jahr && d.getUTCMonth() === monat - 1 && d.getUTCDate() === tag;
}

const iso = (jahr, monat, tag) => `${jahr}-${zwei(monat)}-${zwei(tag)}`;
const tage = (isoDatum) => Date.parse(`${isoDatum}T00:00:00Z`) / TAG_MS;

// Erlaubt: TT.MM.JJ, TT.MM.JJJJ, TTMMJJ, T.M.JJ, TT.MM., TT.MM, TTMM.
// Ohne Jahr gilt das Jahr von heute; liegt der Tag dann mehr als 30 Tage zurück, das nächste Jahr.
export function leseDatum(text, heuteIso) {
  const t = String(text ?? '').trim();
  let tag, monat, jahr;
  let m;
  if ((m = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/.exec(t))) [, tag, monat, jahr] = m;
  else if ((m = /^(\d{2})(\d{2})(\d{2})$/.exec(t))) [, tag, monat, jahr] = m;
  else if ((m = /^(\d{1,2})\.(\d{1,2})\.?$/.exec(t)) || (m = /^(\d{2})(\d{2})$/.exec(t))) [, tag, monat] = m;
  else return null;
  tag = Number(tag);
  monat = Number(monat);
  if (jahr !== undefined) {
    jahr = jahr.length === 2 ? 2000 + Number(jahr) : Number(jahr);
    return gueltig(jahr, monat, tag) ? iso(jahr, monat, tag) : null;
  }
  const heuteJahr = Number(heuteIso.slice(0, 4));
  if (!gueltig(heuteJahr, monat, tag) && !gueltig(heuteJahr + 1, monat, tag)) return null;
  if (gueltig(heuteJahr, monat, tag) && tage(heuteIso) - tage(iso(heuteJahr, monat, tag)) <= 30) return iso(heuteJahr, monat, tag);
  return gueltig(heuteJahr + 1, monat, tag) ? iso(heuteJahr + 1, monat, tag) : null;
}

// '2026-11-20' → '20.11.26'
export function zeigeDatum(isoDatum) {
  return `${isoDatum.slice(8, 10)}.${isoDatum.slice(5, 7)}.${isoDatum.slice(2, 4)}`;
}
