// Strichcodes: reine Logik, kein DOM.

function pruefzifferStimmt(ziffern) {
  const werte = [...ziffern].map(Number);
  const pruef = werte.pop();
  // Von rechts (ohne Prüfziffer) abwechselnd mit 3 und 1 gewichtet, beginnend mit 3.
  const summe = werte.reverse().reduce((s, z, i) => s + z * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (summe % 10)) % 10 === pruef;
}

// Liefert EAN-8 oder EAN-13 (UPC-A mit führender 0), sonst null.
export function normalisiereEan(text) {
  const t = String(text ?? '').replace(/\s+/g, '');
  if (!/^\d+$/.test(t) || ![8, 12, 13].includes(t.length)) return null;
  const ean = t.length === 12 ? `0${t}` : t;
  return pruefzifferStimmt(ean) ? ean : null;
}

// Preisschilder von Waagen beginnen mit 2 (Menge/Preis steckt im Code, kein Produkt).
export function istWaagencode(ean) {
  return String(ean).startsWith('2');
}
