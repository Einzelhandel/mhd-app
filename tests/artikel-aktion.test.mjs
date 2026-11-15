// Welche Aufrufe gehören zu „Geprüft“ und „Reduziert“, je nach Eingabe im MHD-Feld (reine Logik).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { schritte, panelArt, nachAktion, DATUM_FEHLER } from '../docs/artikel-aktion.js';

const HEUTE = '2026-11-14';
const artikel = { id: 1, bestand: true, mhd: '2026-11-20' };

test('Geprüft: gültiges Datum → ein Aufruf mit diesem MHD', () => {
  assert.deepEqual(schritte('geprueft', '211126', artikel, HEUTE), [{ art: 'geprueft', mhd: '2026-11-21' }]);
  assert.deepEqual(schritte('geprueft', '20.11.26', artikel, HEUTE), [{ art: 'geprueft', mhd: '2026-11-20' }]);
});

test('Geprüft: ungültiges oder leeres Datum → Fehler, kein Aufruf', () => {
  assert.deepEqual(schritte('geprueft', '31.02.26', artikel, HEUTE), { fehler: DATUM_FEHLER });
  assert.deepEqual(schritte('geprueft', '', artikel, HEUTE), { fehler: DATUM_FEHLER });
});

test('Reduziert mit unverändertem MHD: nur reduziert', () => {
  assert.deepEqual(schritte('reduziert', '20.11.26', artikel, HEUTE), [{ art: 'reduziert' }]);
  assert.deepEqual(schritte('reduziert', '201126', artikel, HEUTE), [{ art: 'reduziert' }]);
  assert.deepEqual(schritte('reduziert', '20.11.', artikel, HEUTE), [{ art: 'reduziert' }]);
});

test('Reduziert mit geändertem MHD: erst geprueft mit dem neuen MHD, dann reduziert', () => {
  assert.deepEqual(schritte('reduziert', '22.11.26', artikel, HEUTE), [
    { art: 'geprueft', mhd: '2026-11-22' },
    { art: 'reduziert' },
  ]);
});

test('Reduziert mit ungültigem Datum: Fehler, nichts wird gesendet', () => {
  assert.deepEqual(schritte('reduziert', '99.99.99', artikel, HEUTE), { fehler: DATUM_FEHLER });
  assert.deepEqual(schritte('reduziert', 'morgen', artikel, HEUTE), { fehler: DATUM_FEHLER });
  assert.deepEqual(schritte('reduziert', '   ', artikel, HEUTE), { fehler: DATUM_FEHLER });
});

test('Fehler und Schrittliste lassen sich unterscheiden', () => {
  assert.ok(Array.isArray(schritte('reduziert', '20.11.26', artikel, HEUTE)));
  assert.equal(Array.isArray(schritte('reduziert', 'x', artikel, HEUTE)), false);
});

test('panelArt: neu angelegt nur „neu“, sonst nach Bestand und Sortiment', () => {
  assert.equal(panelArt({ bestand: false, aktiv: true }, true), 'neu');
  assert.equal(panelArt({ bestand: false, aktiv: true }, false), 'ohne_bestand');
  assert.equal(panelArt({ bestand: false, aktiv: true }), 'ohne_bestand');
  assert.equal(panelArt({ bestand: false, aktiv: false }, true), 'ohne_bestand');
  assert.equal(panelArt({ bestand: true, aktiv: true }, true), 'bestand');
  assert.equal(panelArt({ bestand: true, aktiv: false }), 'ohne_bestand');
});

test('panelArt: MHD noch nie gespeichert („mhd_fehlt“) ist „neu“, auch ohne Merker (z. B. aus der Liste geöffnet)', () => {
  assert.equal(panelArt({ bestand: false, aktiv: true, versaeumt: 'mhd_fehlt' }), 'neu');
  assert.equal(panelArt({ bestand: false, aktiv: true, versaeumt: 'mhd_fehlt' }, false), 'neu');
  assert.equal(panelArt({ bestand: false, aktiv: true, versaeumt: null }), 'ohne_bestand');
  assert.equal(panelArt({ bestand: false, aktiv: false, versaeumt: 'mhd_fehlt' }), 'ohne_bestand');
  assert.equal(panelArt({ bestand: true, aktiv: true, versaeumt: 'abgelaufen' }), 'bestand');
});

test('nachAktion: wer vom Scanner kam, scannt weiter; sonst zurück zur Liste', () => {
  assert.deepEqual(nachAktion({ artikel: { id: 1 }, vonScan: true }, { id: 1, ean: '4000000000006' }),
    { ansicht: 'scan', daten: { eben: '4000000000006', ersetzen: true } });
  assert.deepEqual(nachAktion({ artikel: { id: 1 } }, { id: 1, ean: '4000000000006' }), { ansicht: 'liste' });
  assert.deepEqual(nachAktion({ artikel: { id: 1 }, zurueck: { ansicht: 'suche' } }, { id: 1, ean: null }), { ansicht: 'liste' });
  assert.deepEqual(nachAktion(undefined, { id: 1 }), { ansicht: 'liste' });
});
