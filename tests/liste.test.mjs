// Liste „Heute“ und Aktionen: Abschnitte, Termine, Protokoll.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { neueDatenbank, json, heuteSetzen, markt, pin } from './helfer.mjs';

// Markt mit Leitung und einem gewöhnlichen Mitarbeiter; liefert Helfer für Tests.
async function umgebung({ name = 'Markt A', email = 'a@example.com', db = null } = {}) {
  db ??= await neueDatenbank();
  await heuteSetzen(db, '2026-11-10');
  const m = await markt(db, { name, email, leitung: 'Chef', pin: '4711' });
  await db.query("insert into mhd.mitarbeiter (markt_id, name, rolle, pin_hash) values ($1, 'Berta', 'mitarbeiter', mhd.pin_hash('1234'))", [m.marktId]);
  const b = await db.query("select id from mhd.mitarbeiter where markt_id = $1 and name = 'Berta'", [m.marktId]);
  const sitzung = await pin(db, m.userId, Number(b.rows[0].id), '1234');
  const chef = await pin(db, m.userId, m.leitungId, '4711');
  const gruppen = await json(db, m.userId, 'select public.mhd_warengruppen($1) as r', [sitzung]);
  const gruppe = (n) => gruppen.find((g) => g.name === n).id;
  let zaehler = 0;
  const u = {
    db, m, sitzung, chef,
    tag: (d) => heuteSetzen(db, d),
    neu: async (name, { gruppeName = 'Molkerei', platz = '' } = {}) => {
      zaehler += 1;
      const ean = `40123456${String(zaehler).padStart(5, '0')}`;
      const a = await json(db, m.userId, 'select public.mhd_artikel_speichern($1, null, $2::jsonb) as r',
        [sitzung, JSON.stringify({ ean, name, platz, warengruppe_id: gruppe(gruppeName), quelle: 'hand' })]);
      return a.id;
    },
    aktion: (id, art, mhd = null, s = sitzung) =>
      json(db, m.userId, 'select public.mhd_aktion($1, $2, $3, $4::date) as r', [s, id, art, mhd]),
    liste: (s = sitzung) => json(db, m.userId, 'select public.mhd_liste($1) as r', [s]),
    zeile: async (id) => (await db.query('select * from mhd.artikel where id = $1', [id])).rows[0],
  };
  // Liefert [Schlüssel des Abschnitts in mhd_liste, versaeumt]; der Artikel steht in höchstens einem Abschnitt.
  u.wo = async (id) => {
    const l = await u.liste();
    const treffer = Object.entries(l.abschnitte).filter(([, arr]) => arr.some((x) => x.id === id));
    assert.ok(treffer.length <= 1, `Artikel ${id} steht in mehreren Abschnitten: ${treffer.map(([k]) => k)}`);
    if (treffer.length === 0) return [null, null];
    return [treffer[0][0], treffer[0][1].find((x) => x.id === id).versaeumt];
  };
  return u;
}

test('Beispiel aus dem Entwurf: Molkerei 3/2, MHD 20.11.2026', async () => {
  const { tag, aktion, wo, neu } = await umgebung();
  const a = await neu('Vollmilch');
  await tag('2026-11-10'); await aktion(a, 'geprueft', '2026-11-20');
  await tag('2026-11-16'); assert.deepEqual(await wo(a), [null, null]);
  await tag('2026-11-17'); assert.deepEqual(await wo(a), ['pruefen', null]);
  await aktion(a, 'geprueft', '2026-11-20');
  await tag('2026-11-18'); assert.deepEqual(await wo(a), ['reduzieren', null]);
  await tag('2026-11-19'); assert.deepEqual(await wo(a), ['abgelaufen', 'reduzieren']);   // versäumt, bleibt stehen
  await tag('2026-11-20'); assert.deepEqual(await wo(a), ['abgelaufen', 'reduzieren']);
  await aktion(a, 'reduziert');
  assert.deepEqual(await wo(a), [null, null]);            // am MHD-Tag erledigt …
  await tag('2026-11-21'); assert.deepEqual(await wo(a), ['abgelaufen', 'abgelaufen']);   // … aber Ware blieb im Regal
  await tag('2026-12-24'); assert.deepEqual(await wo(a), ['abgelaufen', 'abgelaufen']);   // fällt nie still weg
  await aktion(a, 'aussortiert'); assert.deepEqual(await wo(a), [null, null]);
});

test('Abschnitt "laeuft_ab" und seit_tagen bei versäumtem Termin', async () => {
  const { tag, aktion, liste, neu } = await umgebung();
  const a = await neu('Joghurt');
  const b = await neu('Pudding');
  await aktion(b, 'geprueft', '2026-11-20');                    // Prüfen am 17.11. wird nicht erledigt
  await tag('2026-11-18'); await aktion(a, 'geprueft', '2026-11-20');
  await tag('2026-11-19');
  let l = await liste();
  assert.deepEqual(l.abschnitte.abgelaufen.map((x) => [x.id, x.versaeumt, x.seit_tagen]), [[b, 'pruefen', 2]]);
  await tag('2026-11-20');
  l = await liste();
  assert.deepEqual(l.abschnitte.laeuft_ab.map((x) => [x.id, x.seit_tagen]), [[a, null]]);
  assert.deepEqual(l.abschnitte.abgelaufen.map((x) => [x.id, x.versaeumt, x.seit_tagen]), [[b, 'pruefen', 3]]);
  assert.equal(l.heute, '2026-11-20');
  assert.deepEqual(Object.keys(l.abschnitte).sort(), ['abgelaufen', 'laeuft_ab', 'ohne_bestand', 'pruefen', 'reduzieren']);
  await tag('2026-11-21');
  l = await liste();
  assert.deepEqual(l.abschnitte.abgelaufen.map((x) => [x.id, x.versaeumt, x.seit_tagen]).sort(), [[a, 'abgelaufen', 1], [b, 'abgelaufen', 1]].sort());
});

test('rechtzeitig reduziert: 18.11. reduziert → 19.11. nichts, 20.11. laeuft_ab', async () => {
  const { tag, aktion, wo, neu } = await umgebung();
  const a = await neu('Quark');
  await aktion(a, 'geprueft', '2026-11-20');
  await tag('2026-11-18'); await aktion(a, 'reduziert');
  assert.deepEqual(await wo(a), [null, null]);
  await tag('2026-11-19'); assert.deepEqual(await wo(a), [null, null]);
  await tag('2026-11-20'); assert.deepEqual(await wo(a), ['laeuft_ab', null]);
});

test('früh reduziert (17.11.) überspringt den Reduzier-Termin: 18.11. nichts, 20.11. laeuft_ab', async () => {
  const { tag, aktion, wo, neu } = await umgebung();
  const a = await neu('Butter');
  await aktion(a, 'geprueft', '2026-11-20');
  await tag('2026-11-17'); await aktion(a, 'reduziert');
  await tag('2026-11-18'); assert.deepEqual(await wo(a), [null, null]);
  await tag('2026-11-19'); assert.deepEqual(await wo(a), [null, null]);
  await tag('2026-11-20'); assert.deepEqual(await wo(a), ['laeuft_ab', null]);
});

test('neues MHD löscht den Reduziert-Vermerk, gleiches MHD behält ihn', async () => {
  const { aktion, zeile, neu } = await umgebung();
  const a = await neu('Sahne');
  await aktion(a, 'geprueft', '2026-11-20');
  await aktion(a, 'reduziert');
  assert.equal((await zeile(a)).reduziert, true);
  const gleich = await aktion(a, 'geprueft', '2026-11-20');
  assert.equal(gleich.reduziert, true);
  const anders = await aktion(a, 'geprueft', '2026-11-25');
  assert.equal(anders.reduziert, false);
  assert.equal((await zeile(a)).reduziert, false);
});

test('abgelaufenes MHD eingegeben: sofort abschnitt abgelaufen, seit_tagen stimmt', async () => {
  const { tag, aktion, wo, liste, neu } = await umgebung();
  const a = await neu('Kefir');
  await tag('2026-11-14');
  const r = await aktion(a, 'geprueft', '2026-11-11');
  assert.equal(r.abschnitt, 'abgelaufen');
  assert.equal(r.versaeumt, 'abgelaufen');
  assert.equal(r.seit_tagen, 3);
  assert.deepEqual(await wo(a), ['abgelaufen', 'abgelaufen']);
  assert.equal((await liste()).abschnitte.abgelaufen[0].seit_tagen, 3);
});

test('Höchstabstand: MHD in 200 Tagen, 30 Tage nach der Prüfung unter pruefen', async () => {
  const { tag, aktion, wo, neu } = await umgebung();
  const a = await neu('Haltbarmilch');
  await tag('2026-11-14'); await aktion(a, 'geprueft', '2027-06-02');
  await tag('2026-12-13'); assert.deepEqual(await wo(a), [null, null]);
  await tag('2026-12-14'); assert.deepEqual(await wo(a), ['pruefen', null]);
  await tag('2026-12-15'); assert.deepEqual(await wo(a), ['abgelaufen', 'pruefen']);
});

test('neu angelegt, MHD noch nie gespeichert: sofort unter ohne_bestand mit „mhd_fehlt“, nach geprueft weg', async () => {
  const { tag, aktion, wo, neu, liste } = await umgebung();
  await tag('2026-11-14');
  const a = await neu('Ayran');                                   // Mitarbeiter bricht vor „MHD speichern“ ab
  assert.deepEqual(await wo(a), ['ohne_bestand', 'mhd_fehlt']);
  assert.equal((await liste()).abschnitte.ohne_bestand.find((x) => x.id === a).seit_tagen, 0);
  await tag('2026-11-20');
  assert.deepEqual(await wo(a), ['ohne_bestand', 'mhd_fehlt']);  // bleibt stehen, bis jemand das MHD speichert
  assert.equal((await liste()).abschnitte.ohne_bestand.find((x) => x.id === a).seit_tagen, 6);
  const r = await aktion(a, 'geprueft', '2026-12-20');
  assert.equal(r.versaeumt, null);
  assert.deepEqual(await wo(a), [null, null]);
});

test('neu angelegt, MHD nie gespeichert: ruht nimmt ihn von der Liste, geprueft holt ihn zurück', async () => {
  const { tag, aktion, wo, zeile, neu, db } = await umgebung();
  await tag('2026-11-14');
  const a = await neu('Ayran');
  assert.deepEqual(await wo(a), ['ohne_bestand', 'mhd_fehlt']);
  const r = await aktion(a, 'ruht');
  assert.equal(r.aktiv, false);
  assert.deepEqual(await wo(a), [null, null]);
  assert.equal((await zeile(a)).aktiv, false);
  const protokoll = (await db.query('select art from mhd.protokoll where artikel_id = $1', [a])).rows;
  assert.deepEqual(protokoll.map((p) => p.art), ['ruht']);
  const z = await aktion(a, 'geprueft', '2026-12-20');
  assert.equal(z.aktiv, true);
  assert.equal(z.bestand, true);
});

test('Demo-Daten: weiterhin alle fünf Abschnitte gefüllt, kein Artikel mit „mhd_fehlt“', async () => {
  const db = await neueDatenbank();
  await heuteSetzen(db, '2026-11-16');
  await db.exec(readFileSync(new URL('../supabase/demo-daten.sql', import.meta.url), 'utf8'));
  const konto = (await db.query("insert into auth.users (email) values ('demo@example.com') returning id")).rows[0].id;
  await db.query("select mhd.demo_einrichten('demo@example.com', '9999')");
  const anna = Number((await db.query("select id from mhd.mitarbeiter where name = 'Anna'")).rows[0].id);
  const l = await json(db, konto, 'select public.mhd_liste($1) as r', [await pin(db, konto, anna, '1234')]);
  const zahlen = Object.fromEntries(Object.entries(l.abschnitte).map(([k, v]) => [k, v.length]));
  assert.deepEqual(zahlen, { abgelaufen: 2, laeuft_ab: 1, pruefen: 2, reduzieren: 2, ohne_bestand: 1 });
  assert.equal(Object.values(l.abschnitte).flat().filter((x) => x.versaeumt === 'mhd_fehlt').length, 0);
});

test('ohne Bestand: nach dem Prüf-Vorlauf (3 Tage) ohne_bestand; "ohne_bestand" stellt die Frage neu; "ruht" entfernt; geprueft holt zurück', async () => {
  const { tag, aktion, wo, zeile, neu, liste } = await umgebung();
  await tag('2026-11-14');
  const a = await neu('Skyr');
  await aktion(a, 'geprueft', '2026-11-20');
  await aktion(a, 'aussortiert');                                 // kein Bestand gemeldet, ohne_bestand_seit = 14.11.
  assert.deepEqual(await wo(a), [null, null]);
  await tag('2026-11-15'); assert.deepEqual(await wo(a), [null, null]);
  await tag('2026-11-16'); assert.deepEqual(await wo(a), [null, null]);
  await tag('2026-11-17'); assert.deepEqual(await wo(a), ['ohne_bestand', null]);
  assert.equal((await liste()).abschnitte.ohne_bestand[0].seit_tagen, 3);
  assert.equal((await liste()).abschnitte.ohne_bestand[0].versaeumt, null);
  await aktion(a, 'ohne_bestand');                                // „weiter ohne Bestand“ ab 17.11.
  assert.deepEqual(await wo(a), [null, null]);
  await tag('2026-11-19'); assert.deepEqual(await wo(a), [null, null]);
  await tag('2026-11-20'); assert.deepEqual(await wo(a), ['ohne_bestand', null]);
  const r = await aktion(a, 'ruht');
  assert.equal(r.aktiv, false);
  assert.deepEqual(await wo(a), [null, null]);
  await tag('2027-06-01'); assert.deepEqual(await wo(a), [null, null]);
  const z = await aktion(a, 'geprueft', '2027-06-20');            // „wieder da“ / Scan holt zurück
  assert.equal(z.aktiv, true);
  assert.equal(z.bestand, true);
  assert.equal((await zeile(a)).ohne_bestand_seit, null);
  assert.deepEqual(await wo(a), [null, null]);                    // Termin 17.06.
  await tag('2027-06-17'); assert.deepEqual(await wo(a), ['pruefen', null]);
});

// Warengruppe mit frei gewählten Vorlauf-Werten (direkt in der Tabelle), Artikel ohne Bestand seit dem 14.11.
async function ohneBestandMitGruppe(pruef, reduzier, max) {
  const u = await umgebung();
  await u.tag('2026-11-14');
  await u.db.query(
    'insert into mhd.warengruppen (markt_id, name, pruef_vorlauf_tage, reduzier_vorlauf_tage, max_intervall_tage) values ($1, $2, $3, $4, $5)',
    [u.m.marktId, 'Testgruppe', pruef, reduzier, max]);
  const a = await u.neu('Testartikel', { gruppeName: 'Molkerei' });
  const g = (await u.db.query("select id from mhd.warengruppen where markt_id = $1 and name = 'Testgruppe'", [u.m.marktId])).rows[0].id;
  await u.db.query('update mhd.artikel set warengruppe_id = $1 where id = $2', [g, a]);
  await u.aktion(a, 'geprueft', '2026-11-20');
  await u.aktion(a, 'aussortiert');
  return { ...u, a };
}

test('ohne Bestand: Prüf-Vorlauf 0 -> Nachfrage nach einem Tag', async () => {
  const { tag, wo, a } = await ohneBestandMitGruppe(0, 0, 30);
  assert.deepEqual(await wo(a), [null, null]);
  await tag('2026-11-15'); assert.deepEqual(await wo(a), ['ohne_bestand', null]);
});

test('ohne Bestand: Prüf-Vorlauf 30, Höchstabstand 14 -> Nachfrage nach 14 Tagen', async () => {
  const { tag, wo, a } = await ohneBestandMitGruppe(30, 3, 14);
  await tag('2026-11-27'); assert.deepEqual(await wo(a), [null, null]);
  await tag('2026-11-28'); assert.deepEqual(await wo(a), ['ohne_bestand', null]);
});

test('ohne Bestand: ohne Warengruppe gelten 7/3/30 -> Nachfrage nach 7 Tagen', async () => {
  const { tag, wo, a, db } = await ohneBestandMitGruppe(3, 2, 30);
  await db.query('update mhd.artikel set warengruppe_id = null where id = $1', [a]);
  await tag('2026-11-20'); assert.deepEqual(await wo(a), [null, null]);
  await tag('2026-11-21'); assert.deepEqual(await wo(a), ['ohne_bestand', null]);
});

test('"ruht" nur ohne Bestand: abgelaufener Artikel mit Bestand bleibt auf der Liste', async () => {
  const { tag, aktion, wo, neu, db } = await umgebung();
  const a = await neu('Sauerrahm');
  await aktion(a, 'geprueft', '2026-11-12');
  await tag('2026-11-14');
  assert.deepEqual(await wo(a), ['abgelaufen', 'abgelaufen']);
  const vorher = (await db.query('select count(*)::int as n from mhd.protokoll')).rows[0].n;
  await assert.rejects(aktion(a, 'ruht'), /BESTAND_VORHANDEN/);
  assert.deepEqual(await wo(a), ['abgelaufen', 'abgelaufen']);
  assert.equal((await db.query('select count(*)::int as n from mhd.protokoll')).rows[0].n, vorher);
  await aktion(a, 'aussortiert');
  const r = await aktion(a, 'ruht');
  assert.equal(r.aktiv, false);
  assert.deepEqual(await wo(a), [null, null]);
});

test('aussortiert mit neuem MHD: Bestand bleibt, Termin nach neuem MHD', async () => {
  const { tag, aktion, wo, neu } = await umgebung();
  const a = await neu('Frischkäse');
  await aktion(a, 'geprueft', '2026-11-30');
  await aktion(a, 'reduziert');
  await tag('2026-11-27');
  const r = await aktion(a, 'aussortiert', '2026-12-10');
  assert.equal(r.bestand, true);
  assert.equal(r.mhd, '2026-12-10');
  assert.equal(r.reduziert, false);
  await tag('2026-12-06'); assert.deepEqual(await wo(a), [null, null]);
  await tag('2026-12-07'); assert.deepEqual(await wo(a), ['pruefen', null]);
});

test('aussortiert ohne MHD: kein Bestand, MHD leer, ohne_bestand_seit heute', async () => {
  const { tag, aktion, zeile, neu } = await umgebung();
  const a = await neu('Pudding');
  await aktion(a, 'geprueft', '2026-11-20');
  await tag('2026-11-21');
  const r = await aktion(a, 'aussortiert');
  assert.equal(r.bestand, false);
  assert.equal(r.mhd, null);
  const z = await zeile(a);
  assert.equal(z.ohne_bestand_seit.toISOString().slice(0, 10), '2026-11-21');
  assert.equal(z.letzte_aktion_am.toISOString().slice(0, 10), '2026-11-21');
});

test('reduziert ohne Bestand → KEIN_BESTAND; geprueft ohne MHD → MHD_FEHLT; Artikel fremder Markt → ARTIKEL_UNBEKANNT', async () => {
  const u = await umgebung();
  const a = await u.neu('Eier');
  await assert.rejects(u.aktion(a, 'reduziert'), /KEIN_BESTAND/);
  await assert.rejects(u.aktion(a, 'geprueft'), /MHD_FEHLT/);
  await assert.rejects(u.aktion(a, 'umpacken'), /AKTION_UNGUELTIG/);
  await assert.rejects(u.aktion(a, null), /AKTION_UNGUELTIG/);
  await u.aktion(a, 'geprueft', '2026-11-20');
  await assert.rejects(u.aktion(a, 'ohne_bestand'), /BESTAND_VORHANDEN/);
  await assert.rejects(u.aktion(999999, 'ruht'), /ARTIKEL_UNBEKANNT/);
  const b = await umgebung({ db: u.db, name: 'Markt B', email: 'b@example.com' });
  await assert.rejects(b.aktion(a, 'geprueft', '2026-11-20'), /ARTIKEL_UNBEKANNT/);
  assert.equal((await u.zeile(a)).mhd.toISOString().slice(0, 10), '2026-11-20');
});

test('Protokoll: je Aktion eine Zeile mit Mitarbeiter, altem und neuem MHD', async () => {
  const u = await umgebung();
  const a = await u.neu('Käse');
  await u.aktion(a, 'geprueft', '2026-11-20');
  await u.aktion(a, 'reduziert');
  await u.aktion(a, 'geprueft', '2026-11-25');
  await u.aktion(a, 'aussortiert');
  const p = (await u.db.query(`
    select p.art, p.mhd_alt::text as alt, p.mhd_neu::text as neu, m.name
      from mhd.protokoll p join mhd.mitarbeiter m on m.id = p.mitarbeiter_id
     where p.artikel_id = $1 order by p.id`, [a])).rows;
  assert.deepEqual(p.map((r) => [r.art, r.alt, r.neu, r.name]), [
    ['geprueft', null, '2026-11-20', 'Berta'],
    ['reduziert', '2026-11-20', '2026-11-20', 'Berta'],
    ['geprueft', '2026-11-20', '2026-11-25', 'Berta'],
    ['aussortiert', '2026-11-25', null, 'Berta'],
  ]);
  await assert.rejects(u.db.query("insert into mhd.protokoll (markt_id, art) values ($1, 'gegessen')", [u.m.marktId]), /protokoll_art_check/);
});

test('zwei Mitarbeiter nacheinander am selben Artikel: letzter Stand gilt, zwei Protokollzeilen', async () => {
  const u = await umgebung();
  const a = await u.neu('Rahm');
  await u.aktion(a, 'geprueft', '2026-11-20', u.sitzung);
  const r = await u.aktion(a, 'geprueft', '2026-11-22', u.chef);
  assert.equal(r.mhd, '2026-11-22');
  assert.equal((await u.zeile(a)).mhd.toISOString().slice(0, 10), '2026-11-22');
  const p = (await u.db.query(`
    select m.name from mhd.protokoll p join mhd.mitarbeiter m on m.id = p.mitarbeiter_id
     where p.artikel_id = $1 order by p.id`, [a])).rows.map((x) => x.name);
  assert.deepEqual(p, ['Berta', 'Chef']);
});

test('Sortierung im Abschnitt: Platz, leere Plätze zuletzt, dann Name', async () => {
  const u = await umgebung();
  const ids = {
    ohnePlatzA: await u.neu('Anton'),
    b2: await u.neu('Zora', { platz: 'B2' }),
    a1z: await u.neu('Zebra', { platz: 'A1' }),
    a1a: await u.neu('apfel', { platz: 'A1' }),
    ohnePlatzM: await u.neu('Moritz'),
  };
  for (const id of Object.values(ids)) await u.aktion(id, 'geprueft', '2026-11-20');
  await u.tag('2026-11-17');
  const l = await u.liste();
  assert.deepEqual(l.abschnitte.pruefen.map((x) => x.id),
    [ids.a1a, ids.a1z, ids.b2, ids.ohnePlatzA, ids.ohnePlatzM]);
});

test('Liste zeigt nur den eigenen Markt', async () => {
  const a = await umgebung();
  const b = await umgebung({ db: a.db, name: 'Markt B', email: 'b@example.com' });
  const x = await a.neu('Milch A');
  const y = await b.neu('Milch B');
  await a.aktion(x, 'geprueft', '2026-11-20');
  await b.aktion(y, 'geprueft', '2026-11-20');
  await a.tag('2026-11-17');
  assert.deepEqual((await a.liste()).abschnitte.pruefen.map((r) => r.id), [x]);
  assert.deepEqual((await b.liste()).abschnitte.pruefen.map((r) => r.id), [y]);
  await assert.rejects(json(a.db, a.m.userId, 'select public.mhd_liste($1) as r', ['00000000-0000-0000-0000-000000000000']), /PIN_ABGELAUFEN/);
});
