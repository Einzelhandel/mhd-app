// Aufbau übernommen aus einem früheren eigenen Projekt.
// Zwei Sitzungen:
//  - Markt-Konto (Supabase Auth) in localStorage, damit das Gerät angemeldet bleibt.
//  - PIN-Sitzung des Mitarbeiters in sessionStorage; sie endet mit dem Tab.
// Jeder Zugriff auf den Speicher ist abgesichert (privater Modus, gesperrte Website-Daten).
import { anmelden, erneuern, abmeldenServer } from './api.js';

const MARKT = 'mhd-markt';
const PIN = 'mhd-pin';
// Supabase verlangt eine E-Mail-Adresse. Getippt wird nur der Kontoname;
// die Domain ist reserviert (RFC 2606) und kann keine Post empfangen.
const LOGIN_DOMAIN = 'example.com';

function lese(speicher, schluessel) {
  try { return JSON.parse(globalThis[speicher].getItem(schluessel)); } catch { return null; }
}

function schreibe(speicher, schluessel, wert) {
  try {
    if (wert == null) globalThis[speicher].removeItem(schluessel);
    else globalThis[speicher].setItem(schluessel, JSON.stringify(wert));
  } catch { /* nur im Speicher */ }
}

let markt = lese('localStorage', MARKT);
let pin = lese('sessionStorage', PIN);
let erneuerung = null;

function speichern(antwort) {
  markt = {
    token: antwort.access_token,
    refresh: antwort.refresh_token,
    ablauf: Date.now() + (antwort.expires_in || 3600) * 1000,
  };
  schreibe('localStorage', MARKT, markt);
}

export function emailFuer(konto) {
  const name = konto.trim().toLowerCase();
  return name.includes('@') ? name : `${name}@${LOGIN_DOMAIN}`;
}

export const istAngemeldet = () => Boolean(markt);

export async function login(konto, passwort) {
  speichern(await anmelden(emailFuer(konto), passwort));
}

export function logout() {
  // Anmeldung auch bei Supabase beenden, damit das Erneuerungs-Token ungültig wird.
  if (markt?.token) abmeldenServer(markt.token).catch(() => {});
  markt = null;
  schreibe('localStorage', MARKT, null);
  pinSetzen(null);
}

export async function token() {
  if (!markt) throw new Error('NICHT_ANGEMELDET');
  if (Date.now() > markt.ablauf - 60_000) {
    // Das Erneuerungs-Token gilt einmal: gleichzeitige Aufrufe teilen sich eine Erneuerung.
    erneuerung ??= erneuern(markt.refresh).then(speichern).finally(() => { erneuerung = null; });
    try {
      await erneuerung;
    } catch (fehler) {
      if (fehler.message === 'KEINE_VERBINDUNG') throw fehler;
      throw new Error('NICHT_ANGEMELDET');
    }
  }
  return markt.token;
}

// { sitzung, name, rolle } oder null
export const pinSitzung = () => pin;

export function pinSetzen(neu) {
  pin = neu ?? null;
  schreibe('sessionStorage', PIN, pin);
}
