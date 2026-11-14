// Aufbau übernommen aus einem früheren eigenen Projekt.
// Zwei Sitzungen:
//  - Markt-Konto (Supabase Auth) in localStorage, damit das Gerät angemeldet bleibt.
//  - PIN-Sitzung des Mitarbeiters in sessionStorage; sie endet mit dem Tab.
// Jeder Zugriff auf den Speicher ist abgesichert (privater Modus, gesperrte Website-Daten).
import * as standardApi from './api.js';

const MARKT = 'mhd-markt';
const PIN = 'mhd-pin';
// Supabase verlangt eine E-Mail-Adresse. Getippt wird nur der Kontoname;
// die Domain ist reserviert (RFC 2606) und kann keine Post empfangen.
const LOGIN_DOMAIN = 'example.com';

export function emailFuer(konto) {
  const name = konto.trim().toLowerCase();
  return name.includes('@') ? name : `${name}@${LOGIN_DOMAIN}`;
}

// Nur diese Antworten beim Erneuern heißen „abgemeldet“ (Erneuerungs-Token ungültig oder Konto gesperrt).
// 5xx, 429 und Netzfehler sind vorübergehend: Das Gerät bleibt angemeldet, denn das Markt-Passwort haben
// die Mitarbeiter nicht.
const ABGEMELDET = new Set([400, 401, 403]);

// Die App benutzt nur die Standard-Sitzung unten; api und speicher werden nur in Tests ausgetauscht.
// Ohne Seite (Node-Tests, die ein Modul der App laden) gibt es keinen Speicher; Node warnt sonst beim Zugriff.
const BROWSER_SPEICHER = typeof document === 'undefined' ? {} : globalThis;
export function neueSitzung({ api = standardApi, speicher = BROWSER_SPEICHER } = {}) {
  function lese(art, schluessel) {
    try { return JSON.parse(speicher[art].getItem(schluessel)); } catch { return null; }
  }
  function schreibe(art, schluessel, wert) {
    try {
      if (wert == null) speicher[art].removeItem(schluessel);
      else speicher[art].setItem(schluessel, JSON.stringify(wert));
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

  function pinSetzen(neu) {
    pin = neu ?? null;
    schreibe('sessionStorage', PIN, pin);
  }

  async function login(konto, passwort) {
    speichern(await api.anmelden(emailFuer(konto), passwort));
  }

  function logout() {
    // Anmeldung auch bei Supabase beenden, damit das Erneuerungs-Token ungültig wird.
    if (markt?.token) api.abmeldenServer(markt.token).catch(() => {});
    markt = null;
    schreibe('localStorage', MARKT, null);
    pinSetzen(null);
  }

  // Das Token des Markt-Kontos, kurz vor dem Ablauf erneuert. `abgelehnt`: dieses Token hat der Server gerade
  // abgewiesen (401) und wird erneuert, wenn es noch das aktuelle ist.
  async function token({ abgelehnt = null } = {}) {
    if (!markt) throw new Error('NICHT_ANGEMELDET');
    if (Date.now() > markt.ablauf - 60_000 || (abgelehnt && abgelehnt === markt.token)) {
      // Das Erneuerungs-Token gilt einmal: gleichzeitige Aufrufe teilen sich eine Erneuerung.
      const vorher = markt;
      erneuerung ??= api.erneuern(markt.refresh)
        .then((antwort) => { if (markt === vorher) speichern(antwort); })
        .finally(() => { erneuerung = null; });
      try {
        await erneuerung;
      } catch (fehler) {
        throw new Error(ABGEMELDET.has(fehler.status) ? 'NICHT_ANGEMELDET' : 'KEINE_VERBINDUNG');
      }
      if (!markt) throw new Error('NICHT_ANGEMELDET'); // inzwischen abgemeldet
    }
    return markt.token;
  }

  // Ruft aufruf(token) auf. Weist der Server das Token ab (401, z. B. abgelaufen), wird einmal still erneuert und
  // wiederholt; erst ein zweites 401 geht an den Aufrufer (der dann abmeldet).
  async function mitToken(aufruf) {
    const t = await token();
    try {
      return await aufruf(t);
    } catch (fehler) {
      if (fehler.status !== 401) throw fehler;
      return aufruf(await token({ abgelehnt: t }));
    }
  }

  return {
    istAngemeldet: () => Boolean(markt),
    login, logout, token, mitToken,
    pinSitzung: () => pin, // { sitzung, name, rolle } oder null
    pinSetzen,
  };
}

export const { istAngemeldet, login, logout, token, mitToken, pinSitzung, pinSetzen } = neueSitzung();
