// PIN-Felder sind keine Passwortfelder: Der Browser soll PINs weder zum Speichern anbieten noch eintragen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { pinAttribute } from '../docs/hilfe.js';

const DOCS = new URL('../docs/', import.meta.url);
const dateien = async () => (await readdir(DOCS)).filter((d) => d.endsWith('.js'));

test('type password kommt in docs/*.js genau einmal vor: im Markt-Passwort der Anmeldung', async () => {
  const treffer = [];
  for (const datei of await dateien()) {
    const inhalt = await readFile(new URL(datei, DOCS), 'utf8');
    for (const _ of inhalt.matchAll(/type\s*[:=]\s*['"]password['"]/g)) treffer.push(datei);
  }
  assert.deepEqual(treffer, ['anmeldung.js']);
  const quelle = await readFile(new URL('anmeldung.js', DOCS), 'utf8');
  assert.match(quelle, /id: 'passwort'[^\n]*type: 'password', autocomplete: 'current-password'/);
});

test('pinAttribute: Textfeld mit Zifferntastatur, ohne Merken, Korrektur und Vorschläge', () => {
  assert.deepEqual(
    { ...pinAttribute() },
    { type: 'text', inputmode: 'numeric', pattern: '[0-9]*', autocomplete: 'off', maxlength: '6',
      autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false', class: 'pin-feld' });
});

test('pinAttribute: zusätzliche Attribute ergänzen, Sicherheitsattribute und Klasse bleiben', () => {
  const a = pinAttribute({ id: 'pin', class: 'breit', autocomplete: 'on', type: 'password' });
  assert.equal(a.id, 'pin');
  assert.equal(a.autocomplete, 'off');
  assert.equal(a.type, 'text');
  assert.equal(a.class, 'pin-feld breit');
});

test('jedes PIN-Feld entsteht über pinFeld(); die Klasse pin-feld steht nur in hilfe.js', async () => {
  for (const datei of await dateien()) {
    const inhalt = await readFile(new URL(datei, DOCS), 'utf8');
    if (datei !== 'hilfe.js') assert.doesNotMatch(inhalt, /pin-feld/, datei);
  }
  for (const datei of ['anmeldung.js', 'einstellungen.js']) {
    assert.match(await readFile(new URL(datei, DOCS), 'utf8'), /pinFeld\(/, datei);
  }
});

test('style.css verdeckt .pin-feld mit -webkit-text-security: disc', async () => {
  const css = await readFile(new URL('style.css', DOCS), 'utf8');
  assert.match(css, /\.pin-feld\s*\{[^}]*-webkit-text-security:\s*disc;/);
});
