// Ansicht „Protokoll“ (nur Marktleitung): wer hat wann was mit welchem Artikel gemacht.
import { ansichten, wechsle, mhdRpc, serverHeute, ich } from './app.js';
import { element, meldung, mitSperre, fehlertext, ausweg } from './hilfe.js';
import { zeigeDatum } from './datum.js';
import { standardZeitraum, leseZeitraum, protokollZeile } from './leitung-logik.js';

const MAX_ZEILEN = 500; // so viele liefert der Server höchstens

const SPALTEN = ['Zeit', 'Mitarbeiter', 'Artikel', 'Aktion', 'MHD alt → neu'];

function tabelle(zeilen) {
  return element('div', { class: 'tabelle-rahmen' },
    element('table', { class: 'protokoll' },
      element('thead', {}, element('tr', {}, SPALTEN.map((s) => element('th', { scope: 'col' }, s)))),
      element('tbody', {}, zeilen.map((z) => {
        const t = protokollZeile(z);
        return element('tr', {}, [t.zeit, t.mitarbeiter, t.artikel, t.aktion, t.mhd].map((text) => element('td', {}, text)));
      }))));
}

ansichten.protokoll = async (wurzel) => {
  if (ich()?.rolle !== 'leitung') {
    wechsle('liste');
    return;
  }
  const zurueck = () => wechsle('liste');
  const kopf = element('header', { class: 'kopf' },
    element('button', { type: 'button', class: 'knopf klein', onclick: zurueck }, 'Zurück'),
    element('h1', {}, 'Protokoll'));

  let heute;
  let mitarbeiter;
  try {
    heute = await serverHeute();
    mitarbeiter = await mhdRpc('mhd_mitarbeiter_liste');
  } catch (fehler) {
    if (fehler.behandelt) throw fehler;
    meldung(fehlertext(fehler.message));
    wurzel.append(kopf, ausweg(() => wechsle('protokoll'), zurueck));
    return;
  }

  const zeitraum = standardZeitraum(heute);
  const datumFeld = (id, beschriftung, iso) => {
    const eingabe = element('input', { id, name: id, type: 'text', inputmode: 'numeric', autocomplete: 'off', value: zeigeDatum(iso) });
    return { eingabe, zeile: element('div', { class: 'feld' }, element('label', { for: id }, beschriftung), eingabe) };
  };
  const von = datumFeld('von', 'Von', zeitraum.von);
  const bis = datumFeld('bis', 'Bis', zeitraum.bis);
  const wer = element('select', { id: 'wer', name: 'wer' },
    element('option', { value: '' }, 'Alle Mitarbeiter'),
    mitarbeiter.map((m) => element('option', { value: m.id }, m.aktiv ? m.name : `${m.name} (inaktiv)`)));
  const fehler = element('p', { class: 'feldfehler', role: 'alert', hidden: true });
  const zeigeFehler = (text) => { fehler.textContent = text || ''; fehler.hidden = !text; };
  const ergebnis = element('div', { class: 'inhalt' });

  function anzeigen() {
    zeigeFehler('');
    const z = leseZeitraum(von.eingabe.value, bis.eingabe.value, heute);
    if (z.fehler) {
      zeigeFehler(z.fehler);
      return;
    }
    meldung('');
    return mitSperre(wurzel, async () => {
      const zeilen = await mhdRpc('mhd_protokoll', { p_von: z.von, p_bis: z.bis, p_mitarbeiter: wer.value ? Number(wer.value) : null });
      ergebnis.replaceChildren(...(zeilen.length
        ? [tabelle(zeilen), zeilen.length >= MAX_ZEILEN && element('p', { class: 'hinweis-text' }, `Nur die neuesten ${MAX_ZEILEN} Einträge. Bitte den Zeitraum verkleinern.`)]
        : [element('p', { class: 'leer' }, 'Keine Einträge im Zeitraum.')]).filter(Boolean));
    }, (text) => {
      zeigeFehler(text);
      ergebnis.replaceChildren(ausweg(anzeigen));
    });
  }

  wurzel.append(kopf,
    element('form', { class: 'formular', novalidate: true, onsubmit: (e) => { e.preventDefault(); anzeigen(); } },
      von.zeile, bis.zeile,
      element('div', { class: 'feld' }, element('label', { for: 'wer' }, 'Mitarbeiter'), wer),
      fehler,
      element('button', { type: 'submit', class: 'knopf haupt' }, 'Anzeigen')),
    ergebnis);
  await anzeigen();
};
