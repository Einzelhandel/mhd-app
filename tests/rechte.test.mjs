// Rechte: Funktionsrechte aller public.mhd_*-Funktionen und Zugriffsprüfung jeder Funktion.
// Aufbau übernommen aus einem früheren eigenen Projekt.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { neueDatenbank, als, json, markt, pin } from './helfer.mjs';

// Neue Funktion hier eintragen (und unten bei den Aufrufen).
const ALLE = ['mhd_markt', 'mhd_pin_anmelden', 'mhd_pin_abmelden', 'mhd_warengruppen', 'mhd_artikel_suchen',
  'mhd_artikel_liste', 'mhd_artikel_speichern', 'mhd_liste', 'mhd_aktion', 'mhd_mitarbeiter_liste',
  'mhd_mitarbeiter_speichern', 'mhd_warengruppe_speichern', 'mhd_protokoll'];

let db, a, b, ohneMarkt, sMitarbeiter, sLeitung, mitarbeiterId, artikelId, gruppeId;

const aufruf = (nutzer, sql) => als(db, 'authenticated', nutzer, sql);

// Jede Funktion mit Sitzung, mit echten Ids, damit ein fehlender Rechtecheck sichtbar etwas ändern würde.
const MIT_SITZUNG = {
  mhd_warengruppen: (s) => `select public.mhd_warengruppen('${s}')`,
  mhd_artikel_suchen: (s) => `select public.mhd_artikel_suchen('${s}', '4012345600001')`,
  mhd_artikel_liste: (s) => `select public.mhd_artikel_liste('${s}')`,
  mhd_artikel_speichern: (s) => `select public.mhd_artikel_speichern('${s}', ${artikelId}, '{"name":"Geaendert"}')`,
  mhd_liste: (s) => `select public.mhd_liste('${s}')`,
  mhd_aktion: (s) => `select public.mhd_aktion('${s}', ${artikelId}, 'geprueft', '2026-12-01')`,
  mhd_mitarbeiter_liste: (s) => `select public.mhd_mitarbeiter_liste('${s}')`,
  mhd_mitarbeiter_speichern: (s) => `select public.mhd_mitarbeiter_speichern('${s}', ${mitarbeiterId}, '{"name":"Geaendert","rolle":"leitung","aktiv":false,"pin":"9999"}')`,
  mhd_warengruppe_speichern: (s) => `select public.mhd_warengruppe_speichern('${s}', ${gruppeId}, '{"name":"Geaendert","pruef_vorlauf_tage":9,"reduzier_vorlauf_tage":1,"max_intervall_tage":9}')`,
  mhd_protokoll: (s) => `select public.mhd_protokoll('${s}', '2020-01-01', '2099-12-31')`,
};
// Nur die Marktleitung darf diese Funktionen (in dieser Form) aufrufen.
const NUR_LEITUNG = ['mhd_artikel_speichern', 'mhd_mitarbeiter_liste', 'mhd_mitarbeiter_speichern',
  'mhd_warengruppe_speichern', 'mhd_protokoll'];

before(async () => {
  db = await neueDatenbank();
  a = await markt(db, { name: 'Markt A', email: 'a@example.com' });
  b = await markt(db, { name: 'Markt B', email: 'b@example.com' });
  ohneMarkt = (await db.query("insert into auth.users (email) values ('ohne@example.com') returning id")).rows[0].id;
  mitarbeiterId = Number((await db.query(
    "insert into mhd.mitarbeiter (markt_id, name, rolle, pin_hash) values ($1, 'Berta', 'mitarbeiter', mhd.pin_hash('1234')) returning id", [a.marktId])).rows[0].id);
  gruppeId = Number((await db.query("select id from mhd.warengruppen where markt_id = $1 and name = 'Molkerei'", [a.marktId])).rows[0].id);
  artikelId = Number((await db.query(
    "insert into mhd.artikel (markt_id, ean, name, quelle, warengruppe_id, ohne_bestand_seit) values ($1, '4012345600001', 'Milch', 'hand', $2, '2026-11-10') returning id",
    [a.marktId, gruppeId])).rows[0].id);
  sLeitung = await pin(db, a.userId, a.leitungId, '4711');
  sMitarbeiter = await pin(db, a.userId, mitarbeiterId, '1234');
});

const funktionen = async () => (await db.query(`
  select p.proname as name, p.oid, p.prosecdef, p.proconfig, p.proargnames,
         has_function_privilege('anon', p.oid, 'execute') as anon,
         has_function_privilege('authenticated', p.oid, 'execute') as angemeldet
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'mhd\\_%' order by p.proname`)).rows;

// Inhalt aller Tabellen (ohne Sitzungen, deren letzte_aktion jeder gültige Aufruf verlängert).
const stand = async () => {
  const t = (await db.query(
    "select table_name from information_schema.tables where table_schema = 'mhd' and table_type = 'BASE TABLE' and table_name <> 'sitzungen' order by 1")).rows;
  const z = {};
  for (const { table_name: n } of t)
    z[n] = (await db.query(`select coalesce(md5(string_agg(x::text, '|' order by x::text)), '') as h from mhd.${n} x`)).rows[0].h;
  return z;
};

test('Liste stimmt mit der Datenbank überein (neue Funktion hier eintragen)', async () => {
  assert.deepEqual((await funktionen()).map((f) => f.name).sort(), [...ALLE].sort());
  const mitSitzung = (await funktionen()).filter((f) => (f.proargnames ?? []).includes('p_sitzung')).map((f) => f.name);
  for (const n of mitSitzung.filter((x) => x !== 'mhd_pin_abmelden')) assert.ok(MIT_SITZUNG[n], `kein Aufruf für ${n}`);
  for (const n of Object.keys(MIT_SITZUNG)) assert.ok(mitSitzung.includes(n), `${n} hat keinen Parameter p_sitzung`);
});

test('jede Funktion: security definer, search_path leer, ausführbar nur für authenticated', async () => {
  for (const f of await funktionen()) {
    assert.equal(f.anon, false, `anon: ${f.name}`);
    assert.equal(f.angemeldet, true, `angemeldet: ${f.name}`);
    assert.equal(f.prosecdef, true, `security definer: ${f.name}`);
    assert.ok((f.proconfig ?? []).includes('search_path=""'), `search_path leer: ${f.name}`);
  }
});

test('jede Funktion mit p_sitzung lehnt ab: fremdes Konto, abgelaufene Sitzung, Sitzung eines anderen Marktes', async () => {
  const vorher = await stand();
  for (const [name, sql] of Object.entries(MIT_SITZUNG)) {
    await assert.rejects(aufruf(ohneMarkt, sql(sLeitung)), /KEIN_ZUGRIFF/, `Konto ohne Markt: ${name}`);
    await assert.rejects(aufruf(b.userId, sql(sLeitung)), /PIN_ABGELAUFEN/, `Konto eines anderen Marktes: ${name}`);
    await assert.rejects(aufruf(a.userId, sql('00000000-0000-0000-0000-000000000000')), /PIN_ABGELAUFEN/, `unbekannte Sitzung: ${name}`);
  }
  const alt = (await db.query(
    "insert into mhd.sitzungen (mitarbeiter_id, letzte_aktion) values ($1, mhd.jetzt() - interval '30 minutes 1 second') returning token", [a.leitungId])).rows[0].token;
  for (const [name, sql] of Object.entries(MIT_SITZUNG))
    await assert.rejects(aufruf(a.userId, sql(alt)), /PIN_ABGELAUFEN/, `abgelaufene Sitzung: ${name}`);
  assert.deepEqual(await stand(), vorher);
});

test('Anmeldung und Markt: fremdes Konto, kein Konto, abmelden mit fremder Sitzung', async () => {
  await assert.rejects(aufruf(ohneMarkt, 'select public.mhd_markt()'), /KEIN_ZUGRIFF/);
  await assert.rejects(aufruf(ohneMarkt, `select public.mhd_pin_anmelden(${a.leitungId}, '4711')`), /KEIN_ZUGRIFF/);
  await assert.rejects(aufruf(ohneMarkt, `select public.mhd_pin_abmelden('${sLeitung}')`), /KEIN_ZUGRIFF/);
  const r = await json(db, b.userId, 'select public.mhd_pin_anmelden($1, $2) as r', [a.leitungId, '4711']);
  assert.equal(r.ok, false);
  await aufruf(b.userId, `select public.mhd_pin_abmelden('${sLeitung}')`);        // fremde Sitzung: still ignoriert
  assert.equal((await db.query('select count(*)::int as n from mhd.sitzungen where token = $1', [sLeitung])).rows[0].n, 1);
  assert.equal((await aufruf(a.userId, `select public.mhd_warengruppen('${sLeitung}') as r`))[0].r.length, 11);
});

test('Leitungs-Funktionen lehnen Mitarbeiter ab (NUR_LEITUNG) und ändern dabei nichts', async () => {
  const vorher = await stand();
  for (const name of NUR_LEITUNG)
    await assert.rejects(aufruf(a.userId, MIT_SITZUNG[name](sMitarbeiter)), /NUR_LEITUNG/, name);
  assert.deepEqual(await stand(), vorher);
  // Gegenprobe: lesende Aufrufe mit Leitung laufen durch.
  for (const name of ['mhd_mitarbeiter_liste', 'mhd_protokoll'])
    await aufruf(a.userId, MIT_SITZUNG[name](sLeitung));
});

test('keine Funktion in public außer mhd_*; im Schema mhd nichts für anon/authenticated ausführbar', async () => {
  const fremd = (await db.query(`
    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname not like 'mhd\\_%'`)).rows;
  assert.deepEqual(fremd, []);
  const intern = (await db.query(
    "select p.proname, p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'mhd'")).rows;
  assert.ok(intern.length >= 8);
  for (const f of intern)
    for (const rolle of ['anon', 'authenticated'])
      assert.equal((await db.query("select has_function_privilege($1, $2, 'execute') as ok", [rolle, f.oid])).rows[0].ok, false, `${rolle}: mhd.${f.proname}`);
  for (const rolle of ['anon', 'authenticated'])
    assert.equal((await db.query("select has_schema_privilege($1, 'mhd', 'usage') as ok", [rolle])).rows[0].ok, false);
});
