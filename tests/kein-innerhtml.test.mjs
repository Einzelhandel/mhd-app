// Namen kommen aus Open Food Facts und von Benutzern: Die Oberfläche baut das DOM nur über element().
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

const VERBOTEN = /innerHTML|outerHTML|insertAdjacentHTML|document\.write/;
const DOCS = new URL('../docs/', import.meta.url);

test('keine Datei in docs/*.js benutzt innerHTML, outerHTML, insertAdjacentHTML oder document.write', async () => {
  const dateien = (await readdir(DOCS)).filter((d) => d.endsWith('.js'));
  assert.ok(dateien.length > 0);
  for (const datei of dateien) {
    const inhalt = await readFile(new URL(datei, DOCS), 'utf8');
    assert.doesNotMatch(inhalt, VERBOTEN, datei);
  }
});
