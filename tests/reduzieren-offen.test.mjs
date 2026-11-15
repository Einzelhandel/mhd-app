// Reduzieren steht offen: Wurde ein Artikel im Reduzier-Zeitraum bearbeitet, aber nicht
// reduziert, steht er an jedem Tag vor dem MHD unter „Heute reduzieren“, bis jemand
// „Reduziert“ tippt. Sonst ginge der Reduzier-Termin verloren, sobald er auf den Tag der
// Aktion fällt oder schon vorbei ist (z. B. beim ersten Scannen).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { umgebung } from './liste-umgebung.mjs';

// Setzt die Regel einer Standard-Warengruppe des Marktes.
const regel = (u, name, pruef, reduzier, hoechst) => u.db.query(
  'update mhd.warengruppen set pruef_vorlauf_tage = $3, reduzier_vorlauf_tage = $4, max_intervall_tage = $5 where markt_id = $1 and name = $2',
  [u.m.marktId, name, pruef, reduzier, hoechst]);

test('erstes Scannen im Reduzier-Zeitraum: sofort „Heute reduzieren“, bis reduziert ist', async () => {
  const { tag, aktion, wo, neu } = await umgebung();
  const a = await neu('Wasser', { gruppeName: 'Getränke' });      // 30/14/60
  await tag('2026-11-15');
  const antwort = await aktion(a, 'geprueft', '2026-11-29');        // Reduzier-Termin wäre heute
  assert.equal(antwort.abschnitt, 'reduzieren');                    // schon die Antwort der Aktion sagt es
  assert.deepEqual(await wo(a), ['reduzieren', null]);
  await tag('2026-11-16'); assert.deepEqual(await wo(a), ['reduzieren', null]);   // gelb, nicht „versäumt“
  await tag('2026-11-20'); assert.deepEqual(await wo(a), ['reduzieren', null]);
  await aktion(a, 'reduziert'); assert.deepEqual(await wo(a), [null, null]);
  await tag('2026-11-28'); assert.deepEqual(await wo(a), [null, null]);
  await tag('2026-11-29'); assert.deepEqual(await wo(a), ['laeuft_ab', null]);
});

test('Reduzier-Termin liegt beim Scannen schon zurück: ebenfalls sofort „Heute reduzieren“', async () => {
  const { tag, aktion, wo, neu } = await umgebung();
  const a = await neu('Chips', { gruppeName: 'Trockensortiment' }); // 14/7/30
  await tag('2026-11-15'); await aktion(a, 'geprueft', '2026-11-18');   // Reduzieren wäre am 11.11. gewesen
  assert.deepEqual(await wo(a), ['reduzieren', null]);
});

test('vor dem Reduzier-Zeitraum geprüft: heute nichts, der Termin kommt wie bisher', async () => {
  const { tag, aktion, wo, neu } = await umgebung();
  const a = await neu('Saft', { gruppeName: 'Getränke' });
  await tag('2026-11-15'); await aktion(a, 'geprueft', '2026-11-30');   // Reduzieren am 16.11.
  assert.deepEqual(await wo(a), [null, null]);
  await tag('2026-11-16'); assert.deepEqual(await wo(a), ['reduzieren', null]);
  await tag('2026-11-17'); assert.deepEqual(await wo(a), ['abgelaufen', 'reduzieren']);   // versäumt wie bisher
  await aktion(a, 'geprueft', '2026-11-30');                            // nur nachgesehen, nicht reduziert
  assert.deepEqual(await wo(a), ['reduzieren', null]);                  // bleibt offen statt zu verschwinden
});

test('am Reduzier-Tag „Geprüft“ statt „Reduziert“: bleibt unter „Heute reduzieren“', async () => {
  const { tag, aktion, wo, neu } = await umgebung();
  const a = await neu('Joghurt');                                    // Molkerei 3/2/30
  await tag('2026-11-10'); await aktion(a, 'geprueft', '2026-11-20');
  await tag('2026-11-17'); await aktion(a, 'geprueft', '2026-11-20');   // Prüftermin erledigt
  await tag('2026-11-18'); assert.deepEqual(await wo(a), ['reduzieren', null]);
  await aktion(a, 'geprueft', '2026-11-20');                            // nur nachgesehen
  assert.deepEqual(await wo(a), ['reduzieren', null]);
  await tag('2026-11-19'); assert.deepEqual(await wo(a), ['reduzieren', null]);
  await tag('2026-11-20'); assert.deepEqual(await wo(a), ['laeuft_ab', null]);          // am MHD-Tag zählt der Ablauf
  await tag('2026-11-21'); assert.deepEqual(await wo(a), ['abgelaufen', 'abgelaufen']);
});

test('schon reduziert und MHD unverändert: „Geprüft“ bringt den Artikel nicht zurück', async () => {
  const { tag, aktion, wo, neu } = await umgebung();
  const a = await neu('Quark');
  await tag('2026-11-18'); await aktion(a, 'geprueft', '2026-11-20');
  assert.deepEqual(await wo(a), ['reduzieren', null]);
  await aktion(a, 'reduziert'); assert.deepEqual(await wo(a), [null, null]);
  await tag('2026-11-19'); await aktion(a, 'geprueft', '2026-11-20');
  assert.deepEqual(await wo(a), [null, null]);
});

test('frischere Ware vorn (anderes MHD) im Reduzier-Zeitraum: wieder „Heute reduzieren“', async () => {
  const { tag, aktion, wo, neu } = await umgebung();
  const a = await neu('Butter');
  await tag('2026-11-18'); await aktion(a, 'geprueft', '2026-11-20'); await aktion(a, 'reduziert');
  await aktion(a, 'geprueft', '2026-11-19');                            // andere Ware, noch nicht reduziert
  assert.deepEqual(await wo(a), ['reduzieren', null]);
});

test('„Aussortiert“ mit neuem MHD und „Wieder da“ im Reduzier-Zeitraum: „Heute reduzieren“', async () => {
  const { tag, aktion, wo, neu } = await umgebung();
  const a = await neu('Sahne');
  await tag('2026-11-10'); await aktion(a, 'geprueft', '2026-11-11');
  await tag('2026-11-11'); await aktion(a, 'aussortiert', '2026-11-13');
  assert.deepEqual(await wo(a), ['reduzieren', null]);
  await aktion(a, 'aussortiert');                                       // kein Bestand mehr
  assert.deepEqual(await wo(a), [null, null]);
  await tag('2026-11-12'); await aktion(a, 'geprueft', '2026-11-13');   // wieder da
  assert.deepEqual(await wo(a), ['reduzieren', null]);
});

test('Reduzieren mit 0 Tagen: nichts steht offen', async () => {
  const u = await umgebung();
  await regel(u, 'Molkerei', 3, 0, 30);
  const a = await u.neu('Milch');
  await u.tag('2026-11-18'); await u.aktion(a, 'geprueft', '2026-11-19');
  assert.deepEqual(await u.wo(a), [null, null]);
  await u.tag('2026-11-19'); assert.deepEqual(await u.wo(a), ['laeuft_ab', null]);
});

test('offenes Reduzieren und Höchstabstand: am Prüftag gewinnt Reduzieren, danach „Prüfen versäumt“', async () => {
  const u = await umgebung();
  await regel(u, 'Molkerei', 10, 5, 2);
  const a = await u.neu('Kefir');
  await u.tag('2026-11-10'); await u.aktion(a, 'geprueft', '2026-11-14');   // im Reduzier-Zeitraum seit 09.11.
  assert.deepEqual(await u.wo(a), ['reduzieren', null]);
  await u.tag('2026-11-12'); assert.deepEqual(await u.wo(a), ['reduzieren', null]);       // Prüfen wäre heute (10.11. + 2)
  await u.tag('2026-11-13'); assert.deepEqual(await u.wo(a), ['abgelaufen', 'pruefen']);  // rot geht vor
  await u.aktion(a, 'reduziert'); assert.deepEqual(await u.wo(a), [null, null]);
});

test('ohne Bestand oder ruhend: nichts steht offen', async () => {
  const { tag, aktion, wo, neu } = await umgebung();
  const a = await neu('Schmand');
  await tag('2026-11-18'); await aktion(a, 'geprueft', '2026-11-20');
  await aktion(a, 'aussortiert'); assert.deepEqual(await wo(a), [null, null]);
  await aktion(a, 'ruht'); assert.deepEqual(await wo(a), [null, null]);
});
