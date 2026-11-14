// Ansicht „Heute“: die fünf Abschnitte der Tagesliste.
import { ansichten, wechsle, gibtAnsicht, mhdRpc, ich, stand, abmelden } from './app.js';
import { element, meldung, fehlertext, ausweg } from './hilfe.js';
import { zeigeDatum, ueberschriftHeute, geraeteTag, neuerTag } from './datum.js';
import { installBereich } from './app-installieren.js';

// Feste Reihenfolge der Abschnitte (die Datenbank liefert die Schlüssel alphabetisch).
export const ABSCHNITTE = [
  ['abgelaufen', 'Abgelaufen / versäumt'],
  ['laeuft_ab', 'Läuft heute ab'],
  ['pruefen', 'Heute prüfen'],
  ['reduzieren', 'Heute reduzieren'],
  ['ohne_bestand', 'Ohne Bestand – wieder da?'],
];

const tage = (n) => `${n} ${n === 1 ? 'Tag' : 'Tagen'}`;

// Was an diesem Artikel versäumt wurde bzw. warum er in seinem Abschnitt steht.
export function statusText(artikel, heute) {
  const teile = [];
  if (artikel.abschnitt === 'abgelaufen') {
    const text = {
      abgelaufen: 'abgelaufen seit',
      pruefen: 'Prüfen versäumt seit',
      reduzieren: 'Reduzieren versäumt seit',
    }[artikel.versaeumt];
    if (text) teile.push(`${text} ${tage(artikel.seit_tagen)}`);
    if (artikel.mhd === heute) teile.push('läuft heute ab');
  } else if (artikel.abschnitt === 'ohne_bestand') {
    teile.push(artikel.versaeumt === 'mhd_fehlt' ? 'MHD fehlt noch' : `ohne Bestand seit ${tage(artikel.seit_tagen)}`);
  }
  return teile.join(' · ');
}

// Eine antippbare Zeile für Liste und Suche. `beimOeffnen` bekommt den Artikel.
export function artikelZeile(artikel, heute, beimOeffnen) {
  const status = statusText(artikel, heute);
  return element('button', { type: 'button', class: `zeile abschnitt-${artikel.abschnitt ?? 'keiner'}`, onclick: () => beimOeffnen(artikel) },
    element('span', { class: 'name' }, artikel.name, artikel.aktiv === false && element('span', { class: 'marke-ruht' }, 'ruht')),
    element('span', { class: 'einzelheit' }, [artikel.menge, artikel.platz].filter(Boolean).join(' · ')),
    element('span', { class: 'einzelheit' },
      artikel.mhd ? `MHD ${zeigeDatum(artikel.mhd)}` : 'kein MHD',
      status && element('span', { class: 'status' }, status)));
}

function zeigeAbschnitte(inhalt, daten) {
  const heute = daten.heute;
  const teile = [];
  for (const [schluessel, titel] of ABSCHNITTE) {
    const artikel = daten.abschnitte[schluessel] ?? [];
    if (!artikel.length) continue;
    teile.push(element('section', { class: `abschnitt abschnitt-${schluessel}` },
      element('h2', {}, `${titel} (${artikel.length})`),
      artikel.map((a) => artikelZeile(a, heute, () => wechsle('artikel', { artikel: a })))));
  }
  if (!teile.length) teile.push(element('p', { class: 'leer' }, 'Heute ist nichts zu tun.'));
  inhalt.replaceChildren(...teile);
}

let aktiv = null; // { wurzel, laden, geraetTag } der gerade angezeigten Liste; geraetTag: Tag des Geräts beim letzten Laden

// Wird die Seite wieder sichtbar (Handy aus der Tasche, Wechsel der App), neu laden.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && aktiv?.wurzel.isConnected) aktiv.laden();
});

// Bleibt der Bildschirm an, bemerkt die Liste den neuen Tag selbst: einmal pro Minute ein Blick auf die Uhr des
// Geräts, ohne Serveraufruf (jeder Aufruf verlängert die PIN-Sitzung); nach Mitternacht genau einmal neu laden.
setInterval(() => {
  if (!document.hidden && aktiv?.wurzel.isConnected && neuerTag(aktiv.geraetTag, geraeteTag())) aktiv.laden();
}, 60_000);

ansichten.liste = (wurzel) => {
  const mitarbeiter = ich();
  const inhalt = element('div', { class: 'inhalt' }, element('p', { class: 'leer' }, 'Lade …'));
  let lauf = 0;

  async function laden() {
    const mein = ++lauf;
    eintrag.geraetTag = geraeteTag();
    try {
      const daten = await mhdRpc('mhd_liste');
      if (mein !== lauf || !wurzel.isConnected) return;
      stand.heute = daten.heute;
      titel.textContent = ueberschriftHeute(daten.heute);
      meldung('');
      zeigeAbschnitte(inhalt, daten);
    } catch (fehler) {
      if (fehler.behandelt || mein !== lauf) return;
      meldung(fehlertext(fehler.message));
      if (!inhalt.querySelector('.abschnitt')) {
        inhalt.replaceChildren(ausweg(laden));
      }
    }
  }

  const titel = element('h1', {}, 'Heute');
  const kopf = element('header', { class: 'kopf' },
    titel,
    element('span', { class: 'wer' }, mitarbeiter?.name),
    gibtAnsicht('protokoll') && mitarbeiter?.rolle === 'leitung' && element('button', { type: 'button', class: 'knopf klein', onclick: () => wechsle('protokoll') }, 'Protokoll'),
    gibtAnsicht('einstellungen') && mitarbeiter?.rolle === 'leitung' && element('button', { type: 'button', class: 'knopf klein', onclick: () => wechsle('einstellungen') }, 'Einstellungen'),
    element('button', { type: 'button', class: 'knopf klein', onclick: abmelden }, 'Abmelden'));

  const leiste = element('nav', { class: 'leiste' },
    gibtAnsicht('scan') && element('button', { type: 'button', class: 'knopf haupt', onclick: () => wechsle('scan') }, 'Scannen'),
    gibtAnsicht('suche') && element('button', { type: 'button', class: 'knopf haupt', onclick: () => wechsle('suche') }, 'Suche'));

  wurzel.append(kopf, installBereich(), inhalt, leiste);
  const eintrag = { wurzel, laden, geraetTag: null };
  aktiv = eintrag;
  return laden();
};
