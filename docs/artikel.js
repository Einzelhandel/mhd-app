// Ansicht „Artikel“: Angaben zum Artikel und die Aktionen (geprüft, reduziert, aussortiert, wieder da …).
import { ansichten, wechsle, mhdRpc, serverHeute } from './app.js';
import { element, meldung, mitSperre } from './hilfe.js';
import { leseDatum, zeigeDatum } from './datum.js';
import { statusText } from './liste.js';

const HINWEISE = {
  geprueft: 'Geprüft.',
  reduziert: 'Als reduziert vermerkt.',
  aussortiert: 'Aussortiert.',
  ohne_bestand: 'Weiter ohne Bestand.',
  ruht: 'Aus dem Sortiment genommen.',
  wieder_da: 'Wieder da.',
};

ansichten.artikel = async (wurzel, daten) => {
  const a = daten.artikel;
  const heute = await serverHeute();
  const bereich = element('div', { class: 'bereich' });

  const zurueck = () => (daten.zurueck ? wechsle(daten.zurueck.ansicht, daten.zurueck.daten) : wechsle('liste'));

  // Führt die Aktion aus und kehrt mit kurzer Bestätigung zur Liste zurück.
  function aktion(art, mhd, hinweis = HINWEISE[art]) {
    return mitSperre(wurzel, async () => {
      const parameter = { p_artikel: a.id, p_art: art };
      if (mhd) parameter.p_mhd = mhd;
      await mhdRpc('mhd_aktion', parameter);
      wechsle('liste');
      meldung(hinweis, 'ok');
    });
  }

  // Datumsfeld mit Meldung daneben; lies() gibt ISO zurück oder null (und zeigt den Grund).
  function datumFeld(beschriftung, wert) {
    const eingabe = element('input', {
      id: 'mhd', name: 'mhd', type: 'text', inputmode: 'numeric', autocomplete: 'off',
      'aria-describedby': 'mhd-fehler', value: wert ? zeigeDatum(wert) : '',
    });
    const fehler = element('p', { id: 'mhd-fehler', class: 'feldfehler', role: 'alert', hidden: true });
    const zeige = (text) => { fehler.textContent = text; fehler.hidden = !text; };
    eingabe.addEventListener('input', () => zeige(''));
    return {
      zeile: element('div', { class: 'feld' }, element('label', { for: 'mhd' }, beschriftung), eingabe, fehler),
      eingabe,
      zeige,
      lies() {
        const iso = leseDatum(eingabe.value, heute);
        if (!iso) {
          zeige('Bitte ein Datum eingeben, z. B. 201126 für 20.11.26.');
          eingabe.focus();
        }
        return iso;
      },
    };
  }

  // Zeigt Inhalt und Knöpfe; Enter im Datumsfeld löst den ersten Knopf aus.
  function zeigePanel(inhalt, knoepfe, beimEnter) {
    const formular = element('form', { class: 'formular', novalidate: true, onsubmit: (e) => { e.preventDefault(); beimEnter?.(); } }, inhalt);
    bereich.replaceChildren(formular, element('nav', { class: 'leiste' }, knoepfe));
  }

  const knopf = (text, beiKlick, klasse = '') => element('button', { type: 'button', class: `knopf ${klasse}`.trim(), onclick: beiKlick }, text);

  // MHD vor heute: erst nachfragen, ob die Ware raus soll.
  function pruefeAbgelaufen(iso, speichern) {
    if (iso >= heute) return speichern();
    zeigePanel(
      element('p', { class: 'frage' }, 'Dieses MHD ist abgelaufen. Ware aussortieren?'),
      [
        knopf('Ja, aussortieren', () => zeigeAussortiert(), 'haupt'),
        knopf(`Nein, MHD ${zeigeDatum(iso)} speichern`, speichern),
        knopf('Zurück', () => zeigeHaupt()),
      ]);
  }

  function zeigeAussortiert() {
    const feld = datumFeld('Neues vorderstes MHD', null);
    const mitMhd = () => {
      const iso = feld.lies();
      if (!iso) return;
      if (iso < heute) {
        feld.zeige('Dieses MHD ist auch abgelaufen.');
        return;
      }
      aktion('aussortiert', iso);
    };
    zeigePanel(
      [element('p', { class: 'frage' }, 'Ware aussortiert. Was steht jetzt vorn?'), feld.zeile],
      [
        knopf('Mit neuem MHD', mitMhd, 'haupt'),
        knopf('Kein Bestand', () => aktion('aussortiert')),
        knopf('Zurück', () => zeigeHaupt()),
      ],
      mitMhd);
    feld.eingabe.focus();
  }

  function zeigeHaupt() {
    const ohneBestand = !a.bestand;
    if (a.aktiv === false || ohneBestand) {
      const feld = datumFeld('MHD der vordersten Ware', null);
      const wiederDa = () => {
        const iso = feld.lies();
        if (iso) pruefeAbgelaufen(iso, () => aktion('geprueft', iso, HINWEISE.wieder_da));
      };
      const knoepfe = [knopf('Wieder da', wiederDa, 'haupt')];
      if (a.aktiv !== false) {
        knoepfe.push(knopf('Weiter ohne Bestand', () => aktion('ohne_bestand')));
        knoepfe.push(knopf('Aus dem Sortiment nehmen', () => aktion('ruht')));
      }
      zeigePanel(feld.zeile, knoepfe, wiederDa);
      return;
    }
    const feld = datumFeld('Vorderstes MHD', a.mhd);
    const geprueft = () => {
      const iso = feld.lies();
      if (iso) pruefeAbgelaufen(iso, () => aktion('geprueft', iso));
    };
    zeigePanel(feld.zeile, [
      knopf('Geprüft', geprueft, 'haupt'),
      knopf('Reduziert', () => aktion('reduziert')),
      knopf('Aussortiert', () => zeigeAussortiert()),
    ], geprueft);
  }

  const status = statusText(a, heute);
  const angaben = [
    ['Marke', a.marke], ['Menge', a.menge], ['Platz', a.platz], ['Warengruppe', a.warengruppe],
    ['Strichcode', a.ean],
  ].filter(([, wert]) => wert);

  wurzel.append(...[
    element('header', { class: 'kopf' },
      element('button', { type: 'button', class: 'knopf klein', onclick: zurueck }, 'Zurück'),
      element('h1', {}, a.name, a.aktiv === false && element('span', { class: 'marke-ruht' }, 'ruht'))),
    element('dl', { class: 'angaben' }, angaben.map(([name, wert]) => [element('dt', {}, name), element('dd', {}, wert)])),
    status && element('p', { class: `status-gross abschnitt-${a.abschnitt}` }, status),
    a.reduziert && a.bestand && element('p', { class: 'einzelheit' }, 'Bereits reduziert.'),
    bereich].filter(Boolean));
  zeigeHaupt();
};
