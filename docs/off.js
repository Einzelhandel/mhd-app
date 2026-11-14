// Open Food Facts: reine Logik, kein DOM. Namen kommen von außen und bleiben Text.
import { OFF_URL } from './config.js';

const MAX_NAME = 120;
const MAX_TEXT = 60; // Marke und Menge; so kürzt sie auch die Datenbank
const text = (wert) => (typeof wert === 'string' ? wert.trim() : '');
const kurz = (wert, laenge) => wert.slice(0, laenge).trim();

export function ausOff(antwort) {
  if (!antwort || typeof antwort !== 'object' || antwort.status !== 1) return null;
  const p = antwort.product;
  if (!p || typeof p !== 'object') return null;
  const name = (text(p.product_name_de) || text(p.product_name)).slice(0, MAX_NAME);
  if (!name) return null;
  return {
    name,
    marke: kurz(text(p.brands).split(',')[0].trim(), MAX_TEXT) || null,
    menge: kurz(text(p.quantity), MAX_TEXT) || null,
  };
}

// Wirft nie: jeder Fehler (Netz, Frist, Status, kaputtes JSON, unbekanntes Produkt) ergibt null.
export async function holeOff(ean, { fetch = globalThis.fetch, url = OFF_URL, zeitMs = 4000 } = {}) {
  const abbruch = new AbortController();
  const timer = setTimeout(() => abbruch.abort(), zeitMs);
  try {
    const adresse = `${url}/api/v2/product/${ean}?fields=product_name,product_name_de,brands,quantity`;
    // Ein fetch, das das Signal ignoriert, darf trotzdem nicht hängen: Frist zusätzlich als Wettlauf.
    const frist = new Promise((_, nein) => abbruch.signal.addEventListener('abort', () => nein(new Error('Frist'))));
    const antwort = await Promise.race([fetch(adresse, { signal: abbruch.signal }), frist]);
    if (!antwort.ok) return null;
    return ausOff(await Promise.race([antwort.json(), frist]));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
