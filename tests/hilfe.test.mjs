import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fehlertext } from '../docs/hilfe.js';

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
