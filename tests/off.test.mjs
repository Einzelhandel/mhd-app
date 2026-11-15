import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ausOff, holeOff, gruppeAus } from '../docs/off.js';

test('ausOff', () => {
  assert.deepEqual(
    ausOff({ status: 1, product: { product_name_de: ' Joghurt mild ', product_name: 'Yogurt', brands: 'Gut & Günstig,Edeka', quantity: '500 g' } }),
    { name: 'Joghurt mild', marke: 'Gut & Günstig', menge: '500 g', gruppe: null });
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
    { name: 'Milch', marke: null, menge: null, gruppe: null });
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
  assert.equal(aufruf.adresse, 'https://off.test/api/v2/product/3017620422003?fields=product_name,product_name_de,brands,quantity,categories_tags');
  assert.ok(aufruf.optionen.signal instanceof AbortSignal);
  assert.deepEqual(antwort, { name: 'Haselnusscreme', marke: null, menge: null, gruppe: null });
});

// Kategorien echter Einträge aus Open Food Facts (abgerufen am 15.11.2026), gekürzt auf die Tags.
const KATEGORIEN = {
  kefir: 'en:beverages-and-beverages-preparations en:beverages en:dairies en:fermented-foods en:fermented-milk-products en:non-alcoholic-beverages en:dairy-drinks en:kefir',
  butter: 'en:dairies en:fats en:spreads en:spreadable-fats en:animal-fats en:dairy-spreads en:milkfat en:butters',
  haferflocken: 'en:plant-based-foods-and-beverages en:plant-based-foods en:breakfasts en:cereals-and-potatoes en:cereals-and-their-products en:breakfast-cereals en:flakes en:rolled-oats',
  wasser: 'en:beverages-and-beverages-preparations en:beverages en:waters en:carbonated-drinks en:mineral-waters',
  schinken: 'en:meats-and-their-products en:meats en:prepared-meats en:hams en:diced-ham',
  haehnchen: 'en:meats-and-their-products en:prepared-meats en:cooked-charcuterie en:chicken-and-its-products',
  spaghetti: 'en:plant-based-foods-and-beverages en:plant-based-foods en:cereals-and-potatoes en:cereals-and-their-products en:pastas-and-dumplings en:pastas',
};
const tags = (schluessel) => KATEGORIEN[schluessel].split(' ');

test('gruppeAus: Vorschlag für die Warengruppe aus den Kategorien', () => {
  assert.equal(gruppeAus(tags('kefir')), 'Molkerei');               // Molkerei geht vor Getränke
  assert.equal(gruppeAus(tags('butter')), 'Molkerei');
  assert.equal(gruppeAus(['en:fats', 'en:vegetable-fats', 'en:spreadable-fats', 'en:margarines']), 'Molkerei');   // steht im Kühlregal
  assert.equal(gruppeAus(tags('haferflocken')), 'Trockensortiment');
  assert.equal(gruppeAus(tags('wasser')), 'Getränke');
  assert.equal(gruppeAus(tags('schinken')), 'Fleisch und Wurst');
  assert.equal(gruppeAus(tags('haehnchen')), 'Fleisch und Wurst');
  assert.equal(gruppeAus(tags('spaghetti')), 'Trockensortiment');
});

test('gruppeAus: Tiefkühl und Konserven gehen vor, weil sie die Lagerung bestimmen', () => {
  assert.equal(gruppeAus(['en:meals', 'en:pizzas-pies-and-quiches', 'en:pizzas', 'en:frozen-foods', 'en:frozen-pizzas']), 'Tiefkühl');
  assert.equal(gruppeAus(['en:dairies', 'en:desserts', 'en:frozen-foods', 'en:frozen-desserts', 'en:ice-creams-and-sorbets']), 'Tiefkühl');
  assert.equal(gruppeAus(['en:meats-and-their-products', 'en:canned-foods', 'en:canned-meats', 'en:sausages']), 'Konserven');
  assert.equal(gruppeAus(['en:seafood', 'en:fishes', 'en:canned-foods', 'en:canned-fishes']), 'Konserven');
});

test('gruppeAus: Backwaren, Süßwaren, Feinkost', () => {
  assert.equal(gruppeAus(['en:plant-based-foods', 'en:cereals-and-potatoes', 'en:breads', 'en:sliced-breads']), 'Backwaren');
  assert.equal(gruppeAus(['en:snacks', 'en:sweet-snacks', 'en:cocoa-and-its-products', 'en:chocolates']), 'Süßwaren');
  assert.equal(gruppeAus(['en:snacks', 'en:sweet-snacks', 'en:biscuits-and-cakes', 'en:biscuits']), 'Süßwaren');
  assert.equal(gruppeAus(['en:meals', 'en:salads', 'en:prepared-salads', 'en:potato-salads']), 'Feinkost und Salate');
  assert.equal(gruppeAus(['en:snacks', 'en:salty-snacks', 'en:appetizers', 'en:chips-and-fries', 'en:crisps']), 'Trockensortiment');
});

test('gruppeAus: nichts Passendes oder kaputte Daten ergeben keinen Vorschlag', () => {
  assert.equal(gruppeAus(['en:eggs', 'en:farming-products']), null);
  assert.equal(gruppeAus([]), null);
  assert.equal(gruppeAus(null), null);
  assert.equal(gruppeAus('en:dairies'), null);                       // kein Feld
  assert.equal(gruppeAus([42, null, { a: 1 }]), null);
  assert.equal(gruppeAus(['EN:DAIRIES ']), 'Molkerei');              // Groß- und Kleinschreibung, Leerzeichen
});

test('ausOff: liefert den Vorschlag für die Warengruppe mit', () => {
  const r = ausOff({ status: 1, product: { product_name: 'Kefir', categories_tags: tags('kefir') } });
  assert.deepEqual(r, { name: 'Kefir', marke: null, menge: null, gruppe: 'Molkerei' });
});
