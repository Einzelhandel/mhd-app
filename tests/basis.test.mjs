// Grundlagen: Schema, Rechte, Markt anlegen, Regeln der Tabellen, Testuhr.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCHEMA, neueDatenbank, als, heuteSetzen, jetztSetzen, markt } from './helfer.mjs';

const TABELLEN = ['maerkte', 'markt_konten', 'mitarbeiter', 'sitzungen', 'warengruppen', 'artikel', 'protokoll'];

test('Schema lädt zweimal, Daten bleiben', async () => {
  const db = await neueDatenbank();
  const { marktId } = await markt(db);
  await db.exec(SCHEMA);
  assert.equal((await db.query('select count(*)::int as n from mhd.maerkte')).rows[0].n, 1);
  assert.equal((await db.query('select count(*)::int as n from mhd.warengruppen where markt_id = $1', [marktId])).rows[0].n, 11);
});

test('anon und authenticated kommen nicht an die Tabellen', async () => {
  const db = await neueDatenbank();
  for (const rolle of ['anon', 'authenticated'])
    for (const t of TABELLEN)
      await assert.rejects(als(db, rolle, null, `select * from mhd.${t}`), /permission denied/);
});

test('markt_anlegen: Leitung mit PIN-Hash, Konto verknüpft', async () => {
  const db = await neueDatenbank();
  const { marktId, userId, leitungId } = await markt(db, { leitung: 'Chef', pin: '4711' });
  const l = (await db.query('select * from mhd.mitarbeiter where id = $1', [leitungId])).rows[0];
  assert.equal(l.rolle, 'leitung');
  assert.equal(l.name, 'Chef');
  assert.equal(Number(l.markt_id), marktId);
  assert.equal(l.aktiv, true);
  assert.equal(l.fehlversuche, 0);
  assert.notEqual(l.pin_hash, '4711');
  assert.equal((await db.query("select extensions.crypt('4711', $1) = $1 as ok", [l.pin_hash])).rows[0].ok, true);
  const k = (await db.query('select user_id, markt_id from mhd.markt_konten')).rows;
  assert.deepEqual(k.map((z) => [z.user_id, Number(z.markt_id)]), [[userId, marktId]]);
});

test('markt_anlegen lehnt unbekannte E-Mail (KONTO_UNBEKANNT) und PIN "12a" (PIN_UNGUELTIG) ab', async () => {
  const db = await neueDatenbank();
  await assert.rejects(db.query("select mhd.markt_anlegen('M', 'gibtsnicht@example.com', 'Chef', '4711')"), /KONTO_UNBEKANNT/);
  await db.query("insert into auth.users (email) values ('a@example.com')");
  for (const pin of ['12a', '123', '1234567', ''])
    await assert.rejects(db.query("select mhd.markt_anlegen('M', 'a@example.com', 'Chef', $1)", [pin]), /PIN_UNGUELTIG/);
  assert.equal((await db.query('select count(*)::int as n from mhd.maerkte')).rows[0].n, 0);
});

test('Regel: reduzier_vorlauf_tage > pruef_vorlauf_tage wird von der Tabelle abgelehnt', async () => {
  const db = await neueDatenbank();
  const { marktId } = await markt(db);
  const einfuegen = (n, pruef, reduz, max) => db.query(
    'insert into mhd.warengruppen (markt_id, name, pruef_vorlauf_tage, reduzier_vorlauf_tage, max_intervall_tage) values ($1, $2, $3, $4, $5)',
    [marktId, n, pruef, reduz, max]);
  await assert.rejects(einfuegen('A', 2, 3, 30), /check/);
  await assert.rejects(einfuegen('B', -1, 0, 30), /check/);
  await assert.rejects(einfuegen('C', 3, 2, 0), /check/);
  await einfuegen('D', 3, 3, 1); // Grenzfall ist erlaubt
});

test('Artikel: EAN-Format, eindeutige EAN je Markt, Name', async () => {
  const db = await neueDatenbank();
  const { marktId } = await markt(db);
  const neu = (ean, name = 'Milch') => db.query(
    "insert into mhd.artikel (markt_id, ean, name, quelle) values ($1, $2, $3, 'hand')", [marktId, ean, name]);
  await neu('4001234567890');
  await neu('12345670');
  await assert.rejects(neu('4001234567890'), /duplicate key/);
  await assert.rejects(neu('123'), /check/);
  await assert.rejects(neu('40012345678AB'), /check/);
  await assert.rejects(neu(null, ''), /check/);
  await assert.rejects(neu(null, 'x'.repeat(121)), /check/);
  await neu(null, 'Ohne EAN 1');
  await neu(null, 'Ohne EAN 2');
  const a = (await db.query('select bestand, aktiv, reduziert from mhd.artikel limit 1')).rows[0];
  assert.deepEqual(a, { bestand: false, aktiv: true, reduziert: false });
});

test('Protokoll: update und delete schlagen fehl (PROTOKOLL_UNVERAENDERLICH)', async () => {
  const db = await neueDatenbank();
  const { marktId, leitungId } = await markt(db);
  await db.query("insert into mhd.protokoll (markt_id, mitarbeiter_id, art) values ($1, $2, 'geprueft')", [marktId, leitungId]);
  await assert.rejects(db.query("update mhd.protokoll set art = 'reduziert'"), /PROTOKOLL_UNVERAENDERLICH/);
  await assert.rejects(db.query('delete from mhd.protokoll'), /PROTOKOLL_UNVERAENDERLICH/);
  await db.query("select set_config('mhd.demo_reset', '1', false)");
  await db.query('delete from mhd.protokoll');
  assert.equal((await db.query('select count(*)::int as n from mhd.protokoll')).rows[0].n, 0);
});

test('heute()/jetzt() folgen den Test-Einstellungen', async () => {
  const db = await neueDatenbank();
  await heuteSetzen(db, '2026-11-20');
  await jetztSetzen(db, '2026-11-20T08:30:00+01:00');
  assert.equal((await db.query('select mhd.heute()::text as d')).rows[0].d, '2026-11-20');
  assert.equal((await db.query("select (mhd.jetzt() = '2026-11-20T07:30:00Z'::timestamptz) as ok")).rows[0].ok, true);
  await heuteSetzen(db, null);
  await jetztSetzen(db, null);
  const r = (await db.query(
    "select mhd.heute() = (now() at time zone 'Europe/Berlin')::date as h, abs(extract(epoch from now() - mhd.jetzt())) < 5 as j")).rows[0];
  assert.deepEqual(r, { h: true, j: true });
});
