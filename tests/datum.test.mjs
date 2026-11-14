import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leseDatum, zeigeDatum } from '../docs/datum.js';

const HEUTE = '2026-11-16';

test('leseDatum: gültige und ungültige Eingaben', () => {
  for (const [ein, aus] of [
    ['20.11.26', '2026-11-20'], ['201126', '2026-11-20'], ['20.11.2026', '2026-11-20'],
    ['1.3.27', '2027-03-01'], ['20.11.', '2026-11-20'], ['2011', '2026-11-20'],
    ['05.01.', '2027-01-05'], // ohne Jahr: nächstes Vorkommen …
    ['10.11.', '2026-11-10'], // … außer höchstens 30 Tage zurück (abgelaufene Ware erfassen)
    ['31.02.27', null], ['00.11.26', null], ['20.13.26', null], ['', null], ['abc', null], ['20.11.26x', null],
  ]) assert.equal(leseDatum(ein, HEUTE), aus, `Eingabe „${ein}“`);
});

test('leseDatum: Ergänzungen', () => {
  assert.equal(leseDatum('  20.11.26 \n', HEUTE), '2026-11-20');
  assert.equal(leseDatum('20.11', HEUTE), '2026-11-20');
  assert.equal(leseDatum('17.10.', HEUTE), '2026-10-17'); // genau 30 Tage zurück: noch dieses Jahr
  assert.equal(leseDatum('16.10.', HEUTE), '2027-10-16'); // 31 Tage zurück: nächstes Jahr
  assert.equal(leseDatum('29.02.28', HEUTE), '2028-02-29');
  assert.equal(leseDatum('29.02.27', HEUTE), null);
});

test('zeigeDatum', () => {
  assert.equal(zeigeDatum('2026-11-20'), '20.11.26');
});
