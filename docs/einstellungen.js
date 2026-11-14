// Ansicht „Einstellungen“ (nur Marktleitung): Mitarbeiter und Regeln je Warengruppe.
// Die Rechte prüft der Server (NUR_LEITUNG); die Ansicht zeigt sich nur der Leitung.
import { ansichten, wechsle, mhdRpc, ich } from './app.js';
import { element, meldung, mitSperre, fehlertext, ausweg } from './hilfe.js';
import { pruefeRegel, pruefePin } from './leitung-logik.js';

let zaehler = 0;
const neueId = (name) => `${name}-${++zaehler}`;

// Feld mit Beschriftung: { zeile, eingabe }
function textFeld(beschriftung, wert, extra = {}) {
  const id = neueId('f');
  const eingabe = element('input', { id, name: id, type: 'text', autocomplete: 'off', value: wert ?? '', ...extra });
  return { eingabe, zeile: element('div', { class: 'feld' }, element('label', { for: id }, beschriftung), eingabe) };
}

// Zahlenfeld im Satz: „Prüfen [ 3 ] Tage vor dem MHD“
function zahlFeld(vorher, wert, nachher) {
  const eingabe = element('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', class: 'zahl', value: wert, maxlength: 4 });
  return { eingabe, zeile: element('label', { class: 'zahlfeld' }, vorher, eingabe, nachher) };
}

// Fehlerstelle am Formular
function fehlerStelle() {
  const stelle = element('p', { class: 'feldfehler', role: 'alert', hidden: true });
  return { stelle, zeige: (text) => { stelle.textContent = text || ''; stelle.hidden = !text; } };
}

const ROLLEN = { mitarbeiter: 'Mitarbeiter', leitung: 'Marktleitung' };

// Formular eines Mitarbeiters (m = null: neu). speichern(daten) sendet, abbrechen schließt.
function mitarbeiterFormular(m, speichern, abbrechen) {
  const name = textFeld('Name', m?.name, { maxlength: 40, required: true });
  const rolle = element('select', { id: neueId('rolle'), name: 'rolle' },
    Object.entries(ROLLEN).map(([wert, text]) => element('option', { value: wert, selected: wert === (m?.rolle ?? 'mitarbeiter') }, text)));
  const aktiv = element('input', { id: neueId('aktiv'), name: 'aktiv', type: 'checkbox', checked: m ? m.aktiv : true });
  // Die PIN wird nie vorbelegt und nach dem Speichern nicht wieder angezeigt.
  const pin = textFeld(m ? 'Neue PIN (leer lassen = unverändert)' : 'PIN (4 bis 6 Ziffern)', '',
    { type: 'password', inputmode: 'numeric', maxlength: 6, autocomplete: 'new-password' });
  const { stelle, zeige } = fehlerStelle();
  const formular = element('form', {
    class: 'formular karte',
    novalidate: true,
    onsubmit: (e) => {
      e.preventDefault();
      zeige('');
      if (!name.eingabe.value.trim()) { zeige(fehlertext('NAME_FEHLT')); name.eingabe.focus(); return; }
      const pinText = pin.eingabe.value;
      const pinFehler = !m || pinText ? pruefePin(pinText) : null;
      if (pinFehler) { zeige(pinFehler); pin.eingabe.focus(); return; }
      const daten = { name: name.eingabe.value.trim(), rolle: rolle.value, aktiv: aktiv.checked };
      if (pinText) daten.pin = pinText;
      mitSperre(formular, () => speichern(daten), zeige);
    },
  },
  name.zeile,
  element('div', { class: 'feld' }, element('label', { for: rolle.id }, 'Rolle'), rolle),
  element('label', { class: 'schalter', for: aktiv.id }, aktiv, 'aktiv'),
  pin.zeile, stelle,
  element('div', { class: 'knopfreihe' },
    element('button', { type: 'submit', class: 'knopf haupt' }, 'Speichern'),
    element('button', { type: 'button', class: 'knopf', onclick: abbrechen }, 'Abbrechen')));
  return { formular, fokus: () => name.eingabe.focus() };
}

async function mitarbeiterBereich(bereich) {
  const liste = element('div', { class: 'inhalt' });
  const neuPlatz = element('div');
  const neuKnopf = element('button', { type: 'button', class: 'knopf', onclick: () => oeffne(null, neuPlatz) }, 'Neuer Mitarbeiter');
  bereich.replaceChildren(element('h2', { class: 'bereichkopf' }, 'Mitarbeiter'), neuPlatz, liste, neuKnopf);

  async function laden() {
    let mitarbeiter;
    try {
      mitarbeiter = await mhdRpc('mhd_mitarbeiter_liste');
    } catch (fehler) {
      if (fehler.behandelt) return;
      meldung(fehlertext(fehler.message));
      liste.replaceChildren(ausweg(laden));
      return;
    }
    liste.replaceChildren(...mitarbeiter.map((m) => {
      const platz = element('div', { class: 'karte' });
      const zeigeZeile = () => platz.replaceChildren(
        element('div', { class: 'kartenzeile' },
          element('span', { class: 'name' }, m.name),
          element('span', { class: 'einzelheit' }, [ROLLEN[m.rolle] ?? m.rolle, !m.aktiv && 'inaktiv', m.gesperrt && 'gesperrt'].filter(Boolean).join(' · ')),
          element('button', { type: 'button', class: 'knopf klein', onclick: () => oeffne(m, platz, zeigeZeile) }, 'Bearbeiten')));
      zeigeZeile();
      return platz;
    }));
  }

  function oeffne(m, platz, zurZeile) {
    const schliessen = () => {
      if (m) zurZeile(); else platz.replaceChildren();
      neuKnopf.hidden = false;
    };
    const { formular, fokus } = mitarbeiterFormular(m, async (daten) => {
      await mhdRpc('mhd_mitarbeiter_speichern', { p_id: m?.id ?? null, p_daten: daten });
      neuPlatz.replaceChildren();
      neuKnopf.hidden = false;
      meldung('Gespeichert.', 'ok');
      await laden();
    }, schliessen);
    if (!m) neuKnopf.hidden = true;
    platz.replaceChildren(formular);
    fokus();
  }
  await laden();
}

// Eine Warengruppe (g = null: neu) mit Name und den drei Zahlenfeldern.
function gruppenFormular(g, speichern, abbrechen) {
  const name = textFeld('Name der Warengruppe', g?.name, { maxlength: 40, required: true });
  const felder = {
    pruef: zahlFeld('Prüfen', g?.pruef_vorlauf_tage ?? 3, 'Tage vor dem MHD'),
    reduzier: zahlFeld('Reduzieren', g?.reduzier_vorlauf_tage ?? 2, 'Tage vor dem MHD'),
    max: zahlFeld('Spätestens alle', g?.max_intervall_tage ?? 30, 'Tage prüfen'),
  };
  const { stelle, zeige } = fehlerStelle();
  const formular = element('form', {
    class: 'formular karte',
    novalidate: true,
    onsubmit: (e) => {
      e.preventDefault();
      zeige('');
      if (!name.eingabe.value.trim()) { zeige(fehlertext('NAME_FEHLT')); name.eingabe.focus(); return; }
      const regel = pruefeRegel({ pruef: felder.pruef.eingabe.value, reduzier: felder.reduzier.eingabe.value, max: felder.max.eingabe.value });
      if (regel.fehler) { zeige(regel.fehler); felder[regel.feld].eingabe.focus(); return; }
      mitSperre(formular, () => speichern({ name: name.eingabe.value.trim(), ...regel.werte }), zeige);
    },
  },
  name.zeile, felder.pruef.zeile, felder.reduzier.zeile, felder.max.zeile, stelle,
  element('div', { class: 'knopfreihe' },
    element('button', { type: 'submit', class: 'knopf haupt' }, 'Speichern'),
    abbrechen && element('button', { type: 'button', class: 'knopf', onclick: abbrechen }, 'Abbrechen')));
  return { formular, fokus: () => name.eingabe.focus() };
}

async function gruppenBereich(bereich) {
  const liste = element('div', { class: 'inhalt' });
  const neuPlatz = element('div');
  const neuKnopf = element('button', { type: 'button', class: 'knopf', onclick: () => oeffneNeu() }, 'Neue Warengruppe');
  bereich.replaceChildren(
    element('h2', { class: 'bereichkopf' }, 'Warengruppen'),
    element('p', { class: 'hinweis-text' }, 'Die Regel gilt sofort für alle Artikel der Gruppe.'),
    liste, neuPlatz, neuKnopf);

  const speichernMit = (g) => async (daten) => {
    await mhdRpc('mhd_warengruppe_speichern', { p_id: g?.id ?? null, p_daten: daten });
    meldung('Gespeichert.', 'ok');
    neuPlatz.replaceChildren();
    neuKnopf.hidden = false;
    await laden();
  };

  async function laden() {
    let gruppen;
    try {
      gruppen = await mhdRpc('mhd_warengruppen');
    } catch (fehler) {
      if (fehler.behandelt) return;
      meldung(fehlertext(fehler.message));
      liste.replaceChildren(ausweg(laden));
      return;
    }
    liste.replaceChildren(...gruppen.map((g) => gruppenFormular(g, speichernMit(g)).formular));
  }

  function oeffneNeu() {
    const { formular, fokus } = gruppenFormular(null, speichernMit(null), () => {
      neuPlatz.replaceChildren();
      neuKnopf.hidden = false;
    });
    neuKnopf.hidden = true;
    neuPlatz.replaceChildren(formular);
    fokus();
  }
  await laden();
}

ansichten.einstellungen = async (wurzel) => {
  if (ich()?.rolle !== 'leitung') {
    wechsle('liste');
    return;
  }
  const mitarbeiter = element('section', { class: 'bereich-gruppe' });
  const gruppen = element('section', { class: 'bereich-gruppe' });
  wurzel.append(
    element('header', { class: 'kopf' },
      element('button', { type: 'button', class: 'knopf klein', onclick: () => wechsle('liste') }, 'Zurück'),
      element('h1', {}, 'Einstellungen'),
      element('button', { type: 'button', class: 'knopf klein', onclick: () => wechsle('protokoll') }, 'Protokoll')),
    mitarbeiter, gruppen);
  await Promise.all([mitarbeiterBereich(mitarbeiter), gruppenBereich(gruppen)]);
};
