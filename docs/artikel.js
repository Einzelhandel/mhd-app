// Ansicht „Artikel“: Angaben zum Artikel und die Aktionen (geprüft, reduziert, aussortiert, wieder da …).
import { ansichten, wechsle, mhdRpc, serverHeute, ich } from './app.js';
import { element, meldung, mitSperre, fehlertext, ausweg } from './hilfe.js';
import { leseDatum, zeigeDatum } from './datum.js';
import { schritte, panelArt, DATUM_FEHLER } from './artikel-aktion.js';
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
  const zurueck = () => (daten.zurueck ? wechsle(daten.zurueck.ansicht, daten.zurueck.daten) : wechsle('liste'));
  let heute;
  try {
    heute = await serverHeute();
  } catch (fehler) {
    if (fehler.behandelt) throw fehler;
    meldung(fehlertext(fehler.message));
    wurzel.append(element('h1', {}, a.name), ausweg(() => wechsle('artikel', daten), zurueck));
    return;
  }
  const bereich = element('div', { class: 'bereich' });

  // Sendet die Aufrufe nacheinander (schlägt einer fehl, bleiben die folgenden ungesendet)
  // und kehrt mit kurzer Bestätigung zur Liste zurück.
  function ausfuehren(aufrufe, hinweis) {
    return mitSperre(wurzel, async () => {
      for (const { art, mhd } of aufrufe) {
        const parameter = { p_artikel: a.id, p_art: art };
        if (mhd) parameter.p_mhd = mhd;
        await mhdRpc('mhd_aktion', parameter);
      }
      wechsle('liste');
      meldung(hinweis, 'ok');
    });
  }
  const aktion = (art, mhd, hinweis = HINWEISE[art]) => ausfuehren([{ art, mhd }], hinweis);

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
          zeige(DATUM_FEHLER);
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
    const art = panelArt(a, daten.neu);
    if (art === 'neu') {
      // Gerade angelegt (und im Markt gescannt): nur das MHD der vordersten Ware fehlt.
      const feld = datumFeld('Vorderstes MHD', null);
      const speichern = () => {
        const iso = feld.lies();
        if (iso) pruefeAbgelaufen(iso, () => aktion('geprueft', iso, 'MHD gespeichert.'));
      };
      zeigePanel([element('p', { class: 'frage' }, 'Neuer Artikel – bitte das vorderste MHD eingeben.'), feld.zeile],
        [knopf('MHD speichern', speichern, 'haupt'), knopf('Aus dem Sortiment nehmen', () => aktion('ruht'))], speichern);
      return;
    }
    if (art === 'ohne_bestand') {
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
    // Geprüft und Reduziert lesen beide das Feld; Reduziert sendet ein geändertes MHD zuerst als „geprüft“.
    const mitFeld = (art) => () => {
      const aufrufe = schritte(art, feld.eingabe.value, a, heute);
      if (aufrufe.fehler) {
        feld.zeige(aufrufe.fehler);
        feld.eingabe.focus();
        return;
      }
      const senden = () => ausfuehren(aufrufe, HINWEISE[art]);
      const neuesMhd = aufrufe[0].mhd; // geprueft: das MHD; reduziert: nur bei geändertem MHD
      if (neuesMhd) pruefeAbgelaufen(neuesMhd, senden);
      else senden();
    };
    const geprueft = mitFeld('geprueft');
    zeigePanel(feld.zeile, [
      knopf('Geprüft', geprueft, 'haupt'),
      knopf('Reduziert', mitFeld('reduziert')),
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
    ich()?.rolle === 'leitung' && element('button', {
      type: 'button', class: 'knopf klein',
      onclick: () => wechsle('artikel-neu', { artikel: a, artikelZurueck: daten.zurueck }),
    }, 'Bearbeiten'),
    element('dl', { class: 'angaben' }, angaben.map(([name, wert]) => [element('dt', {}, name), element('dd', {}, wert)])),
    status && element('p', { class: `status-gross abschnitt-${a.abschnitt}` }, status),
    a.reduziert && a.bestand && element('p', { class: 'einzelheit' }, 'Bereits reduziert.'),
    bereich].filter(Boolean));
  zeigeHaupt();
  if (daten.fokus === 'mhd') wurzel.querySelector('#mhd')?.focus();
};
