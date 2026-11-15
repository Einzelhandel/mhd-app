// Open Food Facts: reine Logik, kein DOM. Namen kommen von außen und bleiben Text.
import { OFF_URL } from './config.js';

const MAX_NAME = 120;
const MAX_TEXT = 60; // Marke und Menge; so kürzt sie auch die Datenbank
const text = (wert) => (typeof wert === 'string' ? wert.trim() : '');
const kurz = (wert, laenge) => wert.slice(0, laenge).trim();

// Vorschlag für die Warengruppe aus den Kategorien von Open Food Facts (categories_tags).
// Die Namen sind die Standard-Warengruppen (mhd.standard_warengruppen in supabase/schema.sql); hat der Markt
// eine Gruppe umbenannt oder gelöscht, gibt es für sie keinen Vorschlag. Die erste passende Zeile gewinnt:
// zuerst, was die Lagerung bestimmt (tiefgekühlt, Konserve), dann die Frische, zuletzt das Trockensortiment.
// „Drogerie“ und „Sonstiges“ kommen nie vor (Open Food Facts führt nur Lebensmittel). Es bleibt ein
// Vorschlag: gekühlt oder ungekühlt lässt sich aus den Kategorien nicht sicher ablesen.
const GRUPPEN = [
  ['Tiefkühl', /^en:(frozen-.*|ice-creams-and-sorbets|ice-creams)$/],
  ['Konserven', /^en:canned-.*$/],
  ['Fleisch und Wurst', /^en:(meats-and-their-products|meats|prepared-meats|sausages)$/],
  ['Molkerei', /^en:(dairies|margarines)$/],
  ['Backwaren', /^en:(breads|viennoiseries)$/],
  ['Feinkost und Salate', /^en:(prepared-salads|salads|dips|salted-spreads)$/],
  ['Süßwaren', /^en:(sweet-snacks|confectioneries|chocolates|candies|biscuits-and-cakes|chewing-gum)$/],
  ['Getränke', /^en:beverages$/],
  ['Trockensortiment', /^en:(cereals-and-their-products|salty-snacks|snacks|breakfasts|sweet-spreads|condiments|sauces|legumes-and-their-products|nuts-and-their-products|dried-products|spices|sugars|vegetable-oils|beverage-preparations)$/],
];

export function gruppeAus(kategorien) {
  if (!Array.isArray(kategorien)) return null;
  const tags = kategorien.filter((k) => typeof k === 'string').map((k) => k.trim().toLowerCase());
  return GRUPPEN.find(([, muster]) => tags.some((t) => muster.test(t)))?.[0] ?? null;
}

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
    gruppe: gruppeAus(p.categories_tags),
  };
}

// Wirft nie: jeder Fehler (Netz, Frist, Status, kaputtes JSON, unbekanntes Produkt) ergibt null.
export async function holeOff(ean, { fetch = globalThis.fetch, url = OFF_URL, zeitMs = 4000 } = {}) {
  const abbruch = new AbortController();
  const timer = setTimeout(() => abbruch.abort(), zeitMs);
  try {
    const adresse = `${url}/api/v2/product/${ean}?fields=product_name,product_name_de,brands,quantity,categories_tags`;
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
