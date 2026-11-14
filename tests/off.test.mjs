import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ausOff, holeOff } from '../docs/off.js';

test('ausOff', () => {
  assert.deepEqual(
    ausOff({ status: 1, product: { product_name_de: ' Joghurt mild ', product_name: 'Yogurt', brands: 'Gut & Günstig,Edeka', quantity: '500 g' } }),
    { name: 'Joghurt mild', marke: 'Gut & Günstig', menge: '500 g' });
  assert.equal(ausOff({ status: 1, product: { product_name: 'x'.repeat(500) } }).name.length, 120);
  assert.equal(ausOff({ status: 1, product: { product_name: '<b>Milch</b>' } }).name, '<b>Milch</b>'); // bleibt Text
  assert.equal(ausOff({ status: 0 }), null);
  assert.equal(ausOff({ status: 1, product: { product_name: '  ' } }), null);
  assert.equal(ausOff(null), null);
  assert.equal(ausOff('kaputt'), null);
});

test('ausOff: Marke und Menge höchstens 60 Zeichen', () => {
  const r = ausOff({ status: 1, product: { product_name: 'Milch', brands: ` ${'m'.repeat(100)} , Zweite`, quantity: 'g'.repeat(100) } });
  assert.deepEqual([r.marke.length, r.menge.length], [60, 60]);
  assert.equal(ausOff({ status: 1, product: { product_name: 'Milch', brands: `${'a'.repeat(59)} b` } }).marke, 'a'.repeat(59));
});

test('ausOff: Rückfall auf product_name, Marke und Menge leer', () => {
  assert.deepEqual(ausOff({ status: 1, product: { product_name_de: ' ', product_name: 'Milch', brands: ' ', quantity: ' ' } }),
    { name: 'Milch', marke: null, menge: null });
  assert.equal(ausOff({ status: '1', product: { product_name: 'Milch' } }), null);
});

test('holeOff: Fehler ergeben null', async () => {
  assert.equal(await holeOff('3017620422003', { fetch: () => Promise.reject(new Error('offline')) }), null);
  assert.equal(await holeOff('3017620422003', { fetch: () => new Promise(() => {}), zeitMs: 20 }), null); // hängt → null nach Frist
  assert.equal(await holeOff('3017620422003', { fetch: async () => ({ ok: false, status: 500, json: async () => ({}) }) }), null);
  assert.equal(await holeOff('3017620422003', { fetch: async () => ({ ok: true, json: async () => { throw new Error('kaputt'); } }) }), null);
  assert.equal(await holeOff('3017620422003', { fetch: async () => ({ ok: true, json: async () => ({ status: 0 }) }) }), null);
});

test('holeOff: Aufruf und Ergebnis', async () => {
  let aufruf;
  const antwort = await holeOff('3017620422003', {
    url: 'https://off.test',
    fetch: async (adresse, optionen) => {
      aufruf = { adresse, optionen };
      return { ok: true, json: async () => ({ status: 1, product: { product_name: 'Haselnusscreme' } }) };
    },
  });
  assert.equal(aufruf.adresse, 'https://off.test/api/v2/product/3017620422003?fields=product_name,product_name_de,brands,quantity');
  assert.ok(aufruf.optionen.signal instanceof AbortSignal);
  assert.deepEqual(antwort, { name: 'Haselnusscreme', marke: null, menge: null });
});
