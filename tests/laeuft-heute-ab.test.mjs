// Läuft heute ab: Am Tag des MHD steht ein Artikel mit Bestand unter „Läuft heute ab“, bis die
// Ware aussortiert ist oder vorn ein anderes MHD steht. Sonst verschwände er nach jeder Aktion
// am MHD-Tag von der Liste (z. B. beim ersten Scannen) und stünde erst am Folgetag rot da.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { umgebung } from './liste-umgebung.mjs';

test('erstes Scannen mit MHD von heute: sofort „Läuft heute ab“, bis aussortiert ist', async () => {
  const { tag, aktion, wo, neu } = await umgebung();
  const a = await neu('Joghurt');                                    // Molkerei 3/2/30
  await tag('2026-11-15');
  const antwort = await aktion(a, 'geprueft', '2026-11-15');
  assert.equal(antwort.abschnitt, 'laeuft_ab');                      // schon die Antwort der Aktion sagt es
  assert.equal(antwort.versaeumt, null);
  assert.deepEqual(await wo(a), ['laeuft_ab', null]);
  await aktion(a, 'aussortiert');                                    // kein Bestand mehr
  assert.deepEqual(await wo(a), [null, null]);
});

test('am MHD-Tag gescannt und nicht aussortiert: am Folgetag rot wie bisher', async () => {
  const { tag, aktion, wo, neu } = await umgebung();
  const a = await neu('Quark');
  await tag('2026-11-15'); await aktion(a, 'geprueft', '2026-11-15');
  await tag('2026-11-16'); assert.deepEqual(await wo(a), ['abgelaufen', 'abgelaufen']);
});

test('unter „Läuft heute ab“ nur „Geprüft“ getippt: bleibt stehen', async () => {
  const { tag, aktion, wo, neu } = await umgebung();
  const a = await neu('Butter');
  await tag('2026-11-10'); await aktion(a, 'geprueft', '2026-11-25');
  await tag('2026-11-22'); await aktion(a, 'geprueft', '2026-11-25');   // Prüftermin erledigt
  await tag('2026-11-23'); await aktion(a, 'reduziert');                // Reduzier-Termin erledigt
  await tag('2026-11-25'); assert.deepEqual(await wo(a), ['laeuft_ab', null]);
  await aktion(a, 'geprueft', '2026-11-25');                            // nur nachgesehen
  assert.deepEqual(await wo(a), ['laeuft_ab', null]);
});

test('am MHD-Tag „Reduziert“ getippt: bleibt unter „Läuft heute ab“', async () => {
  const { tag, aktion, wo, neu } = await umgebung();
  const a = await neu('Sahne');
  await tag('2026-11-15'); await aktion(a, 'geprueft', '2026-11-15');
  const antwort = await aktion(a, 'reduziert');
  assert.equal(antwort.abschnitt, 'laeuft_ab');
  assert.deepEqual(await wo(a), ['laeuft_ab', null]);
});

test('„Aussortiert“ mit neuem MHD: späteres MHD nimmt den Artikel von der Liste, MHD von heute nicht', async () => {
  const { tag, aktion, wo, neu } = await umgebung();
  const a = await neu('Kefir');
  await tag('2026-11-15'); await aktion(a, 'geprueft', '2026-11-15');
  await aktion(a, 'aussortiert', '2026-11-15');                         // dahinter steht Ware mit demselben MHD
  assert.deepEqual(await wo(a), ['laeuft_ab', null]);
  await aktion(a, 'aussortiert', '2026-11-30');                         // jetzt steht frische Ware vorn
  assert.deepEqual(await wo(a), [null, null]);
});

test('„Wieder da“ mit MHD von heute: „Läuft heute ab“', async () => {
  const { tag, aktion, wo, neu } = await umgebung();
  const a = await neu('Schmand');
  await tag('2026-11-10'); await aktion(a, 'geprueft', '2026-11-20');
  await aktion(a, 'aussortiert');                                       // kein Bestand
  await tag('2026-11-15'); await aktion(a, 'geprueft', '2026-11-15');   // wieder da
  assert.deepEqual(await wo(a), ['laeuft_ab', null]);
});

test('versäumter Termin am MHD-Tag geht vor; nach „Geprüft“ dann „Läuft heute ab“', async () => {
  const { tag, aktion, wo, neu } = await umgebung();
  const a = await neu('Skyr');
  await tag('2026-11-10'); await aktion(a, 'geprueft', '2026-11-20');   // Prüfen am 17.11.
  await tag('2026-11-20'); assert.deepEqual(await wo(a), ['abgelaufen', 'pruefen']);
  await aktion(a, 'geprueft', '2026-11-20');
  assert.deepEqual(await wo(a), ['laeuft_ab', null]);
});

test('ohne Bestand oder ruhend am MHD-Tag: steht nicht unter „Läuft heute ab“', async () => {
  const { tag, aktion, wo, neu } = await umgebung();
  const a = await neu('Milch');
  await tag('2026-11-15'); await aktion(a, 'geprueft', '2026-11-15');
  await aktion(a, 'aussortiert'); assert.deepEqual(await wo(a), [null, null]);
  await aktion(a, 'ruht'); assert.deepEqual(await wo(a), [null, null]);
});

test('MHD von morgen, heute gescannt: heute nicht unter „Läuft heute ab“', async () => {
  const u = await umgebung();
  await u.db.query(
    "update mhd.warengruppen set pruef_vorlauf_tage = 0, reduzier_vorlauf_tage = 0 where markt_id = $1 and name = 'Molkerei'",
    [u.m.marktId]);
  const a = await u.neu('Buttermilch');
  await u.tag('2026-11-15'); await u.aktion(a, 'geprueft', '2026-11-16');
  assert.deepEqual(await u.wo(a), [null, null]);
  await u.tag('2026-11-16'); assert.deepEqual(await u.wo(a), ['laeuft_ab', null]);
});
