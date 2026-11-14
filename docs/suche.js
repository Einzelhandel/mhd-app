// Ansicht „Suche“: Artikel nach Name, Marke oder Strichcode finden (auch ruhende Artikel).
import { ansichten, wechsle, gibtAnsicht, mhdRpc, serverHeute, ich } from './app.js';
import { element, meldung, fehlertext, ausweg } from './hilfe.js';
import { artikelZeile } from './liste.js';

const WARTEZEIT_MS = 250;
const MAX_TREFFER = 50; // mehr liefert mhd_artikel_liste nicht

// daten (optional): { suche, ohneEan, hinweis } – so kommt man vom Artikel zur selben Suche zurück;
// hinweis ist ein Satz über der Suche (z. B. nach einem Waagen-Etikett).
ansichten.suche = async (wurzel, daten = {}) => {
  let heute = null;
  const text = element('input', {
    id: 'suchtext', name: 'suche', type: 'search', autocomplete: 'off', autocapitalize: 'none',
    placeholder: 'Name, Marke oder Strichcode', 'aria-label': 'Suche', value: daten.suche ?? '',
  });
  const ohneEan = element('input', { id: 'ohne-ean', name: 'ohne-ean', type: 'checkbox', checked: Boolean(daten.ohneEan) });
  const treffer = element('div', { class: 'inhalt' });
  let lauf = 0;
  let uhr = null;

  const zurueckZuListe = () => wechsle('liste');
  const aktuelleDaten = () => ({ suche: text.value, ohneEan: ohneEan.checked });

  async function suchen() {
    const mein = ++lauf;
    try {
      heute ??= await serverHeute();
      const artikel = await mhdRpc('mhd_artikel_liste', { p_suche: text.value.trim(), p_ohne_ean: ohneEan.checked });
      if (mein !== lauf || !wurzel.isConnected) return;
      meldung('');
      const zurueck = { ansicht: 'suche', daten: aktuelleDaten() };
      const grenze = artikel.length >= MAX_TREFFER
        ? [element('p', { class: 'hinweis-text treffer-grenze' }, `Es werden die ersten ${MAX_TREFFER} Treffer gezeigt. Bitte genauer suchen.`)]
        : [];
      treffer.replaceChildren(...grenze, ...(artikel.length
        ? artikel.map((a) => artikelZeile(a, heute, () => wechsle('artikel', { artikel: a, zurueck })))
        : [element('p', { class: 'leer' }, 'Nichts gefunden.')]));
    } catch (fehler) {
      if (fehler.behandelt || mein !== lauf) return;
      meldung(fehlertext(fehler.message));
      treffer.replaceChildren(ausweg(suchen, zurueckZuListe));
    }
  }

  const verzoegert = () => { clearTimeout(uhr); uhr = setTimeout(suchen, WARTEZEIT_MS); };
  text.addEventListener('input', verzoegert);
  ohneEan.addEventListener('change', suchen);

  wurzel.append(...[
    element('header', { class: 'kopf' },
      element('button', { type: 'button', class: 'knopf klein', onclick: zurueckZuListe }, 'Zurück'),
      element('h1', {}, 'Suche')),
    element('form', { class: 'formular', novalidate: true, onsubmit: (e) => { e.preventDefault(); clearTimeout(uhr); suchen(); } },
      text,
      element('label', { class: 'schalter', for: 'ohne-ean' }, ohneEan, 'nur ohne Strichcode')),
    daten.hinweis && element('p', { class: 'hinweis-text' }, daten.hinweis),
    // Artikel ohne Strichcode (Waagenware) legt nur die Marktleitung an.
    ich()?.rolle === 'leitung' && gibtAnsicht('artikel-neu') && element('button', {
      type: 'button', class: 'knopf',
      onclick: () => wechsle('artikel-neu', { ean: null, vorschlag: null, quelle: 'hand', zurueck: { ansicht: 'suche', daten: aktuelleDaten() } }),
    }, 'Artikel ohne Strichcode anlegen'),
    treffer].filter(Boolean));
  text.focus();
  await suchen();
};
