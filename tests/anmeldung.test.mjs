// Anmeldung: Markt-Konto, PIN mit Sperre, Sitzung mit Ablauf.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neueDatenbank, als, json, jetztSetzen, markt, pin } from './helfer.mjs';

// Neuer Mitarbeiter direkt in der Tabelle (die Verwaltung folgt in einer späteren Stufe).
async function mitarbeiterAnlegen(db, marktId, name, pinText, { aktiv = true } = {}) {
  const r = await db.query(
    "insert into mhd.mitarbeiter (markt_id, name, rolle, pin_hash, aktiv) values ($1, $2, 'mitarbeiter', mhd.pin_hash($3), $4) returning id",
    [marktId, name, pinText, aktiv]);
  return Number(r.rows[0].id);
}

// Führt eine Abfrage als Datenbankbesitzer mit den Claims des Markt-Kontos aus
// (so ruft später eine öffentliche Funktion die internen Helfer auf).
async function alsKonto(db, userId, sql, params) {
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: userId, role: 'authenticated' })]);
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.query("select set_config('request.jwt.claims', '', false)");
  }
}

async function wer(db, userId, sitzung) {
  return Number((await alsKonto(db, userId, 'select (mhd.wer($1)).id as id', [sitzung]))[0].id);
}

test('mhd_markt: nur der eigene Markt, nur aktive Mitarbeiter', async () => {
  const db = await neueDatenbank();
  const a = await markt(db, { name: 'Markt A', email: 'a@example.com', leitung: 'Chef A' });
  const b = await markt(db, { name: 'Markt B', email: 'b@example.com', leitung: 'Chef B' });
  await mitarbeiterAnlegen(db, a.marktId, 'Berta', '1234');
  await mitarbeiterAnlegen(db, a.marktId, 'Anton', '1234');
  await mitarbeiterAnlegen(db, a.marktId, 'Gone', '1234', { aktiv: false });
  const ra = await json(db, a.userId, 'select public.mhd_markt() as r');
  assert.deepEqual(ra.markt, { id: a.marktId, name: 'Markt A' });
  assert.deepEqual(ra.mitarbeiter.map((m) => m.name), ['Anton', 'Berta', 'Chef A']);
  assert.deepEqual(Object.keys(ra.mitarbeiter[0]).sort(), ['id', 'name']);
  const rb = await json(db, b.userId, 'select public.mhd_markt() as r');
  assert.deepEqual(rb.mitarbeiter.map((m) => m.name), ['Chef B']);
});

test('Konto ohne Markt: KEIN_ZUGRIFF; anon darf mhd_markt nicht ausführen', async () => {
  const db = await neueDatenbank();
  await markt(db);
  const u = await db.query("insert into auth.users (email) values ('ohne@example.com') returning id");
  await assert.rejects(json(db, u.rows[0].id, 'select public.mhd_markt() as r'), /KEIN_ZUGRIFF/);
  await assert.rejects(als(db, 'anon', null, 'select public.mhd_markt() as r'), /permission denied/);
  await assert.rejects(als(db, 'anon', null, 'select public.mhd_pin_anmelden(1, $1)', ['4711']), /permission denied/);
  await assert.rejects(als(db, 'authenticated', u.rows[0].id, 'select mhd.mein_markt()'), /permission denied/);
});

test('richtige PIN liefert Sitzung, Rolle und setzt fehlversuche auf 0', async () => {
  const db = await neueDatenbank();
  const { userId, leitungId } = await markt(db, { leitung: 'Chef' });
  await json(db, userId, 'select public.mhd_pin_anmelden($1, $2) as r', [leitungId, '0000']);
  await json(db, userId, 'select public.mhd_pin_anmelden($1, $2) as r', [leitungId, '0000']);
  assert.equal((await db.query('select fehlversuche from mhd.mitarbeiter where id = $1', [leitungId])).rows[0].fehlversuche, 2);
  const r = await json(db, userId, 'select public.mhd_pin_anmelden($1, $2) as r', [leitungId, '4711']);
  assert.equal(r.ok, true);
  assert.equal(r.name, 'Chef');
  assert.equal(r.rolle, 'leitung');
  assert.match(r.sitzung, /^[0-9a-f-]{36}$/);
  assert.equal((await db.query('select fehlversuche from mhd.mitarbeiter where id = $1', [leitungId])).rows[0].fehlversuche, 0);
  assert.equal((await db.query('select count(*)::int as n from mhd.sitzungen where token = $1', [r.sitzung])).rows[0].n, 1);
});

test('5 falsche PINs sperren 15 Minuten, auch die richtige PIN hilft dann nicht', async () => {
  const db = await neueDatenbank();
  const { userId, leitungId } = await markt(db);
  const anmelden = (p) => json(db, userId, 'select public.mhd_pin_anmelden($1, $2) as r', [leitungId, p]);
  await jetztSetzen(db, '2026-11-16 08:00:00+01');
  for (let i = 0; i < 4; i++) assert.equal((await anmelden('0000')).fehler, 'PIN_FALSCH');
  const gesperrt = await anmelden('0000');
  assert.equal(gesperrt.fehler, 'PIN_GESPERRT');
  assert.equal(new Date(gesperrt.gesperrt_bis).getTime(), new Date('2026-11-16 08:15:00+01').getTime());
  assert.equal((await anmelden('4711')).fehler, 'PIN_GESPERRT');
  await jetztSetzen(db, '2026-11-16 08:15:01+01');
  assert.equal((await anmelden('4711')).ok, true);
});

test('Sitzung läuft nach 30 Minuten ohne Aktion ab (PIN_ABGELAUFEN), jede Aktion verlängert', async () => {
  const db = await neueDatenbank();
  const { userId, leitungId } = await markt(db);
  await jetztSetzen(db, '2026-11-16 08:00:00+01');
  const s = await pin(db, userId, leitungId, '4711');
  await jetztSetzen(db, '2026-11-16 08:29:00+01');
  assert.equal(await wer(db, userId, s), leitungId);
  await jetztSetzen(db, '2026-11-16 08:58:00+01');
  assert.equal(await wer(db, userId, s), leitungId);
  await jetztSetzen(db, '2026-11-16 09:29:00+01');
  await assert.rejects(wer(db, userId, s), /PIN_ABGELAUFEN/);
  await assert.rejects(wer(db, userId, '00000000-0000-0000-0000-000000000000'), /PIN_ABGELAUFEN/);
});

test('mhd.leitung: Leitung ok, Mitarbeiter NUR_LEITUNG', async () => {
  const db = await neueDatenbank();
  const { marktId, userId, leitungId } = await markt(db);
  const mid = await mitarbeiterAnlegen(db, marktId, 'Berta', '1234');
  const sl = await pin(db, userId, leitungId, '4711');
  const sm = await pin(db, userId, mid, '1234');
  assert.equal(Number((await alsKonto(db, userId, 'select (mhd.leitung($1)).id as id', [sl]))[0].id), leitungId);
  await assert.rejects(alsKonto(db, userId, 'select (mhd.leitung($1)).id as id', [sm]), /NUR_LEITUNG/);
});

test('Sitzung eines anderen Marktes: PIN_ABGELAUFEN', async () => {
  const db = await neueDatenbank();
  const a = await markt(db, { name: 'Markt A', email: 'a@example.com' });
  const b = await markt(db, { name: 'Markt B', email: 'b@example.com' });
  const s = await pin(db, a.userId, a.leitungId, '4711');
  assert.equal(await wer(db, a.userId, s), a.leitungId);
  await assert.rejects(wer(db, b.userId, s), /PIN_ABGELAUFEN/);
});

test('Mitarbeiter eines anderen Marktes kann sich nicht anmelden (PIN_FALSCH, kein Zähler im fremden Markt)', async () => {
  const db = await neueDatenbank();
  const a = await markt(db, { name: 'Markt A', email: 'a@example.com' });
  const b = await markt(db, { name: 'Markt B', email: 'b@example.com' });
  for (let i = 0; i < 6; i++) {
    const r = await json(db, b.userId, 'select public.mhd_pin_anmelden($1, $2) as r', [a.leitungId, '4711']);
    assert.equal(r.ok, false);
    assert.equal(r.fehler, 'PIN_FALSCH');
  }
  const m = (await db.query('select fehlversuche, gesperrt_bis from mhd.mitarbeiter where id = $1', [a.leitungId])).rows[0];
  assert.equal(m.fehlversuche, 0);
  assert.equal(m.gesperrt_bis, null);
});

test('inaktiver Mitarbeiter: PIN_FALSCH; abmelden löscht die Sitzung', async () => {
  const db = await neueDatenbank();
  const { marktId, userId, leitungId } = await markt(db);
  const mid = await mitarbeiterAnlegen(db, marktId, 'Berta', '1234');
  const s = await pin(db, userId, mid, '1234');
  await db.query('update mhd.mitarbeiter set aktiv = false where id = $1', [mid]);
  assert.equal((await json(db, userId, 'select public.mhd_pin_anmelden($1, $2) as r', [mid, '1234'])).fehler, 'PIN_FALSCH');
  await assert.rejects(wer(db, userId, s), /PIN_ABGELAUFEN/);
  const sl = await pin(db, userId, leitungId, '4711');
  await als(db, 'authenticated', userId, 'select public.mhd_pin_abmelden($1)', [sl]);
  assert.equal((await db.query('select count(*)::int as n from mhd.sitzungen where token = $1', [sl])).rows[0].n, 0);
  await assert.rejects(wer(db, userId, sl), /PIN_ABGELAUFEN/);
});
