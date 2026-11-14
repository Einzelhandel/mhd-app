// Durchklick-Test: die echte Oberfläche (docs/) in Chrome oder Edge headless, als Handy 390 x 844 mit Touch, gegen die
// echten SQL-Funktionen (PGlite im Testserver tests/server.mjs). Jedes Szenario prüft Oberfläche und Datenbankstand,
// macht Fotos (tests/browser/fotos/, nicht im Repo) und sammelt Konsolenfehler und CSP-Verstöße; ein Fehlschlag
// hält den Lauf nicht an.
// Start: npm run test:browser [Filter]   (Filter: Teil des Szenario-Namens; ein gefilterter Lauf gibt dasselbe Ergebnis)
// Ergebnis: eine Zeile je Szenario, die Zählung am Ende und tests/browser/fotos/ergebnis.json; Exit-Code 1 bei Fehlern.
// Aufbau übernommen aus einem früheren eigenen Projekt.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { starteServer } from '../server.mjs';
import { starteBrowser, BROWSER } from './cdp.mjs';
import { baueRahmen, NETZ_ZAEHLER } from './rahmen.mjs';
import anmeldung from './szenarien-anmeldung.mjs';
import liste from './szenarien-liste.mjs';
import leitung from './szenarien-leitung.mjs';
import verlauf from './szenarien-verlauf.mjs';
import verbindung from './szenarien-verbindung.mjs';
import kamera from './szenarien-kamera.mjs';

if (!BROWSER) {
  console.error('Kein Chrome oder Edge gefunden. Der Browser-Test braucht einen von beiden (Chrome, Chromium oder Edge).');
  process.exit(3);
}

const FOTOS = fileURLToPath(new URL('./fotos/', import.meta.url));
const filter = (process.argv[2] ?? '').toLowerCase();
const GRENZE_MS = 120000;

const alle = [...anmeldung, ...liste, ...leitung, ...verlauf, ...verbindung, ...kamera].sort((a, b) => a.nr - b.nr);
const gewaehlt = alle.filter((x) => !filter || x.name.toLowerCase().includes(filter));
if (!gewaehlt.length) {
  console.error(`Kein Szenario passt zum Filter „${filter}“.`);
  process.exit(2);
}

rmSync(FOTOS, { recursive: true, force: true });
mkdirSync(FOTOS, { recursive: true });

const s = await starteServer();
const c = await starteBrowser();
const notAus = (e) => { console.error(e); c.notAus(); process.exit(2); };
process.on('uncaughtException', notAus);
process.on('unhandledRejection', notAus);

await c.sende('Page.addScriptToEvaluateOnNewDocument', { source: NETZ_ZAEHLER });

const h = baueRahmen({ s, c });
const ergebnisse = [];
const zeile = (x) => `${String(x.nr).padStart(2, '0')} ${x.name}`;

for (const sz of gewaehlt) {
  h.fehler = []; h.notizen = []; h.pruefungen = 0; h.fotos = [];
  const slug = `${String(sz.nr).padStart(2, '0')}-${sz.name.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50)}`;
  h.fotoVorsatz = `${FOTOS}${slug}`;
  const ergebnis = { nr: sz.nr, name: sz.name, fehler: h.fehler, notizen: h.notizen, konsole: [], fotos: [] };
  const vonProtokoll = c.protokoll.length;
  const t0 = Date.now();
  let uhr;
  try {
    await Promise.race([
      sz.lauf(h),
      new Promise((_, nein) => { uhr = setTimeout(() => nein(new Error(`Zeitüberschreitung nach ${GRENZE_MS / 1000} s`)), GRENZE_MS); }),
    ]);
  } catch (e) {
    h.fehler.push(`Abbruch: ${e.message}`);
  } finally { clearTimeout(uhr); }
  try { await h.ruhe(); } catch { /* Seite evtl. schon weg */ }
  try { await h.foto('ende'); } catch (e) { h.notizen.push(`Foto fehlgeschlagen: ${e.message}`); }

  // Konsole: alles Neue ist ein Fehler, außer den Fachfehlern, die das Szenario ausdrücklich erwartet (und die dann auch kommen müssen).
  const neu = (await c.protokollFertig()).slice(vonProtokoll);
  const gesehen = new Set();
  for (const e of neu) {
    const passt = (sz.erlaubt ?? []).findIndex((x) => e.art === 'http' && e.status === x.status
      && (x.fehler === undefined || e.fehler === x.fehler) && (!x.url || e.url.includes(x.url)));
    if (passt >= 0) { gesehen.add(passt); h.notizen.push(`erwartet: ${e.status} ${e.fehler ?? ''} ${e.url}`); } else ergebnis.konsole.push(`${e.art}: ${e.text}`);
  }
  (sz.erlaubt ?? []).forEach((x, i) => { if (!gesehen.has(i)) h.fehler.push(`Erwarteter Fehler blieb aus: ${JSON.stringify(x)}`); });
  if (c.dialoge.length) h.fehler.push(`Die Seite hat ${c.dialoge.length} Dialog(e) geöffnet: ${c.dialoge.map((d) => d.message).join(' | ')}`);
  if (h.pruefungen === 0) h.fehler.push('Das Szenario hat nichts geprüft');

  ergebnis.pruefungen = h.pruefungen;
  ergebnis.fotos = h.fotos;
  ergebnis.dauer_ms = Date.now() - t0;
  ergebnis.ok = ergebnis.fehler.length === 0 && ergebnis.konsole.length === 0;
  ergebnisse.push(ergebnis);
  console.log(`${ergebnis.ok ? 'ok     ' : 'FEHLER '} ${zeile(sz)} (${ergebnis.pruefungen} Prüfungen, ${ergebnis.dauer_ms} ms)`);
  for (const f of ergebnis.fehler) console.log(`          - ${f}`);
  for (const k of ergebnis.konsole) console.log(`          ! Konsole: ${k}`);
  for (const n of ergebnis.notizen) console.log(`          . ${n}`);
}

const ok = ergebnisse.filter((e) => e.ok).length;
const saubere = ergebnisse.filter((e) => e.konsole.length === 0).length;
console.log(`\n${ok} von ${ergebnisse.length} Szenarien bestanden; Konsole ohne Fehler und ohne CSP-Verstoß in ${saubere} von ${ergebnisse.length}.`);
writeFileSync(`${FOTOS}ergebnis.json`, JSON.stringify({ ergebnisse }, null, 1));
await c.schliessen();
await s.stop();
process.exitCode = ok === ergebnisse.length ? 0 : 1;
