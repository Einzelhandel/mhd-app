// Marktleitung: Regeln prüfen, PIN prüfen, Protokollzeilen darstellen, Zeitraum lesen (reine Logik).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pruefeRegel, pruefePin, protokollZeile, zeitText, standardZeitraum, leseZeitraum, AKTIONSNAMEN } from '../docs/leitung-logik.js';

test('Regel: gültige Zahlen werden zu Zahlen', () => {
  assert.deepEqual(pruefeRegel({ pruef: '3', reduzier: '2', max: '30' }), { werte: { pruef_vorlauf_tage: 3, reduzier_vorlauf_tage: 2, max_intervall_tage: 30 } });
  assert.deepEqual(pruefeRegel({ pruef: ' 7 ', reduzier: '7', max: '1' }).werte, { pruef_vorlauf_tage: 7, reduzier_vorlauf_tage: 7, max_intervall_tage: 1 });
  assert.deepEqual(pruefeRegel({ pruef: '0', reduzier: '0', max: '5' }).werte, { pruef_vorlauf_tage: 0, reduzier_vorlauf_tage: 0, max_intervall_tage: 5 });
});

test('Regel: keine ganzen Zahlen → Fehler mit Feld', () => {
  for (const schlecht of ['', 'abc', '2,5', '2.5', '-1', '1e1']) {
    const r = pruefeRegel({ pruef: schlecht, reduzier: '2', max: '30' });
    assert.equal(r.feld, 'pruef', schlecht);
    assert.match(r.fehler, /ganze Zahl/);
  }
  assert.equal(pruefeRegel({ pruef: '3', reduzier: 'x', max: '30' }).feld, 'reduzier');
  assert.equal(pruefeRegel({ pruef: '3', reduzier: '2', max: '' }).feld, 'max');
});

test('Regel: Reduzieren darf nicht früher kommen als Prüfen; Höchstabstand mindestens 1', () => {
  const r = pruefeRegel({ pruef: '3', reduzier: '5', max: '30' });
  assert.equal(r.feld, 'reduzier');
  assert.match(r.fehler, /Reduzieren darf nicht/);
  const m = pruefeRegel({ pruef: '3', reduzier: '2', max: '0' });
  assert.equal(m.feld, 'max');
  assert.match(m.fehler, /mindestens 1/);
});

test('PIN: 4 bis 6 Ziffern', () => {
  assert.equal(pruefePin('1234'), null);
  assert.equal(pruefePin('123456'), null);
  for (const schlecht of ['', '123', '1234567', '12a4', '12 34']) assert.match(pruefePin(schlecht), /4 bis 6 Ziffern/, schlecht);
});

test('Protokollzeile: deutsche Aktionsnamen und MHD alt → neu', () => {
  assert.deepEqual(Object.keys(AKTIONSNAMEN).sort(), ['aussortiert', 'geprueft', 'ohne_bestand', 'reduziert', 'ruht']);
  const z = protokollZeile({ zeitpunkt: '2026-11-14T08:05:00+00:00', mitarbeiter: 'Anna', artikel: 'Vollmilch', art: 'geprueft', mhd_alt: '2026-11-20', mhd_neu: '2026-11-25' });
  assert.deepEqual(z, { zeit: '14.11. 09:05', mitarbeiter: 'Anna', artikel: 'Vollmilch', aktion: 'Geprüft', mhd: '20.11.26 → 25.11.26' });
  assert.equal(protokollZeile({ art: 'reduziert', zeitpunkt: '2026-11-14T08:05:00Z', mhd_alt: '2026-11-20', mhd_neu: '2026-11-20' }).aktion, 'Reduziert');
  assert.equal(protokollZeile({ art: 'aussortiert', zeitpunkt: '2026-11-14T08:05:00Z', mhd_alt: '2026-11-20', mhd_neu: null }).mhd, '20.11.26 → –');
  assert.equal(protokollZeile({ art: 'ohne_bestand', zeitpunkt: '2026-11-14T08:05:00Z' }).aktion, 'Ohne Bestand');
  assert.equal(protokollZeile({ art: 'ruht', zeitpunkt: '2026-11-14T08:05:00Z' }).aktion, 'Aus dem Sortiment genommen');
});

test('Protokollzeile: fehlende Namen und unbekannte Aktion', () => {
  const z = protokollZeile({ zeitpunkt: '2026-11-14T08:05:00Z', mitarbeiter: null, artikel: null, art: 'neu', mhd_alt: null, mhd_neu: null });
  assert.equal(z.mitarbeiter, '–');
  assert.equal(z.artikel, '–');
  assert.equal(z.aktion, 'neu');
  assert.equal(z.mhd, '–');
});

test('Zeit: deutsche Ortszeit, Sommer- und Winterzeit', () => {
  assert.equal(zeitText('2026-07-01T10:30:00Z'), '01.07. 12:30');
  assert.equal(zeitText('2026-12-31T23:30:00Z'), '01.01. 00:30');
});

test('Zeitraum: Standard sind die letzten 7 Tage einschließlich heute', () => {
  assert.deepEqual(standardZeitraum('2026-11-14'), { von: '2026-11-08', bis: '2026-11-14' });
  assert.deepEqual(standardZeitraum('2026-03-03'), { von: '2026-02-25', bis: '2026-03-03' });
});

test('Zeitraum lesen: Datumsformate wie beim MHD, von nicht nach bis', () => {
  assert.deepEqual(leseZeitraum('08.11.26', '14.11.', '2026-11-14'), { von: '2026-11-08', bis: '2026-11-14' });
  assert.match(leseZeitraum('x', '14.11.26', '2026-11-14').fehler, /Von/);
  assert.match(leseZeitraum('08.11.26', '31.02.26', '2026-11-14').fehler, /Bis/);
  assert.match(leseZeitraum('15.11.26', '14.11.26', '2026-11-14').fehler, /nach/);
  assert.deepEqual(leseZeitraum('14.11.26', '14.11.26', '2026-11-14'), { von: '2026-11-14', bis: '2026-11-14' });
});
