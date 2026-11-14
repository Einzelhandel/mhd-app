// Aufbau übernommen aus einem früheren eigenen Projekt.
// Verbindung zu Supabase (REST und Auth). Fehler werden als Error geworfen:
// message = Fehlercode der Datenbank (z. B. "PIN_ABGELAUFEN"), Auth-Fehlercode
// (z. B. "invalid_credentials", "invalid_grant") oder "KEINE_VERBINDUNG"; status = HTTP-Status.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

// So lange darf ein Aufruf dauern; danach KEINE_VERBINDUNG, damit gesperrte Knöpfe wieder frei werden.
export const ZEITGRENZE_MS = 15000;

const keineVerbindung = () => new Error('KEINE_VERBINDUNG');

// Die App benutzt nur die Standard-Verbindung unten (feste Zeitgrenze); andere Werte gibt es nur in Tests.
export function neueVerbindung({
  url = SUPABASE_URL, schluessel = SUPABASE_KEY, holen = (...a) => globalThis.fetch(...a), zeitMs = ZEITGRENZE_MS,
} = {}) {
  async function anfrage(pfad, body, token) {
    const headers = { 'Content-Type': 'application/json', apikey: schluessel };
    // Angemeldet: Sitzungs-Token. Sonst: alte "anon"-Schlüssel sind JWTs und gehen
    // zusätzlich als Bearer mit; neue "publishable"-Schlüssel nur als apikey.
    if (token) headers.Authorization = `Bearer ${token}`;
    else if (schluessel.startsWith('eyJ')) headers.Authorization = `Bearer ${schluessel}`;
    const abbruch = new AbortController();
    const uhr = setTimeout(() => abbruch.abort(), zeitMs);
    // Ein fetch, das das Signal ignoriert (oder ein hängender Inhalt), darf trotzdem nicht hängen: Frist als Wettlauf.
    const frist = new Promise((_, nein) => abbruch.signal.addEventListener('abort', () => nein(keineVerbindung())));
    try {
      let antwort;
      try {
        antwort = await Promise.race([holen(`${url}${pfad}`, {
          method: 'POST', headers, body: JSON.stringify(body), signal: abbruch.signal,
          cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
        }), frist]);
      } catch {
        throw keineVerbindung();
      }
      const inhalt = antwort.status === 204 ? null : await Promise.race([antwort.json().catch(() => null), frist]);
      if (!antwort.ok) {
        const fehler = new Error(inhalt?.message || inhalt?.error_code || inhalt?.error || inhalt?.msg || `HTTP_${antwort.status}`);
        fehler.status = antwort.status;
        throw fehler;
      }
      return inhalt;
    } finally {
      clearTimeout(uhr);
    }
  }

  return {
    rpc: (funktion, parameter = {}, token = null) => anfrage(`/rest/v1/rpc/${funktion}`, parameter, token),
    anmelden: (email, passwort) => anfrage('/auth/v1/token?grant_type=password', { email, password: passwort }),
    erneuern: (refreshToken) => anfrage('/auth/v1/token?grant_type=refresh_token', { refresh_token: refreshToken }),
    abmeldenServer: (token) => anfrage('/auth/v1/logout?scope=local', {}, token),
  };
}

export const { rpc, anmelden, erneuern, abmeldenServer } = neueVerbindung();
