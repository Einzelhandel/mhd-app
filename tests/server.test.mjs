// Testserver: Auth- und PostgREST-Nachbildung, Auslieferung von docs/, Open-Food-Facts-Nachbildung, Demo-Daten.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { starteServer } from './server.mjs';
import { als } from './helfer.mjs';

let s;
before(async () => { s = await starteServer(); });
after(async () => { await s.stop(); });

const post = async (pfad, body, token) => {
  const r = await fetch(s.url + pfad, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  return { status: r.status, json: text ? JSON.parse(text) : null };
};
const anmelden = async () => (await post('/auth/v1/token?grant_type=password', { email: 'demo@example.com', password: 'test' })).json;
const rpc = (name, body, token) => post(`/rest/v1/rpc/${name}`, body, token);

test('Server: anmelden, Markt, PIN, Liste mit allen fünf Abschnitten gefüllt', async () => {
  const t = await anmelden();
  assert.equal(t.expires_in, 3600);
  const m = await rpc('mhd_markt', {}, t.access_token);
  assert.equal(m.status, 200);
  assert.equal(m.json.markt.name, 'Demo-Markt');
  assert.deepEqual(m.json.mitarbeiter.map((x) => x.name).sort(), ['Anna', 'Ben', 'Chef']);
  const anna = m.json.mitarbeiter.find((x) => x.name === 'Anna');
  const p = (await rpc('mhd_pin_anmelden', { p_mitarbeiter: anna.id, p_pin: '1234' }, t.access_token)).json;
  assert.equal(p.ok, true);
  const l = (await rpc('mhd_liste', { p_sitzung: p.sitzung }, t.access_token)).json;
  for (const k of ['abgelaufen', 'laeuft_ab', 'pruefen', 'reduzieren', 'ohne_bestand']) assert.ok(l.abschnitte[k].length >= 1, k);
});

test('Demo-Daten: Abschnitte wie geplant, übrige Artikel nirgends fällig, 15 Artikel', async () => {
  const t = await anmelden();
  const m = (await rpc('mhd_markt', {}, t.access_token)).json;
  const anna = m.mitarbeiter.find((x) => x.name === 'Anna');
  const sitzung = (await rpc('mhd_pin_anmelden', { p_mitarbeiter: anna.id, p_pin: '1234' }, t.access_token)).json.sitzung;
  const l = (await rpc('mhd_liste', { p_sitzung: sitzung }, t.access_token)).json;
  const zahlen = Object.fromEntries(Object.entries(l.abschnitte).map(([k, v]) => [k, v.length]));
  assert.deepEqual(zahlen, { abgelaufen: 2, laeuft_ab: 1, pruefen: 2, reduzieren: 2, ohne_bestand: 1 });
  assert.equal((await s.db.query('select count(*)::int as n from mhd.artikel')).rows[0].n, 15);
  assert.equal((await s.db.query('select count(*)::int as n from mhd.artikel where ean is not null')).rows[0].n, 14);
});

test('Server: falsches Passwort 400; RPC ohne Token 401; unbekannte Funktion 404; DB-Fehlercode kommt als message an', async () => {
  const falsch = await post('/auth/v1/token?grant_type=password', { email: 'demo@example.com', password: 'falsch' });
  assert.equal(falsch.status, 400);
  assert.equal(falsch.json.error_code, 'invalid_credentials');
  const unbekannt = await post('/auth/v1/token?grant_type=password', { email: 'niemand@example.com', password: 'test' });
  assert.equal(unbekannt.status, 400);
  assert.equal(unbekannt.json.error_code, 'invalid_credentials');

  assert.equal((await rpc('mhd_markt', {})).status, 401);
  assert.equal((await rpc('mhd_markt', {}, 'gibt-es-nicht')).status, 401);
  const t = await anmelden();
  assert.equal((await rpc('mhd_gibt_es_nicht', {}, t.access_token)).status, 404);
  assert.equal((await rpc('mhd_liste', { p_falsch: 1 }, t.access_token)).status, 404);
  // Eine Funktion außerhalb von mhd_* ist nicht erreichbar.
  assert.equal((await rpc('pg_sleep', { sekunden: 0 }, t.access_token)).status, 404);

  const fehler = await rpc('mhd_liste', { p_sitzung: '00000000-0000-0000-0000-000000000000' }, t.access_token);
  assert.equal(fehler.status, 400);
  assert.equal(fehler.json.message, 'PIN_ABGELAUFEN');
});

test('Server: Refresh-Token gilt einmal und liefert ein neues Paar; Abmelden antwortet 204', async () => {
  const t = await anmelden();
  const neu = await post('/auth/v1/token?grant_type=refresh_token', { refresh_token: t.refresh_token });
  assert.equal(neu.status, 200);
  assert.notEqual(neu.json.refresh_token, t.refresh_token);
  assert.equal((await rpc('mhd_markt', {}, neu.json.access_token)).status, 200);
  assert.equal((await post('/auth/v1/token?grant_type=refresh_token', { refresh_token: t.refresh_token })).status, 400);
  assert.equal((await post('/auth/v1/logout', {}, neu.json.access_token)).status, 204);
});

test('Server liefert docs/ aus: / ist index.html, config.js zeigt auf den Server, CSP connect-src ist self', async () => {
  const index = await fetch(s.url + '/');
  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-type'), /^text\/html/);
  const html = await index.text();
  assert.match(html, /connect-src 'self';/);
  assert.doesNotMatch(html, /supabase\.co|openfoodfacts/);
  assert.match(html, /script-src 'self'/); // übrige CSP bleibt scharf

  const config = await (await fetch(s.url + '/config.js')).text();
  assert.match(config, new RegExp(`SUPABASE_URL = '${s.url}'`));
  assert.match(config, new RegExp(`OFF_URL = '${s.url}/off'`));
  assert.doesNotMatch(config, /DEIN-/);

  const js = await fetch(s.url + '/ean.js');
  assert.match(js.headers.get('content-type'), /^text\/javascript/);
  assert.equal((await fetch(s.url + '/gibt-es-nicht.js')).status, 404);
});

test('Server: Pfade außerhalb von docs/ werden nicht ausgeliefert', async () => {
  const status = (pfad) => new Promise((ok, fehler) => {
    const r = request({ host: '127.0.0.1', port: s.port, path: pfad }, (a) => { a.resume(); ok(a.statusCode); });
    r.on('error', fehler); r.end();
  });
  assert.equal(await status('/%2e%2e/package.json'), 404);
  assert.equal(await status('/..%2fpackage.json'), 404);
  assert.equal(await status('/%2e%2e%2fdocs-alt/x'), 404);
  assert.equal(await status('/%E0%A4%A'), 400);
});

test('GET /off/api/v2/product/<EAN> liefert die Demo-Artikel als Open-Food-Facts-Antwort, sonst status 0', async () => {
  const ok = await (await fetch(s.url + '/off/api/v2/product/4311501646854?fields=product_name')).json();
  assert.equal(ok.status, 1);
  assert.equal(ok.product.product_name, 'Kefir');
  assert.equal(ok.product.quantity, '500 g');
  const nein = await (await fetch(s.url + '/off/api/v2/product/4006381333931')).json();
  assert.equal(nein.status, 0);
});

test('Test-Steuerung: /test/heute und /test/jetzt setzen die Einstellungen und lassen sich aufheben', async () => {
  const frag = async () => (await s.db.query("select mhd.heute()::text as h, (mhd.jetzt() at time zone 'UTC')::text as j")).rows[0];
  const vorher = await frag();
  assert.equal((await post('/test/heute', { datum: '2030-01-15' })).status, 204);
  assert.equal((await post('/test/jetzt', { zeit: '2030-01-15T10:00:00+01:00' })).status, 204);
  const nachher = await frag();
  assert.equal(nachher.h, '2030-01-15');
  assert.match(nachher.j, /^2030-01-15 09:00:00/);
  assert.equal((await post('/test/heute', { datum: 'morgen' })).status, 400);
  assert.equal((await post('/test/heute', { datum: null })).status, 204);
  assert.equal((await post('/test/jetzt', { zeit: null })).status, 204);
  assert.equal((await frag()).h, vorher.h);
  // Nur JSON: ein Formular von einer fremden Seite darf den Server nicht verstellen.
  const r = await fetch(s.url + '/test/heute', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{"datum":"2031-01-01"}' });
  assert.equal(r.status, 415);
});

test('demo_einrichten zweimal: gleiche Artikelzahl, Protokoll neu, Leitungs-PIN unverändert', async () => {
  const zaehle = async () => (await s.db.query(
    `select (select count(*)::int from mhd.artikel) as a, (select count(*)::int from mhd.protokoll) as p,
            (select max(id) from mhd.protokoll) as maxp`)).rows[0];
  const vorher = await zaehle();
  // Ein fremder Markt bleibt unangetastet.
  await s.db.query("insert into auth.users (email) values ('fremd@example.com')");
  const fremd = Number((await s.db.query("select mhd.markt_anlegen('Fremd', 'fremd@example.com', 'Chefin', '4711') as id")).rows[0].id);
  await s.db.query("insert into mhd.artikel (markt_id, name, quelle, ohne_bestand_seit) values ($1, 'Fremdartikel', 'hand', mhd.heute())", [fremd]);
  await s.db.query("insert into mhd.protokoll (markt_id, art) values ($1, 'ruht')", [fremd]);
  // Anna ist gesperrt, Bens PIN geändert.
  await s.db.query("update mhd.mitarbeiter set gesperrt_bis = now() + interval '1 hour', fehlversuche = 3 where name = 'Anna'");
  await s.db.query("update mhd.mitarbeiter set pin_hash = mhd.pin_hash('5555') where name = 'Ben'");
  const chefHash = async () => (await s.db.query("select pin_hash from mhd.mitarbeiter where name = 'Chef' and markt_id <> $1", [fremd])).rows[0].pin_hash;
  const leitungVorher = await chefHash();

  await s.db.query("select mhd.demo_einrichten('demo@example.com')");
  const nachher = await zaehle();
  assert.equal(nachher.a - 1, vorher.a); // plus der Fremdartikel
  assert.equal(nachher.p - 1, vorher.p); // plus die Fremdzeile
  assert.ok(nachher.maxp > vorher.maxp, 'Protokollzeilen sind neu');
  assert.equal((await s.db.query("select count(*)::int as n from mhd.artikel where name = 'Fremdartikel'")).rows[0].n, 1);
  assert.equal((await s.db.query('select count(*)::int as n from mhd.protokoll where markt_id = $1', [fremd])).rows[0].n, 1);
  assert.equal(await chefHash(), leitungVorher);
  const ben = (await s.db.query("select pin_hash = extensions.crypt('1234', pin_hash) as ok from mhd.mitarbeiter where name = 'Ben'")).rows[0];
  assert.equal(ben.ok, true);
  assert.equal((await s.db.query("select count(*)::int as n from mhd.mitarbeiter where name = 'Anna' and gesperrt_bis is null and fehlversuche = 0")).rows[0].n, 1);

  // Mit neuer Leitungs-PIN wird sie gesetzt.
  await s.db.query("select mhd.demo_einrichten('demo@example.com', '8888')");
  const chef = (await s.db.query(
    "select pin_hash = extensions.crypt('8888', pin_hash) as ok from mhd.mitarbeiter where name = 'Chef' and markt_id <> $1", [fremd])).rows[0];
  assert.equal(chef.ok, true);
  // Die Ausnahme für das Protokoll gilt nur innerhalb der Transaktion.
  assert.equal((await s.db.query("select coalesce(current_setting('mhd.demo_reset', true), '') as v")).rows[0].v, '');
});

test('demo_einrichten ist für anon und authenticated nicht aufrufbar', async () => {
  const u = (await s.db.query("select id from auth.users where email = 'demo@example.com'")).rows[0].id;
  for (const rolle of ['anon', 'authenticated']) {
    await assert.rejects(als(s.db, rolle, u, "select mhd.demo_einrichten('demo@example.com')"), /permission denied/);
    const r = await s.db.query(
      "select has_function_privilege($1, 'mhd.demo_einrichten(text, text)', 'execute') as ok", [rolle]);
    assert.equal(r.rows[0].ok, false, rolle);
  }
});

test('demo_einrichten stellt die Warengruppen wieder her; alle fünf Abschnitte sind danach gefüllt', async () => {
  const markt = "(select id from mhd.maerkte where name = 'Demo-Markt')";
  const regel = async (name) => (await s.db.query(
    `select pruef_vorlauf_tage as p, reduzier_vorlauf_tage as r, max_intervall_tage as h
       from mhd.warengruppen where markt_id = ${markt} and name = $1`, [name])).rows[0];
  assert.deepEqual(await regel('Molkerei'), { p: 3, r: 2, h: 30 });
  // Regel ändern, eine Startgruppe löschen, eine eigene Gruppe (mit Artikel) anlegen.
  await s.db.query(`update mhd.warengruppen set pruef_vorlauf_tage = 9, reduzier_vorlauf_tage = 5, max_intervall_tage = 12
                     where markt_id = ${markt} and name = 'Molkerei'`);
  await s.db.query(`delete from mhd.warengruppen where markt_id = ${markt} and name = 'Konserven'`);
  await s.db.query(`insert into mhd.warengruppen (markt_id, name, pruef_vorlauf_tage, reduzier_vorlauf_tage, max_intervall_tage)
                    values (${markt}, 'Eigene Gruppe', 5, 2, 20)`);
  await s.db.query(`insert into mhd.artikel (markt_id, name, quelle, warengruppe_id, ohne_bestand_seit)
                    select ${markt}, 'Eigener Artikel', 'hand', id, mhd.heute() from mhd.warengruppen
                     where markt_id = ${markt} and name = 'Eigene Gruppe'`);
  assert.deepEqual(await regel('Molkerei'), { p: 9, r: 5, h: 12 });

  await s.db.query("select mhd.demo_einrichten('demo@example.com')");

  assert.deepEqual(await regel('Molkerei'), { p: 3, r: 2, h: 30 });
  assert.deepEqual(await regel('Konserven'), { p: 30, r: 14, h: 90 });
  assert.equal(await regel('Eigene Gruppe'), undefined);
  assert.equal((await s.db.query(`select count(*)::int as n from mhd.warengruppen where markt_id = ${markt}`)).rows[0].n, 11);
  const t = await anmelden();
  const anna = (await rpc('mhd_markt', {}, t.access_token)).json.mitarbeiter.find((x) => x.name === 'Anna');
  const sitzung = (await rpc('mhd_pin_anmelden', { p_mitarbeiter: anna.id, p_pin: '1234' }, t.access_token)).json.sitzung;
  const l = (await rpc('mhd_liste', { p_sitzung: sitzung }, t.access_token)).json;
  const zahlen = Object.fromEntries(Object.entries(l.abschnitte).map(([k, v]) => [k, v.length]));
  assert.deepEqual(zahlen, { abgelaufen: 2, laeuft_ab: 1, pruefen: 2, reduzieren: 2, ohne_bestand: 1 });
});

test('Host-Kopf: nur ein unauffälliger Host kommt in config.js, sonst localhost:<port>', async () => {
  const config = (host) => new Promise((ok, fehler) => {
    const r = request({ host: '127.0.0.1', port: s.port, path: '/config.js', headers: { host } }, (a) => {
      let text = '';
      a.on('data', (d) => { text += d; });
      a.on('end', () => ok(text));
    });
    r.on('error', fehler); r.end();
  });
  assert.match(await config('meinrechner.local:8123'), /SUPABASE_URL = 'http:\/\/meinrechner\.local:8123'/);
  for (const boese of ["x';alert(1);//", 'a b', "evil.example/'", 'a:b']) {
    const text = await config(boese);
    assert.match(text, new RegExp(`SUPABASE_URL = 'http://localhost:${s.port}'`), boese);
    assert.match(text, new RegExp(`OFF_URL = 'http://localhost:${s.port}/off'`), boese);
    assert.doesNotMatch(text, /alert|evil/, boese);
  }
});
