// Marktleitung: Mitarbeiter verwalten, Regeln der Warengruppen, Protokoll.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neueDatenbank, json, heuteSetzen, markt, pin } from './helfer.mjs';

// Markt mit Leitung "Chef" (PIN 4711) und Mitarbeiterin "Berta" (PIN 1234).
async function umgebung({ db = null, name = 'Markt A', email = 'a@example.com' } = {}) {
  db ??= await neueDatenbank();
  await heuteSetzen(db, '2026-11-10');
  const m = await markt(db, { name, email, leitung: 'Chef', pin: '4711' });
  const b = await db.query(
    "insert into mhd.mitarbeiter (markt_id, name, rolle, pin_hash) values ($1, 'Berta', 'mitarbeiter', mhd.pin_hash('1234')) returning id", [m.marktId]);
  const berta = Number(b.rows[0].id);
  const chef = await pin(db, m.userId, m.leitungId, '4711');
  const sitzung = await pin(db, m.userId, berta, '1234');
  const rpc = (sql, params = []) => json(db, m.userId, `select ${sql} as r`, params);
  let zaehler = 0;
  const u = {
    db, m, berta, chef, sitzung, rpc,
    speichern: (id, daten, s = chef) => rpc('public.mhd_mitarbeiter_speichern($1, $2, $3::jsonb)', [s, id, JSON.stringify(daten)]),
    liste: (s = chef) => rpc('public.mhd_mitarbeiter_liste($1)', [s]),
    anmelden: (id, p) => rpc('public.mhd_pin_anmelden($1, $2)', [id, p]),
    gruppen: (s = chef) => rpc('public.mhd_warengruppen($1)', [s]),
    gruppeSpeichern: (id, daten, s = chef) => rpc('public.mhd_warengruppe_speichern($1, $2, $3::jsonb)', [s, id, JSON.stringify(daten)]),
    protokoll: (von, bis, mitarbeiter = null, artikel = null, s = chef) =>
      rpc('public.mhd_protokoll($1, $2::date, $3::date, $4::bigint, $5::bigint)', [s, von, bis, mitarbeiter, artikel]),
    zeile: async (id) => (await db.query('select * from mhd.mitarbeiter where id = $1', [id])).rows[0],
  };
  u.gruppe = async (n) => (await u.gruppen()).find((g) => g.name === n);
  u.artikel = async (name, gruppeName = 'Molkerei') => {
    const g = await u.gruppe(gruppeName);
    zaehler += 1;
    const ean = `40123456${String(zaehler).padStart(5, '0')}`;
    return (await rpc('public.mhd_artikel_speichern($1, null, $2::jsonb)',
      [chef, JSON.stringify({ ean, name, warengruppe_id: g.id, quelle: 'hand' })])).id;
  };
  u.aktion = (id, art, mhd = null, s = chef) => rpc('public.mhd_aktion($1, $2, $3, $4::date)', [s, id, art, mhd]);
  u.wo = async (id) => {
    const l = await rpc('public.mhd_liste($1)', [chef]);
    const treffer = Object.entries(l.abschnitte).filter(([, arr]) => arr.some((x) => x.id === id));
    return treffer.length ? [treffer[0][0], treffer[0][1].find((x) => x.id === id).versaeumt] : [null, null];
  };
  return u;
}

test('Mitarbeiter anlegen, ändern, PIN neu setzen hebt Sperre auf', async () => {
  const u = await umgebung();
  const id = await u.speichern(null, { name: 'Anton', rolle: 'mitarbeiter', aktiv: true, pin: '1111' });
  assert.equal((await u.anmelden(id, '1111')).ok, true);
  await assert.rejects(u.speichern(null, { name: 'Ohne', rolle: 'mitarbeiter', aktiv: true }), /PIN_UNGUELTIG/);
  await assert.rejects(u.speichern(null, { name: 'Kurz', rolle: 'mitarbeiter', aktiv: true, pin: '12' }), /PIN_UNGUELTIG/);

  const hashVorher = (await u.zeile(id)).pin_hash;
  assert.equal(await u.speichern(id, { name: 'Anton Neu', rolle: 'leitung', aktiv: true }), id);   // ohne pin: PIN bleibt
  assert.equal((await u.zeile(id)).pin_hash, hashVorher);
  assert.equal((await u.anmelden(id, '1111')).rolle, 'leitung');

  for (let i = 0; i < 5; i++) await u.anmelden(id, '0000');
  let eintrag = (await u.liste()).find((x) => x.id === id);
  assert.deepEqual(eintrag, { id, name: 'Anton Neu', rolle: 'leitung', aktiv: true, gesperrt: true });
  assert.equal((await u.anmelden(id, '1111')).fehler, 'PIN_GESPERRT');

  await u.speichern(id, { name: 'Anton Neu', rolle: 'leitung', aktiv: true, pin: '2222' });
  eintrag = (await u.liste()).find((x) => x.id === id);
  assert.equal(eintrag.gesperrt, false);
  assert.equal((await u.zeile(id)).fehlversuche, 0);
  assert.equal((await u.anmelden(id, '1111')).fehler, 'PIN_FALSCH');
  assert.equal((await u.anmelden(id, '2222')).ok, true);
  assert.deepEqual((await u.liste()).map((x) => x.name), ['Anton Neu', 'Berta', 'Chef']);
});

test('letzte aktive Leitung: nicht herabstufen, nicht deaktivieren (LETZTE_LEITUNG)', async () => {
  const u = await umgebung();
  const chef = { name: 'Chef', rolle: 'leitung', aktiv: true };
  await assert.rejects(u.speichern(u.m.leitungId, { ...chef, rolle: 'mitarbeiter' }), /LETZTE_LEITUNG/);
  await assert.rejects(u.speichern(u.m.leitungId, { ...chef, aktiv: false }), /LETZTE_LEITUNG/);
  assert.equal((await u.zeile(u.m.leitungId)).rolle, 'leitung');
  assert.equal((await u.zeile(u.m.leitungId)).aktiv, true);
  // Eine Leitung in einem anderen Markt zählt nicht.
  await umgebung({ db: u.db, name: 'Markt B', email: 'b@example.com' });
  await assert.rejects(u.speichern(u.m.leitungId, { ...chef, aktiv: false }), /LETZTE_LEITUNG/);
  // Mit zweiter aktiver Leitung geht es; danach ist die zweite die letzte.
  const zweite = await u.speichern(null, { name: 'Vize', rolle: 'leitung', aktiv: true, pin: '3333' });
  await u.speichern(u.m.leitungId, { ...chef, rolle: 'mitarbeiter' });
  const sVize = await pin(u.db, u.m.userId, zweite, '3333');
  await assert.rejects(u.speichern(zweite, { name: 'Vize', rolle: 'leitung', aktiv: false }, sVize), /LETZTE_LEITUNG/);
});

test('doppelter Name im Markt: NAME_VERGEBEN; in einem anderen Markt erlaubt', async () => {
  const u = await umgebung();
  await assert.rejects(u.speichern(null, { name: 'Berta', rolle: 'mitarbeiter', aktiv: true, pin: '1111' }), /NAME_VERGEBEN/);
  const id = await u.speichern(null, { name: 'Anton', rolle: 'mitarbeiter', aktiv: true, pin: '1111' });
  await assert.rejects(u.speichern(id, { name: 'Berta', rolle: 'mitarbeiter', aktiv: true }), /NAME_VERGEBEN/);
  assert.equal((await u.zeile(id)).name, 'Anton');
  const b = await umgebung({ db: u.db, name: 'Markt B', email: 'b@example.com' });
  await b.speichern(null, { name: 'Anton', rolle: 'mitarbeiter', aktiv: true, pin: '1111' });
});

test('Mitarbeiter eines anderen Marktes ist unbekannt; Rolle und Name müssen gültig sein', async () => {
  const u = await umgebung();
  const b = await umgebung({ db: u.db, name: 'Markt B', email: 'b@example.com' });
  await assert.rejects(u.speichern(b.berta, { name: 'Berta', rolle: 'mitarbeiter', aktiv: false }), /MITARBEITER_UNBEKANNT/);
  assert.equal((await b.zeile(b.berta)).aktiv, true);
  await assert.rejects(u.speichern(null, { name: 'X', rolle: 'chef', aktiv: true, pin: '1111' }), /ROLLE_UNGUELTIG/);
  await assert.rejects(u.speichern(null, { name: ' ', rolle: 'mitarbeiter', aktiv: true, pin: '1111' }), /NAME_FEHLT/);
  assert.deepEqual((await b.liste()).map((x) => x.name), ['Berta', 'Chef']);
});

test('Namen von Mitarbeitern und Warengruppen: höchstens 40 Zeichen, sonst NAME_FEHLT; die Tabellen lehnen Längeres ab', async () => {
  const u = await umgebung();
  const regel = (name) => ({ name, pruef_vorlauf_tage: 3, reduzier_vorlauf_tage: 2, max_intervall_tage: 30 });
  const vierzig = 'A'.repeat(40);
  const id = await u.speichern(null, { name: ` ${vierzig} `, rolle: 'mitarbeiter', aktiv: true, pin: '1111' });
  assert.equal((await u.zeile(id)).name, vierzig);
  await assert.rejects(u.speichern(null, { name: 'B'.repeat(41), rolle: 'mitarbeiter', aktiv: true, pin: '1111' }), /NAME_FEHLT/);
  await assert.rejects(u.speichern(id, { name: 'C'.repeat(41), rolle: 'mitarbeiter', aktiv: true }), /NAME_FEHLT/);
  assert.equal((await u.zeile(id)).name, vierzig);
  const gruppe = await u.gruppeSpeichern(null, regel(vierzig));
  assert.equal((await u.gruppe(vierzig)).id, gruppe);
  await assert.rejects(u.gruppeSpeichern(null, regel('D'.repeat(41))), /NAME_FEHLT/);
  await assert.rejects(u.gruppeSpeichern(gruppe, regel('E'.repeat(41))), /NAME_FEHLT/);
  await assert.rejects(u.db.query('update mhd.mitarbeiter set name = $1 where id = $2', ['F'.repeat(41), id]), /check/);
  await assert.rejects(u.db.query('update mhd.warengruppen set name = $1 where id = $2', ['G'.repeat(41), gruppe]), /check/);
});

test('neue PIN beendet die Sitzungen dieses Mitarbeiters; ohne neue PIN bleiben sie', async () => {
  const u = await umgebung();
  const zweite = await pin(u.db, u.m.userId, u.berta, '1234');           // Berta an zwei Geräten
  await u.speichern(u.berta, { name: 'Berta B.', rolle: 'mitarbeiter', aktiv: true });   // nur der Name
  assert.equal((await u.gruppen(u.sitzung)).length, 11);
  await u.speichern(u.berta, { name: 'Berta B.', rolle: 'mitarbeiter', aktiv: true, pin: '5555' });
  assert.equal((await u.db.query('select count(*)::int as n from mhd.sitzungen where mitarbeiter_id = $1', [u.berta])).rows[0].n, 0);
  await assert.rejects(u.gruppen(u.sitzung), /PIN_ABGELAUFEN/);
  await assert.rejects(u.gruppen(zweite), /PIN_ABGELAUFEN/);
  assert.equal((await u.gruppen()).length, 11);                  // die Sitzung der Leitung bleibt
  assert.equal((await u.anmelden(u.berta, '5555')).ok, true);
});

test('deaktivierter Mitarbeiter verliert seine Sitzung (PIN_ABGELAUFEN) und kann sich nicht anmelden', async () => {
  const u = await umgebung();
  assert.equal((await u.gruppen(u.sitzung)).length, 11);
  await u.speichern(u.berta, { name: 'Berta', rolle: 'mitarbeiter', aktiv: false });
  assert.equal((await u.db.query('select count(*)::int as n from mhd.sitzungen where mitarbeiter_id = $1', [u.berta])).rows[0].n, 0);
  await assert.rejects(u.gruppen(u.sitzung), /PIN_ABGELAUFEN/);
  assert.equal((await u.anmelden(u.berta, '1234')).ok, false);
  assert.equal((await u.liste()).find((x) => x.id === u.berta).aktiv, false);
  assert.equal((await u.gruppen()).length, 11);                  // die Sitzung der Leitung bleibt
});

test('Protokoll: Zeitraum (ganze Tage, Europe/Berlin), Mitarbeiter, Artikel, neueste zuerst', async () => {
  const u = await umgebung();
  const a = await u.artikel('Milch');
  const b = await u.artikel('Joghurt');
  const zeile = (artikel, mitarbeiter, zeit, art, alt = null, neu = null) => u.db.query(
    'insert into mhd.protokoll (markt_id, artikel_id, mitarbeiter_id, zeitpunkt, art, mhd_alt, mhd_neu) values ($1, $2, $3, $4, $5, $6, $7)',
    [u.m.marktId, artikel, mitarbeiter, zeit, art, alt, neu]);
  await zeile(a, u.berta, '2026-11-09 23:59:59+01', 'geprueft');
  await zeile(a, u.berta, '2026-11-10 00:00:00+01', 'geprueft', null, '2026-11-20');
  await zeile(b, u.m.leitungId, '2026-11-10 12:00:00+01', 'reduziert', '2026-11-20', '2026-11-20');
  await zeile(a, u.m.leitungId, '2026-11-10 23:59:59+01', 'aussortiert', '2026-11-20', null);
  await zeile(a, u.berta, '2026-11-11 00:00:00+01', 'geprueft');
  await zeile(b, u.berta, '2027-06-09 21:59:59Z', 'geprueft');   // 23:59:59 am 09.06. (Sommerzeit)
  await zeile(b, u.berta, '2027-06-09 22:00:00Z', 'geprueft');   // 00:00:00 am 10.06.

  const tag = await u.protokoll('2026-11-10', '2026-11-10');
  assert.deepEqual(tag.map((z) => z.art), ['aussortiert', 'reduziert', 'geprueft']);
  assert.deepEqual(Object.keys(tag[0]).sort(), ['art', 'artikel', 'ean', 'mhd_alt', 'mhd_neu', 'mitarbeiter', 'zeitpunkt']);
  assert.equal(tag[0].mitarbeiter, 'Chef');
  assert.equal(tag[0].artikel, 'Milch');
  assert.match(tag[0].ean, /^[0-9]{13}$/);
  assert.equal(tag[0].mhd_alt, '2026-11-20');
  assert.equal(tag[0].mhd_neu, null);
  assert.equal(tag[2].mhd_neu, '2026-11-20');
  assert.equal(new Date(tag[0].zeitpunkt).getTime(), new Date('2026-11-10 23:59:59+01').getTime());
  assert.equal((await u.protokoll('2026-11-09', '2026-11-11')).length, 5);
  assert.equal((await u.protokoll('2026-11-11', '2026-11-10')).length, 0);
  assert.equal((await u.protokoll('2026-11-09', '2026-11-11', u.berta)).length, 3);
  assert.deepEqual((await u.protokoll('2026-11-09', '2026-11-11', u.m.leitungId)).map((z) => z.art), ['aussortiert', 'reduziert']);
  assert.deepEqual((await u.protokoll('2026-11-09', '2026-11-11', null, b)).map((z) => z.artikel), ['Joghurt']);
  assert.equal((await u.protokoll('2026-11-09', '2026-11-11', u.berta, a)).length, 3);
  assert.equal((await u.protokoll('2027-06-10', '2027-06-10')).length, 1);
});

test('Protokoll: höchstens 500 Zeilen, nur der eigene Markt', async () => {
  const u = await umgebung();
  const b = await umgebung({ db: u.db, name: 'Markt B', email: 'b@example.com' });
  await u.db.query(
    "insert into mhd.protokoll (markt_id, mitarbeiter_id, zeitpunkt, art) select $1, $2, '2026-11-10 08:00:00+01'::timestamptz + g * interval '1 second', 'geprueft' from generate_series(1, 510) g",
    [u.m.marktId, u.berta]);
  await u.db.query("insert into mhd.protokoll (markt_id, mitarbeiter_id, art) values ($1, $2, 'geprueft')", [b.m.marktId, b.berta]);
  const r = await u.protokoll('2026-01-01', '2027-12-31');
  assert.equal(r.length, 500);
  assert.equal(new Date(r[0].zeitpunkt).getTime(), new Date('2026-11-10 08:08:30+01').getTime());   // 510 s nach 08:00:00
  assert.equal(new Date(r[499].zeitpunkt).getTime(), new Date('2026-11-10 08:00:11+01').getTime());
  assert.equal((await u.protokoll('2020-01-01', '2099-12-31', b.berta)).length, 0);
});

test('Regeländerung wirkt sofort: Molkerei 3/2 → 7/2, versäumter Prüftermin steht unter abgelaufen', async () => {
  const u = await umgebung();
  const a = await u.artikel('Quark');
  await heuteSetzen(u.db, '2026-11-05');
  await u.aktion(a, 'geprueft', '2026-11-15');                // MHD in 10 Tagen, Prüftermin nach 3/2: 12.11.
  await heuteSetzen(u.db, '2026-11-10');                      // MHD in 5 Tagen
  assert.deepEqual(await u.wo(a), [null, null]);
  const g = await u.gruppe('Molkerei');
  assert.equal(await u.gruppeSpeichern(g.id, { name: 'Molkerei', pruef_vorlauf_tage: 7, reduzier_vorlauf_tage: 2, max_intervall_tage: 30 }), g.id);
  assert.deepEqual(await u.wo(a), ['abgelaufen', 'pruefen']);  // Prüftermin wäre der 08.11. gewesen
  assert.deepEqual(await u.gruppe('Molkerei'), { id: g.id, name: 'Molkerei', pruef_vorlauf_tage: 7, reduzier_vorlauf_tage: 2, max_intervall_tage: 30 });
});

test('Wechsel der Warengruppe: Termin nach der neuen Regel', async () => {
  const u = await umgebung();
  const a = await u.artikel('Haferdrink');
  await u.aktion(a, 'geprueft', '2026-11-24');                // Molkerei 3/2: Prüfen am 21.11.
  await heuteSetzen(u.db, '2026-11-17');
  assert.deepEqual(await u.wo(a), [null, null]);
  const trocken = await u.gruppe('Trockensortiment');         // 14/7: Reduzieren am 17.11.
  await u.rpc('public.mhd_artikel_speichern($1, $2, $3::jsonb)', [u.chef, a, JSON.stringify({ name: 'Haferdrink', warengruppe_id: trocken.id })]);
  assert.deepEqual(await u.wo(a), ['reduzieren', null]);
  await heuteSetzen(u.db, '2026-11-16');
  assert.deepEqual(await u.wo(a), [null, null]);
});

test('Warengruppe: neu anlegen, REGEL_UNGUELTIG, NAME_VERGEBEN, fremde Gruppe unbekannt', async () => {
  const u = await umgebung();
  const regel = (pruef, reduz, max, name = 'Neu') => ({ name, pruef_vorlauf_tage: pruef, reduzier_vorlauf_tage: reduz, max_intervall_tage: max });
  const id = await u.gruppeSpeichern(null, regel(3, 3, 1));
  assert.deepEqual(await u.gruppe('Neu'), { id, ...regel(3, 3, 1) });
  const g = await u.gruppe('Molkerei');
  await assert.rejects(u.gruppeSpeichern(g.id, regel(3, 5, 30, 'Molkerei')), /REGEL_UNGUELTIG/);
  await assert.rejects(u.gruppeSpeichern(g.id, regel(-1, 0, 30, 'Molkerei')), /REGEL_UNGUELTIG/);
  await assert.rejects(u.gruppeSpeichern(g.id, regel(3, 2, 0, 'Molkerei')), /REGEL_UNGUELTIG/);
  await assert.rejects(u.gruppeSpeichern(g.id, regel('x', 2, 30, 'Molkerei')), /REGEL_UNGUELTIG/);
  await assert.rejects(u.gruppeSpeichern(g.id, { name: 'Molkerei' }), /REGEL_UNGUELTIG/);
  await assert.rejects(u.gruppeSpeichern(null, regel(5, 3, 30, 'Molkerei')), /NAME_VERGEBEN/);
  await assert.rejects(u.gruppeSpeichern(id, regel(5, 3, 30, 'Molkerei')), /NAME_VERGEBEN/);
  await assert.rejects(u.gruppeSpeichern(null, regel(5, 3, 30, ' ')), /NAME_FEHLT/);
  assert.deepEqual(await u.gruppe('Molkerei'), { id: g.id, ...regel(3, 2, 30, 'Molkerei') });
  const b = await umgebung({ db: u.db, name: 'Markt B', email: 'b@example.com' });
  await assert.rejects(b.gruppeSpeichern(g.id, regel(5, 3, 30, 'Molkerei')), /WARENGRUPPE_UNBEKANNT/);
  assert.deepEqual(await u.gruppe('Molkerei'), { id: g.id, ...regel(3, 2, 30, 'Molkerei') });
});
