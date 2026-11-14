// Prüft die beiden Dokumente: Pflicht-Überschriften, keine PowerShell-Befehle, vorhandene Pfade.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const wurzel = new URL('../', import.meta.url);
const lies = (name) => readFileSync(new URL(name, wurzel), 'utf8');

test('README.md enthält die Pflicht-Überschriften', () => {
  const text = lies('README.md');
  const ueberschriften = text.split('\n').filter((z) => /^#{1,3} /.test(z)).map((z) => z.replace(/^#+ /, '').trim());
  for (const noetig of ['Ausprobieren ohne Konto', 'Tests', 'Sicherheitsprinzip', 'Eigenes Supabase-Projekt', 'Aufbau', 'Grenzen']) {
    assert.ok(ueberschriften.includes(noetig), `Überschrift fehlt: ${noetig}`);
  }
});

for (const datei of ['README.md', 'ANLEITUNG.md']) {
  test(`${datei} enthält keine PowerShell-Befehle`, () => {
    const text = lies(datei);
    assert.ok(!text.includes('$env:'), '$env: gefunden');
    assert.ok(!text.includes('.ps1'), '.ps1 gefunden');
  });
}

test('README.md: jeder genannte Pfad existiert', () => {
  const text = lies('README.md');
  const pfade = [...text.matchAll(/`((?:docs|supabase|tests|werkzeug|entwurf)\/[^`\s]*)`/g)].map((t) => t[1]);
  assert.ok(pfade.length > 0, 'keine Pfade gefunden');
  for (const pfad of pfade) {
    assert.ok(existsSync(new URL(pfad, wurzel)), `Pfad fehlt: ${pfad}`);
  }
});
