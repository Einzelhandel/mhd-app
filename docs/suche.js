// Ansicht „Suche“: Artikel nach Name, Marke oder Strichcode finden (auch ruhende Artikel).
import { ansichten, wechsle, mhdRpc, serverHeute } from './app.js';
import { element, meldung, fehlertext } from './hilfe.js';
import { artikelZeile } from './liste.js';

const WARTEZEIT_MS = 250;

// daten (optional): { suche, ohneEan } – so kommt man vom Artikel zur selben Suche zurück.
ansichten.suche = async (wurzel, daten = {}) => {
  const heute = await serverHeute();
  const text = element('input', {
    id: 'suchtext', name: 'suche', type: 'search', autocomplete: 'off', autocapitalize: 'none',
    placeholder: 'Name, Marke oder Strichcode', 'aria-label': 'Suche', value: daten.suche ?? '',
  });
  const ohneEan = element('input', { id: 'ohne-ean', name: 'ohne-ean', type: 'checkbox', checked: Boolean(daten.ohneEan) });
  const treffer = element('div', { class: 'inhalt' });
  let lauf = 0;
  let uhr = null;

  async function suchen() {
    const mein = ++lauf;
    try {
      const artikel = await mhdRpc('mhd_artikel_liste', { p_suche: text.value.trim(), p_ohne_ean: ohneEan.checked });
      if (mein !== lauf || !wurzel.isConnected) return;
      meldung('');
      const zurueck = { ansicht: 'suche', daten: { suche: text.value, ohneEan: ohneEan.checked } };
      treffer.replaceChildren(...(artikel.length
        ? artikel.map((a) => artikelZeile(a, heute, () => wechsle('artikel', { artikel: a, zurueck })))
        : [element('p', { class: 'leer' }, 'Nichts gefunden.')]));
    } catch (fehler) {
      if (!fehler.behandelt && mein === lauf) meldung(fehlertext(fehler.message));
    }
  }

  const verzoegert = () => { clearTimeout(uhr); uhr = setTimeout(suchen, WARTEZEIT_MS); };
  text.addEventListener('input', verzoegert);
  ohneEan.addEventListener('change', suchen);

  wurzel.append(
    element('header', { class: 'kopf' },
      element('button', { type: 'button', class: 'knopf klein', onclick: () => wechsle('liste') }, 'Zurück'),
      element('h1', {}, 'Suche')),
    element('form', { class: 'formular', novalidate: true, onsubmit: (e) => { e.preventDefault(); clearTimeout(uhr); suchen(); } },
      text,
      element('label', { class: 'schalter', for: 'ohne-ean' }, ohneEan, 'nur ohne Strichcode')),
    treffer);
  text.focus();
  await suchen();
};
