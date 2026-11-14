// Zurück-Taste: welche Ansicht erscheint, wenn der Benutzer „Zurück“ drückt (reine Logik).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neuerStapel, vor, zurueckZu } from '../docs/verlauf.js';

const MIT_PIN = { angemeldet: true, pin: true };
const OHNE_PIN = { angemeldet: true, pin: false };
const OHNE_KONTO = { angemeldet: false, pin: false };

// Spielt Wechsel nacheinander durch wie wechsle() in app.js.
function gehe(stapel, ...schritte) {
  let s = stapel;
  const arten = [];
  for (const [ansicht, daten] of schritte) {
    const r = vor(s, ansicht, daten);
    s = r.stapel;
    arten.push(r.aktion);
  }
  return { stapel: s, arten };
}
const aktuell = (s) => s.eintraege[s.position].ansicht;

test('der erste Wechsel ersetzt den Eintrag der Seite; Anmeldung und PIN legen nie Einträge an', () => {
  const { stapel, arten } = gehe(neuerStapel(), ['anmeldung'], ['pin'], ['liste']);
  assert.deepEqual(arten, ['ersetzen', 'ersetzen', 'ersetzen']);
  assert.equal(stapel.eintraege.length, 1);
  assert.equal(aktuell(stapel), 'liste');
});

test('Liste → Artikel → zurück = Liste', () => {
  const { stapel, arten } = gehe(neuerStapel(), ['liste'], ['artikel', { artikel: { id: 1 } }]);
  assert.deepEqual(arten, ['ersetzen', 'anlegen']);
  const r = zurueckZu(stapel, 0, MIT_PIN);
  assert.equal(r.eintrag.ansicht, 'liste');
  assert.equal(r.ersetzen, false);
});

test('Suche → Artikel → zurück = Suche mit ihren Daten (auch dem später getippten Suchtext)', () => {
  const suchDaten = { suche: 'milch', ohneEan: false };
  const { stapel } = gehe(neuerStapel(),
    ['liste'], ['suche'], ['artikel', { artikel: { id: 1 }, zurueck: { ansicht: 'suche', daten: suchDaten } }]);
  const r = zurueckZu(stapel, 1, MIT_PIN);
  assert.equal(r.eintrag.ansicht, 'suche');
  assert.deepEqual(r.eintrag.daten, suchDaten);
});

test('Wechsel zu einer Ansicht weiter unten im Stapel geht zurück, statt einen Eintrag anzulegen', () => {
  const s = gehe(neuerStapel(), ['liste'], ['suche'], ['artikel', { zurueck: { ansicht: 'suche', daten: { suche: 'x' } } }]).stapel;
  const r = vor(s, 'liste');
  assert.equal(r.aktion, 'zurueck');
  assert.equal(r.schritte, 2);
  assert.equal(aktuell(r.stapel), 'liste');
  assert.equal(r.stapel.eintraege.length, 1);
  const r2 = vor(s, 'suche', { suche: 'x' });
  assert.equal(r2.aktion, 'zurueck');
  assert.equal(r2.schritte, 1);
  assert.deepEqual(r2.zeige, { ansicht: 'suche', daten: { suche: 'x' } });
});

test('Scan → Artikel-neu → Artikel → zurück = Liste, nicht zurück ins Formular', () => {
  const { stapel, arten } = gehe(neuerStapel(),
    ['liste'], ['scan'], ['artikel-neu', { ean: '4000000000006' }], ['artikel', { artikel: { id: 2 }, fokus: 'mhd' }]);
  assert.deepEqual(arten, ['ersetzen', 'anlegen', 'ersetzen', 'ersetzen']);
  assert.equal(stapel.eintraege.length, 2);
  assert.equal(aktuell(stapel), 'artikel');
  assert.equal(zurueckZu(stapel, 0, MIT_PIN).eintrag.ansicht, 'liste');
});

test('Scan eines bekannten Artikels: zurück = Liste; Waagen-Code: Suche statt Scan', () => {
  const a = gehe(neuerStapel(), ['liste'], ['scan'], ['artikel', { artikel: { id: 3 } }]);
  assert.equal(a.stapel.eintraege.length, 2);
  const b = gehe(neuerStapel(), ['liste'], ['scan'], ['suche', { ohneEan: true }]);
  assert.deepEqual(b.stapel.eintraege.map((e) => e.ansicht), ['liste', 'suche']);
});

test('Leitung: Suche → Artikel-neu → Artikel → zurück = Suche', () => {
  const suchDaten = { suche: '', ohneEan: true };
  const { stapel } = gehe(neuerStapel(),
    ['liste'], ['suche'], ['artikel-neu', { zurueck: { ansicht: 'suche', daten: suchDaten } }], ['artikel', { artikel: { id: 4 } }]);
  assert.deepEqual(stapel.eintraege.map((e) => e.ansicht), ['liste', 'suche', 'artikel']);
  assert.deepEqual(zurueckZu(stapel, 1, MIT_PIN).eintrag.daten, suchDaten);
});

test('nach Abmelden bleibt Zurück auf der PIN-Ansicht', () => {
  const { stapel } = gehe(neuerStapel(), ['liste'], ['pin']);
  assert.equal(stapel.eintraege.length, 1);
  const r = zurueckZu(stapel, 0, OHNE_PIN);
  assert.equal(r.eintrag.ansicht, 'pin');
});

test('abgelaufene PIN mitten im Stapel: Zurück führt nicht in eine geschützte Ansicht', () => {
  const { stapel } = gehe(neuerStapel(), ['liste'], ['suche'], ['pin']);
  assert.deepEqual(stapel.eintraege.map((e) => e.ansicht), ['liste', 'pin']);
  const r = zurueckZu(stapel, 0, OHNE_PIN);
  assert.equal(r.eintrag.ansicht, 'pin');
  assert.equal(r.ersetzen, true);
  assert.equal(r.stapel.eintraege[0].ansicht, 'pin');
  assert.equal(zurueckZu(stapel, 0, OHNE_KONTO).eintrag.ansicht, 'anmeldung');
});

test('nach erneuter PIN-Eingabe geht es zurück zur Liste unten im Stapel', () => {
  const s = gehe(neuerStapel(), ['liste'], ['suche'], ['pin']).stapel;
  const r = vor(s, 'liste');
  assert.equal(r.aktion, 'zurueck');
  assert.equal(r.schritte, 1);
});

test('unbekannter Eintrag (z. B. nach Neuladen): null', () => {
  const { stapel } = gehe(neuerStapel(), ['liste']);
  assert.equal(zurueckZu(stapel, 5, MIT_PIN), null);
  assert.equal(zurueckZu(stapel, undefined, MIT_PIN), null);
});

test('dieselbe Ansicht noch einmal (z. B. „Erneut versuchen“) ersetzt den Eintrag', () => {
  const { arten, stapel } = gehe(neuerStapel(), ['liste'], ['suche'], ['suche', { suche: 'a' }]);
  assert.equal(arten[2], 'ersetzen');
  assert.equal(stapel.eintraege.length, 2);
});
