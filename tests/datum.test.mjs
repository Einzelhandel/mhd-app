import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leseDatum, zeigeDatum, ueberschriftHeute, geraeteTag, neuerTag } from '../docs/datum.js';

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

test('ueberschriftHeute: Wochentag und Datum des Servers', () => {
  assert.equal(ueberschriftHeute('2026-11-16'), 'Heute, Mo 16.11.');
  assert.equal(ueberschriftHeute('2026-11-17'), 'Heute, Di 17.11.');
  assert.equal(ueberschriftHeute('2026-11-22'), 'Heute, So 22.11.');
  assert.equal(ueberschriftHeute('2027-01-01'), 'Heute, Fr 01.01.');
  assert.equal(ueberschriftHeute('2028-02-29'), 'Heute, Di 29.02.');
});

test('geraeteTag: Datum der Geräteuhr in Europe/Berlin, auch über Mitternacht und Sommerzeit', () => {
  assert.equal(geraeteTag(new Date('2026-11-16T22:59:59Z')), '2026-11-16'); // 23:59:59 Winterzeit
  assert.equal(geraeteTag(new Date('2026-11-16T23:00:00Z')), '2026-11-17'); // 00:00 Winterzeit
  assert.equal(geraeteTag(new Date('2026-07-01T21:59:59Z')), '2026-07-01'); // 23:59:59 Sommerzeit
  assert.equal(geraeteTag(new Date('2026-07-01T22:00:00Z')), '2026-07-02');
  assert.match(geraeteTag(), /^\d{4}-\d{2}-\d{2}$/);
});

test('neuerTag: nur wenn das Gerät seit dem letzten Laden einen anderen Tag hat', () => {
  assert.equal(neuerTag('2026-11-16', '2026-11-16'), false);
  assert.equal(neuerTag('2026-11-16', '2026-11-17'), true);
  assert.equal(neuerTag(null, '2026-11-17'), false); // noch nicht geladen
});
