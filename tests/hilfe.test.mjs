import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fehlertext, mitSperre } from '../docs/hilfe.js';

const SCHEMA = await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
const CODES = [...new Set([...SCHEMA.matchAll(/raise exception '([A-Z_]+)'/g)].map((m) => m[1]))];

test('fehlertext kennt jeden Code, den schema.sql wirft, und die Fehler der Browser-Schicht', () => {
  assert.ok(CODES.length > 10);
  const standard = fehlertext('GIBT_ES_NICHT');
  for (const c of [...CODES, 'PIN_FALSCH', 'PIN_GESPERRT', 'KEINE_VERBINDUNG', 'NICHT_ANGEMELDET', 'invalid_credentials']) {
    assert.notEqual(fehlertext(c), standard, c); // eigener deutscher Text statt Standardtext
  }
});

test('fehlertext liefert für Unbekanntes einen allgemeinen Satz ohne den Code', () => {
  const text = fehlertext('GIBT_ES_NICHT');
  assert.match(text, /\S/);
  assert.doesNotMatch(text, /GIBT_ES_NICHT/);
  assert.match(fehlertext(undefined), /\S/);
});

test('mitSperre: ein zweiter Aufruf, solange der erste läuft (z. B. zweimal Enter), wird ignoriert', async () => {
  const knopf = { disabled: false };
  const wurzel = { querySelectorAll: () => [knopf] };
  let laeufe = 0;
  let fertig;
  const warten = new Promise((ok) => { fertig = ok; });
  const aufgabe = () => { laeufe += 1; return warten; };
  const erster = mitSperre(wurzel, aufgabe);
  assert.equal(knopf.disabled, true);
  const zweiter = mitSperre(wurzel, aufgabe);          // startet die Aufgabe nicht noch einmal
  assert.equal(laeufe, 1);
  fertig('ok');
  assert.equal(await zweiter, undefined);
  assert.equal(await erster, 'ok');
  assert.equal(knopf.disabled, false);
  assert.equal(await mitSperre(wurzel, async () => { laeufe += 1; return 'wieder'; }), 'wieder'); // danach wieder frei
  assert.equal(laeufe, 2);
});

test('mitSperre: auch nach einem Fehler ist die Sperre wieder frei', async () => {
  const wurzel = { querySelectorAll: () => [] };
  const fehler = [];
  await mitSperre(wurzel, async () => { throw new Error('KEINE_VERBINDUNG'); }, (text) => fehler.push(text));
  assert.deepEqual(fehler, [fehlertext('KEINE_VERBINDUNG')]);
  assert.equal(await mitSperre(wurzel, async () => 'frei'), 'frei');
});
