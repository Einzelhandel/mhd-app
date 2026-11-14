// Anmeldung, Ansichtswechsel und Datenbankaufruf der MHD-App.
// Aufbau übernommen aus einem früheren eigenen Projekt.
// Ansichten tragen sich beim Import selbst ein: ansichten.<name> = (wurzel, daten) => …
// Sie werden in main.js importiert, nicht hier (sonst Importzyklus).
import { $, element, meldung, fehlertext } from './hilfe.js';
import { rpc } from './api.js';
import * as sitzung from './sitzung.js';

export const ansichten = {};

// Das Datum „heute“ kommt vom Server (mhd_liste), nie von der Uhr des Geräts.
export const stand = { heute: null };

let aktuell = null;
export const aktuelleAnsicht = () => aktuell;
export const gibtAnsicht = (name) => Object.hasOwn(ansichten, name);

// { name, rolle } des angemeldeten Mitarbeiters oder null
export function ich() {
  const pin = sitzung.pinSitzung();
  return pin ? { name: pin.name, rolle: pin.rolle } : null;
}

// Baut die Ansicht neu auf. Jede Ansicht bekommt ein eigenes Element; eine Ansicht, die
// nach einem Wechsel noch lädt, schreibt dadurch ins Leere statt in die neue Ansicht.
export function wechsle(name, daten) {
  if (!gibtAnsicht(name)) {
    meldung('Diese Ansicht gibt es noch nicht.');
    return;
  }
  aktuell = name;
  const wurzel = element('section', { class: `ansicht ansicht-${name}` });
  $('ansicht').replaceChildren(wurzel);
  meldung('');
  window.scrollTo(0, 0);
  Promise.resolve()
    .then(() => ansichten[name](wurzel, daten))
    .catch((fehler) => { if (!fehler.behandelt) meldung(fehlertext(fehler.message)); });
}

const OHNE_SITZUNG = new Set(['mhd_markt', 'mhd_pin_anmelden']);

// Ruft eine mhd_-Funktion auf: Token des Markt-Kontos, bei den meisten Funktionen
// zusätzlich die PIN-Sitzung als p_sitzung.
export async function mhdRpc(funktion, parameter = {}) {
  try {
    const p = { ...parameter };
    if (!OHNE_SITZUNG.has(funktion)) {
      const pin = sitzung.pinSitzung();
      if (!pin) throw new Error('PIN_ABGELAUFEN');
      p.p_sitzung = pin.sitzung;
    }
    return await rpc(funktion, p, await sitzung.token());
  } catch (fehler) {
    const code = fehler.message;
    if (code === 'PIN_ABGELAUFEN') {
      sitzung.pinSetzen(null);
      wechsle('pin');
      meldung(fehlertext(code));
      fehler.behandelt = true;
    } else if (code === 'NICHT_ANGEMELDET' || code === 'KEIN_ZUGRIFF' || fehler.status === 401) {
      sitzung.logout();
      wechsle('anmeldung');
      meldung(fehlertext(code === 'KEIN_ZUGRIFF' ? code : 'NICHT_ANGEMELDET'));
      fehler.behandelt = true;
    }
    throw fehler;
  }
}

// „Heute“ laut Server; wird die Liste noch nicht kennen, einmal nachladen.
export async function serverHeute() {
  if (!stand.heute) stand.heute = (await mhdRpc('mhd_liste')).heute;
  return stand.heute;
}

export function abmelden() {
  sitzung.pinSetzen(null);
  wechsle('pin');
}

export function start() {
  if (!sitzung.istAngemeldet()) wechsle('anmeldung');
  else if (!sitzung.pinSitzung()) wechsle('pin');
  else wechsle('liste');
}
