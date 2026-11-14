// Verbindung zu Supabase: Zeitgrenze und Fehlercodes. fetch ist ausgetauscht; es läuft kein Server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neueVerbindung, ZEITGRENZE_MS } from '../docs/api.js';

const antwort = (status, inhalt) => ({ ok: status >= 200 && status < 300, status, json: async () => inhalt });

test('Zeitgrenze im Betrieb: 15 Sekunden', () => {
  assert.equal(ZEITGRENZE_MS, 15000);
});

test('hängende Verbindung: nach der Zeitgrenze KEINE_VERBINDUNG, das Abbruchsignal wird ausgelöst', async () => {
  let signal;
  const api = neueVerbindung({ url: 'https://test.invalid', schluessel: 'k', zeitMs: 30, holen: (_, o) => { signal = o.signal; return new Promise(() => {}); } });
  const start = Date.now();
  await assert.rejects(api.rpc('mhd_liste', {}, 't'), { message: 'KEINE_VERBINDUNG' });
  assert.ok(Date.now() - start < 1000);
  assert.equal(signal.aborted, true);
});

test('Antwort kommt, aber der Inhalt hängt: ebenfalls KEINE_VERBINDUNG', async () => {
  const api = neueVerbindung({ url: 'https://test.invalid', schluessel: 'k', zeitMs: 30, holen: async () => ({ ok: true, status: 200, json: () => new Promise(() => {}) }) });
  await assert.rejects(api.rpc('mhd_liste', {}, 't'), { message: 'KEINE_VERBINDUNG' });
});

test('Fehlercode: message (Datenbank), error_code, error (z. B. invalid_grant), msg; Status steht dabei', async () => {
  for (const [inhalt, code] of [
    [{ message: 'PIN_ABGELAUFEN', code: 'P0001' }, 'PIN_ABGELAUFEN'],
    [{ code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' }, 'invalid_credentials'],
    [{ error: 'invalid_grant', error_description: 'Invalid Refresh Token' }, 'invalid_grant'],
    [{ msg: 'irgendwas' }, 'irgendwas'],
    [null, 'HTTP_400'],
  ]) {
    const api = neueVerbindung({ url: 'https://test.invalid', schluessel: 'k', holen: async () => antwort(400, inhalt) });
    await assert.rejects(api.erneuern('r'), { message: code, status: 400 }, code);
  }
});

test('Erfolg: Inhalt zurück, Token als Bearer, Abbruchsignal übergeben', async () => {
  let aufruf;
  const api = neueVerbindung({ url: 'https://test.invalid', schluessel: 'k', holen: async (adresse, o) => { aufruf = { adresse, o }; return antwort(200, { ok: 1 }); } });
  assert.deepEqual(await api.rpc('mhd_liste', { p_sitzung: 's' }, 'tok'), { ok: 1 });
  assert.equal(aufruf.adresse, 'https://test.invalid/rest/v1/rpc/mhd_liste');
  assert.equal(aufruf.o.headers.Authorization, 'Bearer tok');
  assert.ok(aufruf.o.signal instanceof AbortSignal);
});
