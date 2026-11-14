// Artikel und Warengruppen: suchen, Liste, anlegen, ändern.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neueDatenbank, als, json, heuteSetzen, markt, pin } from './helfer.mjs';

// Markt mit Leitung (Sitzung "leitung") und einem gewöhnlichen Mitarbeiter (Sitzung "mitarbeiter").
async function aufbau(db, { name = 'Markt A', email = 'a@example.com' } = {}) {
  const m = await markt(db, { name, email, leitung: 'Chef', pin: '4711' });
  await db.query("insert into mhd.mitarbeiter (markt_id, name, rolle, pin_hash) values ($1, 'Berta', 'mitarbeiter', mhd.pin_hash('1234'))", [m.marktId]);
  const b = await db.query("select id from mhd.mitarbeiter where markt_id = $1 and name = 'Berta'", [m.marktId]);
  return {
    ...m,
    leitung: await pin(db, m.userId, m.leitungId, '4711'),
    mitarbeiter: await pin(db, m.userId, Number(b.rows[0].id), '1234'),
  };
}

const speichern = (db, m, sitzung, id, daten) =>
  json(db, m.userId, 'select public.mhd_artikel_speichern($1, $2, $3::jsonb) as r', [sitzung, id, JSON.stringify(daten)]);
const suchen = (db, m, sitzung, ean) =>
  json(db, m.userId, 'select public.mhd_artikel_suchen($1, $2) as r', [sitzung, ean]);
const liste = (db, m, sitzung, suche = '', ohneEan = false) =>
  json(db, m.userId, 'select public.mhd_artikel_liste($1, $2, $3) as r', [sitzung, suche, ohneEan]);
const warengruppen = (db, m, sitzung) =>
  json(db, m.userId, 'select public.mhd_warengruppen($1) as r', [sitzung]);

test('Warengruppen: alle des Marktes nach Name, mit Vorlaufzeiten', async () => {
  const db = await neueDatenbank();
  const m = await aufbau(db);
  const r = await warengruppen(db, m, m.mitarbeiter);
  assert.equal(r.length, 11);
  assert.deepEqual(Object.keys(r[0]).sort(), ['id', 'max_intervall_tage', 'name', 'pruef_vorlauf_tage', 'reduzier_vorlauf_tage']);
  const namen = r.map((g) => g.name);
  assert.deepEqual(namen, [...namen].sort((a, b) => a.localeCompare(b, 'de')));
  assert.equal(r.find((g) => g.name === 'Molkerei').pruef_vorlauf_tage, 3);
  await assert.rejects(warengruppen(db, m, '00000000-0000-0000-0000-000000000000'), /PIN_ABGELAUFEN/);
  await assert.rejects(als(db, 'anon', null, 'select public.mhd_warengruppen($1)', [m.mitarbeiter]), /permission denied/);
});

test('neuer Artikel mit EAN: jeder Mitarbeiter; erscheint in suchen und liste', async () => {
  const db = await neueDatenbank();
  await heuteSetzen(db, '2026-11-14');
  const m = await aufbau(db);
  const gid = (await warengruppen(db, m, m.mitarbeiter)).find((g) => g.name === 'Molkerei').id;
  const a = await speichern(db, m, m.mitarbeiter, null, {
    ean: ' 4012345678901 ', name: '  Vollmilch  ', marke: 'Hofmilch', menge: '1 l', platz: '', warengruppe_id: gid, quelle: 'off' });
  assert.equal(a.ean, '4012345678901');
  assert.equal(a.name, 'Vollmilch');
  assert.equal(a.marke, 'Hofmilch');
  assert.equal(a.platz, null);
  assert.equal(a.warengruppe_id, gid);
  assert.equal(a.warengruppe, 'Molkerei');
  assert.equal(a.bestand, false);
  assert.equal(a.mhd, null);
  assert.equal(a.reduziert, false);
  assert.equal(a.aktiv, true);
  // Noch nie ein MHD gespeichert: steht sofort in der Liste, damit ungeprüfte Ware nicht unsichtbar bleibt.
  assert.deepEqual([a.abschnitt, a.versaeumt, a.seit_tagen], ['ohne_bestand', 'mhd_fehlt', 0]);
  assert.deepEqual(Object.keys(a).sort(), ['abschnitt', 'aktiv', 'bestand', 'ean', 'id', 'marke', 'menge', 'mhd', 'name', 'platz', 'reduziert', 'seit_tagen', 'versaeumt', 'warengruppe', 'warengruppe_id']);
  const zeile = (await db.query('select quelle, ohne_bestand_seit::text as seit from mhd.artikel where id = $1', [a.id])).rows[0];
  assert.equal(zeile.quelle, 'off');
  assert.equal(zeile.seit, '2026-11-14');
  assert.deepEqual(await suchen(db, m, m.mitarbeiter, '4012345678901'), a);
  assert.equal(await suchen(db, m, m.mitarbeiter, '4099999999999'), null);
  assert.deepEqual((await liste(db, m, m.mitarbeiter)).map((x) => x.id), [a.id]);
  // quelle fehlt: 'hand'
  const b = await speichern(db, m, m.mitarbeiter, null, { ean: '40123456', name: 'Quark' });
  assert.equal((await db.query('select quelle from mhd.artikel where id = $1', [b.id])).rows[0].quelle, 'hand');
  await assert.rejects(speichern(db, m, m.mitarbeiter, null, { ean: '40123457', name: 'X', quelle: 'foo' }), /QUELLE_UNGUELTIG/);
});

test('gleiche EAN zweimal im Markt: ARTIKEL_VORHANDEN; in einem anderen Markt erlaubt', async () => {
  const db = await neueDatenbank();
  const a = await aufbau(db);
  const b = await aufbau(db, { name: 'Markt B', email: 'b@example.com' });
  await speichern(db, a, a.mitarbeiter, null, { ean: '4012345678901', name: 'Vollmilch' });
  await assert.rejects(speichern(db, a, a.mitarbeiter, null, { ean: '4012345678901', name: 'Nochmal' }), /ARTIKEL_VORHANDEN/);
  const x = await speichern(db, b, b.mitarbeiter, null, { ean: '4012345678901', name: 'Vollmilch B' });
  assert.equal(x.ean, '4012345678901');
});

test('EAN ungültig: "123", "40123456789012" (14), "abc" → EAN_UNGUELTIG', async () => {
  const db = await neueDatenbank();
  const m = await aufbau(db);
  for (const ean of ['123', '40123456789012', 'abc']) {
    await assert.rejects(speichern(db, m, m.mitarbeiter, null, { ean, name: 'X' }), /EAN_UNGUELTIG/, ean);
  }
});

test('Waagen-Code: 13-stellig mit 2 vorn und 8-stellig mit 2 vorn → WAAGENCODE', async () => {
  const db = await neueDatenbank();
  const m = await aufbau(db);
  for (const ean of ['2012345678901', '20123456']) {
    await assert.rejects(speichern(db, m, m.mitarbeiter, null, { ean, name: 'X' }), /WAAGENCODE/, ean);
  }
});

test('Artikel ohne EAN anlegen und vorhandene ändern: nur Leitung (NUR_LEITUNG)', async () => {
  const db = await neueDatenbank();
  const m = await aufbau(db);
  await assert.rejects(speichern(db, m, m.mitarbeiter, null, { name: 'Hackfleisch' }), /NUR_LEITUNG/);
  await assert.rejects(speichern(db, m, m.mitarbeiter, null, { ean: '', name: 'Hackfleisch' }), /NUR_LEITUNG/);
  const a = await speichern(db, m, m.leitung, null, { name: 'Hackfleisch', platz: 'Theke' });
  assert.equal(a.ean, null);
  assert.equal(a.platz, 'Theke');
  await assert.rejects(speichern(db, m, m.mitarbeiter, a.id, { name: 'Hack neu' }), /NUR_LEITUNG/);
  const e = await speichern(db, m, m.mitarbeiter, null, { ean: '4012345678901', name: 'Vollmilch' });
  await assert.rejects(speichern(db, m, m.mitarbeiter, e.id, { name: 'Milch' }), /NUR_LEITUNG/);
  const g = await speichern(db, m, m.leitung, e.id, { ean: '40999999', name: 'Milch', marke: 'M' });
  assert.equal(g.name, 'Milch');
  assert.equal(g.marke, 'M');
  assert.equal(g.ean, '4012345678901', 'EAN bleibt beim Ändern unverändert');
  await assert.rejects(speichern(db, m, m.leitung, 999999, { name: 'X' }), /ARTIKEL_UNBEKANNT/);
});

test('Name leer → NAME_FEHLT; Name 300 Zeichen wird auf 120 gekürzt; Warengruppe fremder Markt → WARENGRUPPE_UNBEKANNT', async () => {
  const db = await neueDatenbank();
  const a = await aufbau(db);
  const b = await aufbau(db, { name: 'Markt B', email: 'b@example.com' });
  for (const name of ['', '   ', null]) {
    await assert.rejects(speichern(db, a, a.mitarbeiter, null, { ean: '4012345678901', name }), /NAME_FEHLT/);
  }
  const lang = await speichern(db, a, a.mitarbeiter, null, { ean: '4012345678901', name: 'x'.repeat(300) });
  assert.equal(lang.name.length, 120);
  const fremd = (await db.query('select id from mhd.warengruppen where markt_id = $1 limit 1', [b.marktId])).rows[0].id;
  await assert.rejects(speichern(db, a, a.mitarbeiter, null, { ean: '40123456', name: 'X', warengruppe_id: Number(fremd) }), /WARENGRUPPE_UNBEKANNT/);
});

test('suchen/liste zeigen keine Artikel eines anderen Marktes', async () => {
  const db = await neueDatenbank();
  const a = await aufbau(db);
  const b = await aufbau(db, { name: 'Markt B', email: 'b@example.com' });
  const x = await speichern(db, b, b.mitarbeiter, null, { ean: '4012345678901', name: 'Vollmilch' });
  assert.equal(await suchen(db, a, a.mitarbeiter, '4012345678901'), null);
  assert.deepEqual(await liste(db, a, a.mitarbeiter), []);
  await assert.rejects(speichern(db, a, a.leitung, x.id, { name: 'Gekapert' }), /ARTIKEL_UNBEKANNT/);
});

test('liste: p_ohne_ean = true liefert nur Artikel ohne EAN; Suche "hack" findet "Hackfleisch gemischt"', async () => {
  const db = await neueDatenbank();
  const m = await aufbau(db);
  await speichern(db, m, m.leitung, null, { name: 'Hackfleisch gemischt' });
  await speichern(db, m, m.leitung, null, { name: 'Aufschnitt' });
  await speichern(db, m, m.leitung, null, { ean: '4012345678901', name: 'Vollmilch', marke: 'Hofmilch' });
  const namen = async (...args) => (await liste(db, m, m.mitarbeiter, ...args)).map((x) => x.name);
  assert.deepEqual(await namen('', true), ['Aufschnitt', 'Hackfleisch gemischt']);
  assert.deepEqual(await namen('hack'), ['Hackfleisch gemischt']);
  assert.deepEqual(await namen('HOFMILCH'), ['Vollmilch']);
  assert.deepEqual(await namen('40123'), ['Vollmilch']);
  assert.deepEqual(await namen('hack', true), ['Hackfleisch gemischt']);
  assert.deepEqual(await namen('%'), [], 'Platzhalter wirken nicht');
});

test('liste: höchstens 50 Artikel', async () => {
  const db = await neueDatenbank();
  const m = await aufbau(db);
  await db.query("insert into mhd.artikel (markt_id, name, quelle, ohne_bestand_seit) select $1, 'Artikel ' || g, 'hand', '2026-11-10' from generate_series(1, 60) g", [m.marktId]);
  assert.equal((await liste(db, m, m.mitarbeiter)).length, 50);
});
