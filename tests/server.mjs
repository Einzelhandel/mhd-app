// Lokaler Testserver: die echte Oberfläche (docs/) gegen die echten SQL-Funktionen in PGlite, ohne Cloud-Konto.
// Nachgebildet werden die Dienste, die der Browser anspricht:
//   POST /rest/v1/rpc/<mhd_funktion>   wie PostgREST (benannte Argumente aus dem JSON-Body, Rolle authenticated,
//                                      request.jwt.claims); ohne gültiges Token 401, bevor die Datenbank berührt wird
//   POST /auth/v1/token|logout         wie GoTrue (Konto „demo“, Passwort „test“)
//   GET  /off/api/v2/product/<EAN>     wie Open Food Facts, mit den Demo-Artikeln
//   POST /test/heute, /test/jetzt      setzen mhd.heute() / mhd.jetzt() für Browser-Tests
// Ausgeliefert wird docs/ unter /. Geändert werden nur config.js (SUPABASE_URL, OFF_URL und der Schlüssel
// zeigen auf diesen Server) und im Meta der Content-Security-Policy das Ziel connect-src (→ 'self').
// Der Server hört nur auf 127.0.0.1, weil die /test/*-Adressen ohne Anmeldung arbeiten.
// Aufbau übernommen aus einem früheren eigenen Projekt.
//
// Ausprobieren: npm start → http://127.0.0.1:8123/
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { neueDatenbank } from './helfer.mjs';

const WURZEL = fileURLToPath(new URL('../', import.meta.url));
const DOCS = join(WURZEL, 'docs');
const TYPEN = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};
const KONTO = 'demo';
const EMAIL = 'demo@example.com';
const PASSWORT = 'test';
const LEITUNGS_PIN = '9999';

// PostgREST: SQLSTATE → HTTP-Status (Auszug aus PostgREST/Error.hs, für die hier vorkommenden Codes).
function httpStatus(code, angemeldet) {
  if (!code) return 500;
  if (code === '42501') return angemeldet ? 403 : 401;
  if (code === '42883' || code === '42P01') return 404;
  if (code === '23503' || code === '23505') return 409;
  if (code === 'P0001' || code.startsWith('22') || code.startsWith('23')) return 400;
  if (code === '25006') return 405;
  if (code.startsWith('P0')) return 500;
  if (code.startsWith('42')) return 400; // u. a. 42P13 (Typfehler), 42703
  return 500;
}

const zufall = () => randomBytes(24).toString('hex');

export async function starteServer({ port = 0 } = {}) {
  const db = await neueDatenbank();

  // Alle Datenbankzugriffe hintereinander (PGlite hat eine Verbindung; Rolle und Claims gelten je Transaktion).
  let kette = Promise.resolve();
  const exklusiv = (fn) => {
    const lauf = kette.then(fn);
    kette = lauf.catch(() => {});
    return lauf;
  };

  await db.exec(await readFile(join(WURZEL, 'supabase', 'demo-daten.sql'), 'utf8'));
  await db.query('insert into auth.users (email) values ($1)', [EMAIL]);
  await db.query('select mhd.demo_einrichten($1, $2)', [EMAIL, LEITUNGS_PIN]);

  // Signaturen der öffentlichen mhd_*-Funktionen (wie der Schema-Cache von PostgREST).
  const sig = new Map();
  const r = await db.query(`
    select p.proname as name, p.pronargdefaults::int as defaults, t.typname = 'void' as void,
           coalesce((select json_agg(json_build_object('name', a.n, 'typ', format_type(a.t, null)) order by a.o)
                       from unnest(p.proargnames, p.proargtypes::oid[]) with ordinality as a(n, t, o)), '[]') as args
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_type t on t.oid = p.prorettype
     where n.nspname = 'public' and p.proname like 'mhd\\_%'`);
  for (const f of r.rows) {
    if (!sig.has(f.name)) sig.set(f.name, []);
    sig.get(f.name).push(f);
  }

  async function rpc(funktion, body, nutzer) {
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return { status: 400, json: { code: 'PGRST102', message: 'Nur ein JSON-Objekt als Body unterstützt (Testserver)' } };
    }
    const schluessel = Object.keys(body);
    const kandidaten = (sig.get(funktion) ?? []).filter((f) => {
      const namen = f.args.map((a) => a.name);
      const pflicht = namen.slice(0, namen.length - f.defaults);
      return schluessel.every((k) => namen.includes(k)) && pflicht.every((n) => schluessel.includes(n));
    });
    if (kandidaten.length !== 1) {
      return {
        status: kandidaten.length ? 300 : 404,
        json: {
          code: kandidaten.length ? 'PGRST203' : 'PGRST202',
          message: `Could not find the function public.${funktion}(${[...schluessel].sort().join(', ')}) in the schema cache`,
          details: null, hint: null,
        },
      };
    }
    const f = kandidaten[0];
    const benutzt = f.args.filter((a) => schluessel.includes(a.name));
    const q = (n) => `"${n.replace(/"/g, '""')}"`;
    const aufruf = `public.${q(funktion)}(${benutzt.map((a) => `${q(a.name)} := a.${q(a.name)}`).join(', ')})`;
    const ergebnis = f.void ? aufruf : `to_json(${aufruf})`;
    const sql = benutzt.length
      ? `select ${ergebnis} as r from json_to_recordset($1::json) as a(${benutzt.map((a) => `${q(a.name)} ${a.typ}`).join(', ')})`
      : `select ${ergebnis} as r`;
    try {
      const z = await exklusiv(() => db.transaction(async (tx) => {
        await tx.exec('set local role authenticated');
        await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: nutzer, role: 'authenticated' })]);
        return tx.query(sql, benutzt.length ? [JSON.stringify([body])] : []);
      }));
      if (f.void) return { status: 204, json: null };
      return { status: 200, json: z.rows[0]?.r ?? null };
    } catch (e) {
      return {
        status: httpStatus(e.code, true),
        json: { code: e.code ?? null, message: e.message, details: e.detail ?? null, hint: e.hint ?? null },
      };
    }
  }

  // Auth: undurchsichtige Zufallswerte, im Speicher auf die Nutzer-Id abgebildet.
  const zugriff = new Map(); // access_token → user_id
  const erneuern = new Map(); // refresh_token → user_id (gilt einmal)
  const tokenPaar = (id) => {
    const paar = { access_token: zufall(), refresh_token: zufall() };
    zugriff.set(paar.access_token, id);
    erneuern.set(paar.refresh_token, id);
    return { ...paar, expires_in: 3600, token_type: 'bearer', user: { id, email: EMAIL } };
  };
  const ungueltig = { status: 400, json: { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' } };

  async function anmelden(email, passwort) {
    const text = String(email ?? '').trim().toLowerCase();
    const adresse = text.includes('@') ? text : `${text}@example.com`;
    const z = await exklusiv(() => db.query('select id from auth.users where lower(email) = $1', [adresse]));
    if (!z.rows.length || passwort !== PASSWORT) return ungueltig;
    return { status: 200, json: tokenPaar(z.rows[0].id) };
  }

  // Open Food Facts: die Demo-Artikel mit Strichcode, sonst „nicht gefunden“.
  async function off(ean) {
    const z = await exklusiv(() => db.query(
      `select a.name, a.marke, a.menge from mhd.artikel a join mhd.maerkte m on m.id = a.markt_id
        where m.name = 'Demo-Markt' and a.ean = $1 and a.quelle = 'off'`, [ean]));
    if (!z.rows.length) return { code: ean, status: 0, status_verbose: 'product not found' };
    const { name, marke, menge } = z.rows[0];
    return { code: ean, status: 1, status_verbose: 'product found',
      product: { product_name: name, brands: marke ?? '', quantity: menge ?? '' } };
  }

  async function einstellung(name, wert) {
    await exklusiv(() => db.query('select set_config($1, $2, false)', [name, wert ?? '']));
  }

  async function seite(pfad, host) {
    const datei = normalize(join(DOCS, pfad.endsWith('/') ? `${pfad}index.html` : pfad));
    if (!datei.startsWith(normalize(DOCS) + sep)) return null; // mit Trenner: nicht „docs-alt/…“
    let inhalt;
    try { inhalt = await readFile(datei); } catch { return null; }
    const typ = TYPEN[extname(datei)] ?? 'application/octet-stream';
    if (datei === join(DOCS, 'config.js')) {
      const text = inhalt.toString('utf8');
      const neu = text
        .replace(/export const SUPABASE_URL = [^;]*;/, `export const SUPABASE_URL = 'http://${host}';`)
        .replace(/export const SUPABASE_KEY = [^;]*;/, "export const SUPABASE_KEY = 'lokaler-test-schluessel';")
        .replace(/export const OFF_URL = [^;]*;/, `export const OFF_URL = 'http://${host}/off';`);
      if (neu === text || !neu.includes('/off')) throw new Error('config.js hat sich geändert – Testserver anpassen');
      return { typ, inhalt: neu };
    }
    if (extname(datei) === '.html') {
      const html = inhalt.toString('utf8');
      const neu = html.replace(/connect-src [^;"]*/, "connect-src 'self'");
      if (neu === html && !html.includes("connect-src 'self'")) throw new Error('CSP connect-src fehlt in ' + datei + ' – Testserver anpassen');
      return { typ, inhalt: neu };
    }
    return { typ, inhalt };
  }

  const lesen = (anfrage) => new Promise((ok, fehler) => {
    const teile = [];
    anfrage.on('data', (t) => teile.push(t));
    anfrage.on('end', () => ok(Buffer.concat(teile).toString('utf8')));
    anfrage.on('error', fehler);
  });

  const server = createServer(async (anfrage, antwort) => {
    let url;
    let pfad;
    try {
      url = new URL(anfrage.url, 'http://x');
      pfad = decodeURIComponent(url.pathname);
    } catch { // z. B. „%E0%A4%A“: ungültige Adresse ist ein Fehler der Anfrage, kein Absturz
      antwort.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
      antwort.end('Ungültige Adresse');
      return;
    }
    const senden = ({ status, json }) => {
      if (status === 204) { antwort.writeHead(204); antwort.end(); return; }
      antwort.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      antwort.end(JSON.stringify(json));
    };
    const jsonBody = async () => {
      const text = await lesen(anfrage);
      try { return text ? JSON.parse(text) : {}; } catch { return undefined; }
    };
    const bearer = () => /^Bearer (\S+)$/.exec(anfrage.headers.authorization ?? '')?.[1];
    try {
      if (pfad.startsWith('/rest/v1/rpc/') && anfrage.method === 'POST') {
        const nutzer = zugriff.get(bearer());
        if (!nutzer) { await lesen(anfrage); senden({ status: 401, json: { code: 'PGRST301', message: 'JWT invalid' } }); return; }
        const body = await jsonBody();
        if (body === undefined) { senden({ status: 400, json: { code: 'PGRST102', message: 'Empty or invalid json' } }); return; }
        senden(await rpc(pfad.slice('/rest/v1/rpc/'.length), body, nutzer));
        return;
      }
      if (pfad === '/auth/v1/token' && anfrage.method === 'POST') {
        const body = await jsonBody();
        if (body === undefined) { senden({ status: 400, json: { code: 400, error_code: 'bad_json', msg: 'Invalid JSON' } }); return; }
        if (url.searchParams.get('grant_type') === 'refresh_token') {
          const id = erneuern.get(body.refresh_token);
          erneuern.delete(body.refresh_token); // gilt nur einmal
          senden(id ? { status: 200, json: tokenPaar(id) }
            : { status: 400, json: { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' } });
          return;
        }
        senden(await anmelden(body.email, body.password));
        return;
      }
      if (pfad === '/auth/v1/logout' && anfrage.method === 'POST') {
        await lesen(anfrage);
        const id = zugriff.get(bearer());
        if (id) {
          for (const [t, n] of zugriff) if (n === id) zugriff.delete(t);
          for (const [t, n] of erneuern) if (n === id) erneuern.delete(t);
        }
        senden({ status: 204 });
        return;
      }
      const ean = /^\/off\/api\/v2\/product\/([0-9]+)$/.exec(pfad)?.[1];
      if (ean && anfrage.method === 'GET') { senden({ status: 200, json: await off(ean) }); return; }
      if ((pfad === '/test/heute' || pfad === '/test/jetzt') && anfrage.method === 'POST') {
        // Nur JSON: ein Formular einer fremden Seite löst sonst ohne Rückfrage eine Anfrage aus.
        if (!/^application\/json/.test(anfrage.headers['content-type'] ?? '')) { await lesen(anfrage); senden({ status: 415, json: { message: 'Nur application/json' } }); return; }
        const body = await jsonBody();
        const heute = pfad === '/test/heute';
        const wert = body?.[heute ? 'datum' : 'zeit'] ?? null;
        const gueltig = wert === null || (typeof wert === 'string' && (heute
          ? /^\d{4}-\d{2}-\d{2}$/.test(wert) && !Number.isNaN(Date.parse(wert))
          : /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$/.test(wert) && !Number.isNaN(Date.parse(wert))));
        if (!gueltig) { senden({ status: 400, json: { message: heute ? 'datum: YYYY-MM-DD oder null' : 'zeit: ISO-Zeitpunkt mit Zone oder null' } }); return; }
        await einstellung(heute ? 'mhd.heute' : 'mhd.jetzt', wert);
        senden({ status: 204 });
        return;
      }
      if (anfrage.method === 'GET' || anfrage.method === 'HEAD') {
        const datei = await seite(pfad, anfrage.headers.host ?? `127.0.0.1:${server.address().port}`);
        if (datei) {
          antwort.writeHead(200, { 'content-type': `${datei.typ}; charset=utf-8`, 'cache-control': 'no-store' });
          antwort.end(anfrage.method === 'HEAD' ? undefined : datei.inhalt);
          return;
        }
      }
      antwort.writeHead(404); antwort.end();
    } catch (e) {
      antwort.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      antwort.end(String(e?.message ?? e));
    }
  });
  await new Promise((ok) => server.listen(port, '127.0.0.1', ok));
  const echterPort = server.address().port;

  return {
    url: `http://127.0.0.1:${echterPort}`,
    port: echterPort,
    db,
    stop: async () => { server.closeAllConnections?.(); await new Promise((ok) => server.close(ok)); await db.close(); },
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const s = await starteServer({ port: Number(process.argv[2]) || 0 });
  console.log(`MHD-App lokal: ${s.url}/`);
  console.log(`Anmeldung: Konto „${KONTO}“, Passwort „${PASSWORT}“; Mitarbeiter-PIN 1234 (Anna, Ben), Leitungs-PIN ${LEITUNGS_PIN} (Chef).`);
  console.log('Beenden mit Strg+C.');
}
