// Markt-Konto im Browser: Erneuern des Tokens (abgemeldet nur bei 400/401/403), Wiederholen nach 401.
// fetch und Speicher sind ausgetauscht; es läuft kein Server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neueSitzung } from '../docs/sitzung.js';
import { neueVerbindung } from '../docs/api.js';

// Speicher wie localStorage/sessionStorage.
function speicher(anfang = {}) {
  const daten = new Map(Object.entries(anfang));
  return { getItem: (k) => daten.get(k) ?? null, setItem: (k, v) => daten.set(k, String(v)), removeItem: (k) => daten.delete(k), daten };
}

const antwort = (status, inhalt) => ({ ok: status >= 200 && status < 300, status, json: async () => inhalt });

// Sitzung mit gespeichertem Markt-Konto; `ablauf` in Millisekunden ab jetzt. `holen` beantwortet die Anfragen.
function aufbau(holen, { ablauf = -1000 } = {}) {
  const markt = { token: 'alt', refresh: 'r1', ablauf: Date.now() + ablauf };
  const lokal = speicher({ 'mhd-markt': JSON.stringify(markt) });
  const anfragen = [];
  const api = neueVerbindung({
    url: 'https://test.invalid', schluessel: 'k',
    holen: async (adresse, optionen) => { anfragen.push({ adresse, body: JSON.parse(optionen.body), auth: optionen.headers.Authorization }); return holen(adresse, optionen); },
  });
  const s = neueSitzung({ api, speicher: { localStorage: lokal, sessionStorage: speicher() } });
  return { s, lokal, anfragen };
}

const neuesPaar = () => antwort(200, { access_token: 'neu', refresh_token: 'r2', expires_in: 3600 });

test('token: noch gültig → kein Aufruf; abgelaufen → einmal erneuern, neues Token wird gespeichert', async () => {
  const gueltig = aufbau(() => assert.fail('kein Aufruf erwartet'), { ablauf: 10 * 60_000 });
  assert.equal(await gueltig.s.token(), 'alt');

  const { s, lokal, anfragen } = aufbau(neuesPaar);
  assert.equal(await s.token(), 'neu');
  assert.equal(anfragen.length, 1);
  assert.equal(anfragen[0].adresse, 'https://test.invalid/auth/v1/token?grant_type=refresh_token');
  assert.deepEqual(anfragen[0].body, { refresh_token: 'r1' });
  assert.equal(JSON.parse(lokal.daten.get('mhd-markt')).refresh, 'r2');
  assert.equal(await s.token(), 'neu');
  assert.equal(anfragen.length, 1);
});

test('token: 400 invalid_grant (Erneuerungs-Token ungültig) → NICHT_ANGEMELDET', async () => {
  const { s } = aufbau(() => antwort(400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token' }));
  await assert.rejects(s.token(), { message: 'NICHT_ANGEMELDET' });
  for (const status of [401, 403]) {
    const x = aufbau(() => antwort(status, { msg: 'nein' }));
    await assert.rejects(x.s.token(), { message: 'NICHT_ANGEMELDET' }, String(status));
  }
});

test('token: 500, 503 und 429 sind vorübergehend → KEINE_VERBINDUNG, das Konto bleibt angemeldet', async () => {
  for (const status of [500, 503, 429]) {
    let n = 0;
    const { s, lokal } = aufbau(() => (++n === 1 ? antwort(status, { message: 'später' }) : neuesPaar()));
    await assert.rejects(s.token(), { message: 'KEINE_VERBINDUNG' }, String(status));
    assert.equal(s.istAngemeldet(), true, String(status));
    assert.equal(JSON.parse(lokal.daten.get('mhd-markt')).refresh, 'r1', String(status));
    assert.equal(await s.token(), 'neu', `${status}: der nächste Versuch klappt`);
  }
});

test('token: Netzfehler → KEINE_VERBINDUNG, das Konto bleibt angemeldet', async () => {
  const { s } = aufbau(() => Promise.reject(new TypeError('Failed to fetch')));
  await assert.rejects(s.token(), { message: 'KEINE_VERBINDUNG' });
  assert.equal(s.istAngemeldet(), true);
});

test('token: gleichzeitige Aufrufe teilen sich eine Erneuerung (das Erneuerungs-Token gilt einmal)', async () => {
  let freigeben;
  const { s, anfragen } = aufbau(() => new Promise((ok) => { freigeben = () => ok(neuesPaar()); }));
  const alle = Promise.all([s.token(), s.token(), s.token()]);
  await new Promise((ok) => setTimeout(ok, 10));
  freigeben();
  assert.deepEqual(await alle, ['neu', 'neu', 'neu']);
  assert.equal(anfragen.length, 1);
});

test('mitToken: 401 → einmal still erneuern und wiederholen', async () => {
  const { s, anfragen } = aufbau(neuesPaar, { ablauf: 10 * 60_000 });
  const gesehen = [];
  const r = await s.mitToken(async (t) => {
    gesehen.push(t);
    if (t === 'alt') throw Object.assign(new Error('JWT expired'), { status: 401 });
    return 'ok';
  });
  assert.equal(r, 'ok');
  assert.deepEqual(gesehen, ['alt', 'neu']);
  assert.equal(anfragen.length, 1);
});

test('mitToken: zweites 401 wird weitergereicht; andere Fehler ohne Erneuerung', async () => {
  const { s, anfragen } = aufbau(neuesPaar, { ablauf: 10 * 60_000 });
  let n = 0;
  await assert.rejects(s.mitToken(async () => { n += 1; throw Object.assign(new Error('JWT invalid'), { status: 401 }); }), { status: 401 });
  assert.equal(n, 2);
  assert.equal(anfragen.length, 1);
  await assert.rejects(s.mitToken(async () => { throw Object.assign(new Error('PIN_ABGELAUFEN'), { status: 400 }); }), { message: 'PIN_ABGELAUFEN' });
  assert.equal(anfragen.length, 1);
});

test('mitToken: 401, Erneuerung scheitert vorübergehend → KEINE_VERBINDUNG; endgültig → NICHT_ANGEMELDET', async () => {
  const kaputt = aufbau(() => antwort(502, null), { ablauf: 10 * 60_000 });
  await assert.rejects(kaputt.s.mitToken(async () => { throw Object.assign(new Error('JWT'), { status: 401 }); }), { message: 'KEINE_VERBINDUNG' });
  assert.equal(kaputt.s.istAngemeldet(), true);
  const weg = aufbau(() => antwort(400, { error_code: 'refresh_token_not_found' }), { ablauf: 10 * 60_000 });
  await assert.rejects(weg.s.mitToken(async () => { throw Object.assign(new Error('JWT'), { status: 401 }); }), { message: 'NICHT_ANGEMELDET' });
});

test('mitToken: wurde das abgelehnte Token schon ersetzt, wird nicht noch einmal erneuert', async () => {
  const { s, anfragen } = aufbau(neuesPaar, { ablauf: 10 * 60_000 });
  // Zwei Aufrufe mit dem alten Token bekommen beide 401; nur einer erneuert.
  const aufruf = async (t) => { if (t === 'alt') { await new Promise((ok) => setTimeout(ok, 5)); throw Object.assign(new Error('JWT'), { status: 401 }); } return t; };
  assert.deepEqual(await Promise.all([s.mitToken(aufruf), s.mitToken(aufruf)]), ['neu', 'neu']);
  assert.equal(await s.mitToken(aufruf), 'neu');
  assert.equal(anfragen.length, 1);
});
