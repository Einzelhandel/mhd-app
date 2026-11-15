// Was nach einem Scan (oder eingetippter Nummer) geschieht: reine Entscheidung ohne Kamera und DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nachScan, leserWahl, mitErsatz, gleicherCode } from '../docs/scan.js';

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
  assert.deepEqual(r, { ziel: 'artikel', daten: { artikel: BEKANNT, vonScan: true } });
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

// ---- Wahl des Strichcode-Lesers (reine Logik)

test('leserWahl: BarcodeDetector nur, wenn er EAN-13 kann; sonst die mitgelieferte Bibliothek', () => {
  assert.equal(leserWahl(['ean_13', 'ean_8', 'qr_code']), 'detektor');
  assert.equal(leserWahl(['ean_13']), 'detektor');
  assert.equal(leserWahl(['qr_code', 'ean_8']), 'zxing');
  assert.equal(leserWahl([]), 'zxing');      // z. B. Chrome auf dem Desktop ohne Erkennung
  assert.equal(leserWahl(null), 'zxing');    // kein BarcodeDetector oder getSupportedFormats scheitert
});

test('mitErsatz: nach 5 Fehlern in Folge liest der Ersatz; ein gelungener Versuch setzt den Zähler zurück', async () => {
  let fehler = 0;
  let geholt = 0;
  const erster = async (bild) => { if (bild === 'kaputt') { fehler += 1; throw new Error('detect'); } return bild === 'leer' ? null : 'erster'; };
  const lies = mitErsatz(erster, async () => { geholt += 1; return async () => 'ersatz'; });
  for (let i = 0; i < 4; i++) assert.equal(await lies('kaputt'), null);
  assert.equal(await lies('leer'), null);           // nichts erkannt ist kein Fehler: Zähler wieder 0
  for (let i = 0; i < 4; i++) assert.equal(await lies('kaputt'), null);
  assert.equal(geholt, 0);
  assert.equal(await lies('kaputt'), null);         // der fünfte Fehler in Folge
  assert.equal(geholt, 1);
  assert.equal(await lies('kaputt'), 'ersatz');
  assert.equal(await lies('leer'), 'ersatz');
  assert.equal(geholt, 1);
  assert.equal(fehler, 9);                          // nach dem Umschalten wird der erste Leser nicht mehr gefragt
});

test('mitErsatz: lässt sich der Ersatz nicht laden, scheitert der Leser mit LESER_FEHLT', async () => {
  const lies = mitErsatz(async () => { throw new Error('detect'); }, async () => { throw new Error('ZXING'); });
  for (let i = 0; i < 4; i++) assert.equal(await lies('x'), null);
  await assert.rejects(lies('x'), { message: 'LESER_FEHLT' });
});

test('gleicherCode: der eben bearbeitete Artikel wird von der Kamera nicht gleich wieder geöffnet', () => {
  assert.equal(gleicherCode('4000000000006', '4000000000006'), true);
  assert.equal(gleicherCode('036000291452', '0036000291452'), true);   // UPC-A im Bild, EAN-13 gespeichert
  assert.equal(gleicherCode('4000000000013', '4000000000006'), false);
  assert.equal(gleicherCode('4000000000006', null), false);            // kein Artikel eben bearbeitet
  assert.equal(gleicherCode('4000000000006', undefined), false);
});
