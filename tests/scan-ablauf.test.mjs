// Was nach einem Scan (oder eingetippter Nummer) geschieht: reine Entscheidung ohne Kamera und DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nachScan } from '../docs/scan.js';

const BEKANNT = { id: 7, name: 'Vollmilch', ean: '4000000000006' };

// rpc und off zählen ihre Aufrufe.
function dienste({ artikel = null, vorschlag = null } = {}) {
  const d = { rpc: [], off: [] };
  d.rpc_ = async (funktion, parameter) => { d.rpc.push([funktion, parameter]); return artikel; };
  d.off_ = async (ean) => { d.off.push(ean); return vorschlag; };
  d.dienste = { rpc: d.rpc_, off: d.off_ };
  return d;
}

test('bekannter Artikel: Ansicht Artikel, Open Food Facts wird nicht gefragt', async () => {
  const d = dienste({ artikel: BEKANNT });
  const r = await nachScan('4000000000006', d.dienste);
  assert.deepEqual(r, { ziel: 'artikel', daten: { artikel: BEKANNT } });
  assert.deepEqual(d.rpc, [['mhd_artikel_suchen', { p_ean: '4000000000006' }]]);
  assert.equal(d.off.length, 0);
});

test('unbekannt, Open Food Facts kennt ihn: Neuanlage mit Vorschlag', async () => {
  const vorschlag = { name: 'Vollmilch', marke: 'Hofmilch', menge: '1 l' };
  const d = dienste({ vorschlag });
  const r = await nachScan('4000000000006', d.dienste);
  assert.deepEqual(r, { ziel: 'artikel-neu', daten: { ean: '4000000000006', vorschlag, quelle: 'off' } });
  assert.deepEqual(d.off, ['4000000000006']);
});

test('unbekannt, Open Food Facts kennt ihn nicht: Neuanlage von Hand', async () => {
  const d = dienste({ vorschlag: null });
  const r = await nachScan('4000000000006', d.dienste);
  assert.deepEqual(r, { ziel: 'artikel-neu', daten: { ean: '4000000000006', vorschlag: null, quelle: 'hand' } });
});

test('Waagen-Code: Suche ohne Strichcode mit Hinweis; weder Datenbank noch Open Food Facts', async () => {
  const d = dienste();
  const r = await nachScan('2912345003500', d.dienste);
  assert.deepEqual(r, {
    ziel: 'suche', daten: { ohneEan: true }, meldung: 'Waagen-Etikett: Artikel bitte aus der Liste wählen.',
  });
  assert.equal(d.rpc.length, 0);
  assert.equal(d.off.length, 0);
});

test('Prüfziffer falsch, Buchstaben, zu kurz: Fehler ohne Aufruf', async () => {
  for (const text of ['4000000000007', 'abc', '', '123']) {
    const d = dienste();
    const r = await nachScan(text, d.dienste);
    assert.deepEqual(r, { ziel: 'fehler', meldung: 'Strichcode nicht lesbar. Bitte noch einmal scannen oder Nummer eintippen.' }, text);
    assert.equal(d.rpc.length + d.off.length, 0, text);
  }
});

test('eingetippte Nummer mit Leerzeichen und UPC-A (12 Stellen) werden normalisiert', async () => {
  const d = dienste({ artikel: BEKANNT });
  await nachScan(' 4000 0000 00006 ', d.dienste);
  assert.equal(d.rpc[0][1].p_ean, '4000000000006');
  const e = dienste();
  await nachScan('036000291452', e.dienste); // UPC-A
  assert.equal(e.rpc[0][1].p_ean, '0036000291452');
});

test('ein Fehler der Datenbank wird weitergereicht (kein Aufruf von Open Food Facts)', async () => {
  const d = dienste();
  await assert.rejects(nachScan('4000000000006', {
    rpc: async () => { throw new Error('PIN_ABGELAUFEN'); },
    off: d.off_,
  }), /PIN_ABGELAUFEN/);
  assert.equal(d.off.length, 0);
});
