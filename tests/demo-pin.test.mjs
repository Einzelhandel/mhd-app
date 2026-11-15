// Demo-Daten: die PIN von Anna und Ben ist beim Einrichten wählbar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { neueDatenbank, als, json } from './helfer.mjs';

const DEMO = readFileSync(new URL('../supabase/demo-daten.sql', import.meta.url), 'utf8');
const ANZAHL = `select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'mhd' and p.proname = 'demo_einrichten'`;

async function demoDatenbank() {
  const db = await neueDatenbank();
  await db.exec(DEMO);
  const konto = (await db.query("insert into auth.users (email) values ('demo@example.com') returning id")).rows[0].id;
  return { db, konto };
}

async function anmeldung(db, konto, name, pin) {
  const id = Number((await db.query('select id from mhd.mitarbeiter where name = $1', [name])).rows[0].id);
  return json(db, konto, 'select public.mhd_pin_anmelden($1, $2) as r', [id, pin]);
}

test('Demo: ohne dritten Parameter gilt für Anna 1234', async () => {
  const { db, konto } = await demoDatenbank();
  await db.query("select mhd.demo_einrichten('demo@example.com', '9999')");
  assert.equal((await anmeldung(db, konto, 'Anna', '1234')).ok, true);
});

test('Demo: gewählte Mitarbeiter-PIN gilt für Anna und Ben; Zurücksetzen ohne PIN stellt 1234 wieder her', async () => {
  const { db, konto } = await demoDatenbank();
  await db.query("select mhd.demo_einrichten('demo@example.com', '9999', '4711')");
  for (const name of ['Anna', 'Ben']) {
    assert.equal((await anmeldung(db, konto, name, '1234')).fehler, 'PIN_FALSCH', name);
    assert.equal((await anmeldung(db, konto, name, '4711')).ok, true, name);
  }
  await db.query("select mhd.demo_einrichten('demo@example.com')");
  for (const name of ['Anna', 'Ben']) {
    assert.equal((await anmeldung(db, konto, name, '4711')).fehler, 'PIN_FALSCH', name);
    assert.equal((await anmeldung(db, konto, name, '1234')).ok, true, name);
  }
});

test('Demo: eine ungültige Mitarbeiter-PIN scheitert', async () => {
  const { db } = await demoDatenbank();
  await db.query("select mhd.demo_einrichten('demo@example.com', '9999')");
  await assert.rejects(db.query("select mhd.demo_einrichten('demo@example.com', null, 'abc')"), /PIN_UNGUELTIG/);
});

test('Demo: Datei zweimal laden und über eine Datenbank mit der alten Funktion laden ergibt genau eine Funktion', async () => {
  const { db } = await demoDatenbank();
  await db.exec(DEMO);
  assert.equal((await db.query(ANZAHL)).rows[0].n, 1);

  const alt = await neueDatenbank();
  await alt.exec('create function mhd.demo_einrichten(p_email text, p_leitung_pin text default null) returns void language sql as $$ select $$');
  assert.equal((await alt.query(ANZAHL)).rows[0].n, 1);
  await alt.exec(DEMO);
  assert.equal((await alt.query(ANZAHL)).rows[0].n, 1);
  await alt.query("insert into auth.users (email) values ('demo@example.com')");
  await alt.query("select mhd.demo_einrichten('demo@example.com', '9999')");
});

test('Demo: anon und authenticated dürfen die Funktion nicht aufrufen', async () => {
  const { db, konto } = await demoDatenbank();
  for (const rolle of ['anon', 'authenticated']) {
    await assert.rejects(als(db, rolle, konto, "select mhd.demo_einrichten('demo@example.com')"), /permission denied/);
    const r = await db.query(
      "select has_function_privilege($1, 'mhd.demo_einrichten(text, text, text)', 'execute') as ok", [rolle]);
    assert.equal(r.rows[0].ok, false, rolle);
  }
});
