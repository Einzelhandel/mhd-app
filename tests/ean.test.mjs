import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalisiereEan, istWaagencode } from '../docs/ean.js';

test('normalisiereEan', () => {
  assert.equal(normalisiereEan('3017620422003'), '3017620422003');
  assert.equal(normalisiereEan(' 3017620422003\r\n'), '3017620422003'); // Tastatur-Scanner
  assert.equal(normalisiereEan('96385074'), '96385074'); // EAN-8
  assert.equal(normalisiereEan('036000291452'), '0036000291452'); // UPC-A → 13 Stellen
  assert.equal(normalisiereEan('3017620422004'), null); // Prüfziffer falsch
  assert.equal(normalisiereEan('30176204'), null);
  assert.equal(normalisiereEan('12345'), null);
  assert.equal(normalisiereEan(''), null);
  assert.equal(normalisiereEan('30176204220x3'), null);
});

test('istWaagencode', () => {
  assert.equal(istWaagencode('2912345003500'), true);
  assert.equal(istWaagencode('20123451'), true);
  assert.equal(istWaagencode('3017620422003'), false);
});
