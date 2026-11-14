// Terminlogik: nächster Termin eines Artikels (prüfen, reduzieren, läuft heute ab).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neueDatenbank } from './helfer.mjs';

// [mhd, letzte, reduziert, prüf, reduzier, max, erwartet]
const FAELLE = [
  ['2026-11-20', '2026-11-10', false, 3, 2, 30, ['2026-11-17', 'pruefen']],
  ['2026-11-20', '2026-11-17', false, 3, 2, 30, ['2026-11-18', 'reduzieren']],
  ['2026-11-20', '2026-11-18', false, 3, 2, 30, ['2026-11-20', 'laeuft_ab']],
  ['2026-11-20', '2026-11-17', true, 3, 2, 30, ['2026-11-20', 'laeuft_ab']],
  ['2026-11-20', '2026-11-20', false, 3, 2, 30, null],
  ['2026-11-20', '2026-11-25', false, 3, 2, 30, null],
  ['2027-06-01', '2026-11-10', false, 14, 7, 30, ['2026-12-10', 'pruefen']],
  ['2026-11-20', '2026-11-10', false, 2, 2, 30, ['2026-11-18', 'reduzieren']],
  ['2026-11-20', '2026-11-10', false, 0, 0, 30, ['2026-11-20', 'laeuft_ab']],
  ['2026-12-13', '2026-11-10', false, 3, 2, 30, ['2026-12-10', 'pruefen']],
];

test('termin: nächster Termin je Fall', async () => {
  const db = await neueDatenbank();
  for (const [mhd, letzte, reduziert, pruef, reduzier, max, erwartet] of FAELLE) {
    const r = await db.query(
      `select to_char(datum, 'YYYY-MM-DD') as datum, art from mhd.termin($1::date, $2::date, $3, $4, $5, $6)`,
      [mhd, letzte, reduziert, pruef, reduzier, max]);
    const text = `mhd ${mhd}, letzte ${letzte}, reduziert ${reduziert}, ${pruef}/${reduzier}/${max}`;
    if (erwartet === null) assert.equal(r.rows.length, 0, text);
    else {
      assert.equal(r.rows.length, 1, text);
      assert.deepEqual([r.rows[0].datum, r.rows[0].art], erwartet, text);
    }
  }
});
