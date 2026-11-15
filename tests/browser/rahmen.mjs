// Gemeinsamer Rahmen der Browser-Szenarien: feste Uhr, Zurücksetzen der Demo-Daten, Anmelden über die
// Oberfläche, Lesen der Seite und Abfragen der Datenbank. Jedes Szenario beginnt mit start() oder
// alsMitarbeiter() und hängt dadurch weder von der Uhr noch von einem früheren Szenario ab.
// Aufbau übernommen aus einem früheren eigenen Projekt.
import { json, pin as pinAnmelden } from '../helfer.mjs';

// Feste Uhr: alle Szenarien laufen an diesem Tag und zu dieser Uhrzeit (Winterzeit, Europe/Berlin).
export const HEUTE = '2026-11-16';
export const JETZT = '2026-11-16T09:00:00+01:00';
export const EMAIL = 'demo@example.com';
// ISO-Zeitpunkt n Minuten nach JETZT
export const jetztPlus = (minuten) => new Date(Date.parse(JETZT) + minuten * 60000).toISOString();

// ISO-Datum n Tage nach `von`.
export const tag = (n, von = HEUTE) => new Date(Date.parse(`${von}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
// So tippt man es ins Feld: '2026-12-16' → '16.12.26'
export const eingabe = (isoDatum) => `${isoDatum.slice(8, 10)}.${isoDatum.slice(5, 7)}.${isoDatum.slice(2, 4)}`;

// Zählt laufende Anfragen der Seite („Netz ruhig“, h.ruhe); wird vor jedem Laden einer Seite eingespielt:
// c.sende('Page.addScriptToEvaluateOnNewDocument', { source: NETZ_ZAEHLER }).
export const NETZ_ZAEHLER = `(() => {
  window.__offen = 0; const f = window.fetch.bind(window);
  window.fetch = (...a) => { window.__offen++; return f(...a).finally(() => { window.__offen--; }); };
  // Merkt sich die Minutentakte der App, damit ein Szenario den Takt von Hand auslösen kann (ohne 60 Sekunden zu warten).
  window.__takte = []; const si = window.setInterval.bind(window);
  window.setInterval = (fn, ms, ...r) => { if (ms === 60000) window.__takte.push(fn); return si(fn, ms, ...r); };
})();`;

export function baueRahmen({ s, c }) {
  const h = { s, c, fehler: [], notizen: [], pruefungen: 0, fotoVorsatz: '', fotos: [] };

  // ---- Prüfen: sammelt Fehler, damit ein Szenario alle Abweichungen zeigt und nicht nur die erste.
  h.pruefe = (bedingung, text, ist) => {
    h.pruefungen += 1;
    if (!bedingung) h.fehler.push(ist === undefined ? text : `${text} — ist: ${typeof ist === 'string' ? ist : JSON.stringify(ist)}`);
    return Boolean(bedingung);
  };
  h.gleich = (ist, soll, text) => h.pruefe(JSON.stringify(ist) === JSON.stringify(soll),
    `${text}: erwartet ${JSON.stringify(soll)}`, ist);
  h.notiz = (text) => h.notizen.push(text);
  h.foto = async (name) => {
    const datei = `${h.fotoVorsatz}-${name}.png`;
    await c.foto(datei);
    h.fotos.push(datei);
  };

  // ---- Uhr und Datenbank
  h.post = async (pfad, body) => {
    const r = await fetch(s.url + pfad, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (r.status !== 204) throw new Error(`POST ${pfad} → ${r.status}`);
  };
  h.setzeHeute = (datum) => h.post('/test/heute', { datum });
  h.setzeJetzt = (zeit) => h.post('/test/jetzt', { zeit });
  h.sql = async (text, parameter = []) => (await s.db.query(text, parameter)).rows;
  h.eins = async (text, parameter = []) => (await h.sql(text, parameter))[0];

  h.zuruecksetzen = async () => {
    s.verzoegere(0);
    await h.setzeHeute(HEUTE);
    await h.setzeJetzt(JETZT);
    await h.sql('select mhd.demo_einrichten($1)', [EMAIL]);
    await h.sql('delete from mhd.sitzungen');
    c.dialoge.length = 0;
  };

  h.artikel = (name) => h.eins(
    `select a.id, a.ean, a.name, a.mhd::text as mhd, a.bestand, a.reduziert, a.aktiv, a.quelle, a.letzte_aktion_am::text as letzte,
            w.name as gruppe
       from mhd.artikel a left join mhd.warengruppen w on w.id = a.warengruppe_id where a.name = $1`, [name]);
  h.protokoll = (artikelName) => h.sql(
    `select p.art, p.mhd_alt::text as mhd_alt, p.mhd_neu::text as mhd_neu, m.name as mitarbeiter
       from mhd.protokoll p join mhd.artikel a on a.id = p.artikel_id join mhd.mitarbeiter m on m.id = p.mitarbeiter_id
      where a.name = $1 order by p.id`, [artikelName]);
  h.mitarbeiter = (name) => h.eins(
    `select id, name, rolle, fehlversuche, gesperrt_bis is not null as gesperrt, gesperrt_bis::text as gesperrt_bis
       from mhd.mitarbeiter where name = $1 and markt_id = (select id from mhd.maerkte where name = 'Demo-Markt')`, [name]);
  h.sitzungen = (name) => h.sql(
    `select s.token::text as token from mhd.sitzungen s join mhd.mitarbeiter m on m.id = s.mitarbeiter_id where m.name = $1`, [name]);

  // Ruft eine mhd_-Funktion wie der Browser auf (als Markt-Konto mit PIN-Sitzung des Mitarbeiters), aber ohne Oberfläche.
  // Nur aufrufen, wenn der Browser gerade nichts sendet.
  h.api = async (name, funktion, parameter = {}) => {
    const konto = (await h.eins('select id from auth.users where email = $1', [EMAIL])).id;
    const sitzung = await pinAnmelden(s.db, konto, (await h.mitarbeiter(name)).id, name === 'Chef' ? '9999' : '1234');
    const namen = Object.keys(parameter);
    const sql = `select public.${funktion}(p_sitzung := $1${namen.map((n, i) => `, ${n} := $${i + 2}`).join('')}) as r`;
    return json(s.db, konto, sql, [sitzung, ...namen.map((n) => (typeof parameter[n] === 'object' && parameter[n] !== null ? JSON.stringify(parameter[n]) : parameter[n]))]);
  };

  // ---- Seite lesen
  h.ruhe = async () => {
    for (let i = 0; i < 2; i++) {
      await c.warteAuf(() => window.__offen === 0, { text: 'Netz ruhig', ms: 15000 });
      await c.pause(120);
    }
  };
  h.text = (sel) => c.werte((x) => document.querySelector(x)?.textContent?.trim() ?? null, sel);
  h.texte = (sel) => c.werte((x) => [...document.querySelectorAll(x)].map((e) => e.textContent.trim()), sel);
  h.anzahl = (sel) => c.werte((x) => document.querySelectorAll(x).length, sel);
  h.sichtbar = (sel) => c.werte((x) => { const e = document.querySelector(x); return Boolean(e && !e.closest('[hidden]') && e.getClientRects().length); }, sel);
  h.meldung = () => c.werte(() => { const m = document.getElementById('meldung'); return m.hidden ? '' : m.textContent; });
  h.hinweis = () => c.werte(() => { const m = document.getElementById('hinweis'); return m.hidden ? '' : m.textContent; });
  h.ansicht = () => c.werte(() => document.querySelector('#ansicht > section')?.className.replace(/^ansicht ansicht-/, '') ?? null);
  h.warteAnsicht = (name) => c.warteAuf((n) => document.querySelector(`#ansicht > .ansicht-${n}`), { text: `Ansicht „${name}“` }, name);
  h.knopfTexte = (wurzel = '#ansicht') => c.werte((w) => [...document.querySelectorAll(`${w} button`)].filter((b) => b.getClientRects().length).map((b) => b.textContent.trim()), wurzel);

  // Die Liste „Heute“ wie angezeigt: [{ schluessel, titel, zeilen: [{ name, status, text }] }] in Anzeigereihenfolge.
  h.liste = () => c.werte(() => [...document.querySelectorAll('.ansicht-liste section.abschnitt')].map((sec) => ({
    schluessel: [...sec.classList].find((k) => k.startsWith('abschnitt-')).slice('abschnitt-'.length),
    titel: sec.querySelector('h2').textContent.trim(),
    zeilen: [...sec.querySelectorAll('button.zeile')].map((z) => ({
      name: z.querySelector('.name').firstChild.textContent.trim(),
      status: z.querySelector('.status')?.textContent.trim() ?? '',
      text: z.innerText.replace(/\s+/g, ' ').trim(),
    })),
  })));
  h.namenIn = async (schluessel) => (await h.liste()).find((a) => a.schluessel === schluessel)?.zeilen.map((z) => z.name) ?? [];
  h.alleNamen = async () => (await h.liste()).flatMap((a) => a.zeilen.map((z) => z.name));

  // Die Liste, wie die Datenbank sie für den Mitarbeiter liefert: { schluessel: [Namen] } (nur gefüllte Abschnitte).
  const REIHE = ['abgelaufen', 'laeuft_ab', 'pruefen', 'reduzieren', 'ohne_bestand'];
  const ordne = (o) => Object.fromEntries(REIHE.filter((k) => o[k]?.length).map((k) => [k, o[k]]));
  h.sollListe = async (name = 'Anna') => {
    const l = await h.api(name, 'mhd_liste');
    return ordne(Object.fromEntries(Object.entries(l.abschnitte).map(([k, v]) => [k, v.map((a) => a.name).sort()])));
  };
  h.istListe = async () => ordne(Object.fromEntries((await h.liste()).map((a) => [a.schluessel, a.zeilen.map((z) => z.name).sort()])));

  // ---- Anmelden über die Oberfläche
  h.warteListe = async () => {
    await h.warteAnsicht('liste');
    await c.warteAuf(() => document.querySelector('.ansicht-liste .inhalt')
      && !/^Lade/.test(document.querySelector('.ansicht-liste .inhalt').textContent), { text: 'geladene Liste' });
    await h.ruhe();
  };
  h.warteMitarbeiterAuswahl = () => c.warteAuf(() => document.querySelector('.ansicht-pin button.mitarbeiter'), { text: 'Mitarbeiter-Auswahl' });

  // Frischer Start: Demo-Daten und Uhr zurück, Speicher des Browsers leer, Anmeldeseite der App.
  h.start = async () => {
    await h.zuruecksetzen();
    await c.navigiere(`${s.url}/test/leer`); // dieselbe Herkunft, aber ohne App
    await c.werte(() => { localStorage.clear(); sessionStorage.clear(); });
    await c.navigiere(`${s.url}/`);
    await h.warteAnsicht('anmeldung');
    await h.ruhe();
  };
  h.marktAnmelden = async (konto = 'demo', passwort = 'test') => {
    await c.tippe({ label: 'Konto des Marktes' }, konto);
    await c.tippe({ label: 'Passwort' }, passwort);
    await c.klick({ text: 'Anmelden', in: '.ansicht-anmeldung', sel: 'button', genau: true });
  };
  h.pinEingeben = async (pin) => {
    await c.tippe('#pin', pin);
    await c.klick({ text: 'Anmelden', in: '.pin-bereich', sel: 'button', genau: true });
  };
  // Optionen: heute (anderer Tag laut Server) und vorher (async-Funktion, läuft nach dem Zurücksetzen, vor der Anmeldung).
  h.alsMitarbeiter = async (name, pin = '1234', { heute = null, vorher = null } = {}) => {
    await h.start();
    if (heute) await h.setzeHeute(heute);
    if (vorher) await vorher();
    await h.marktAnmelden();
    await h.warteMitarbeiterAuswahl();
    await c.klick({ text: name, sel: 'button.mitarbeiter', genau: true });
    await h.pinEingeben(pin);
    await h.warteListe();
  };

  // Die Seite scrollt nicht seitwärts (auf dem Handy darf nichts über den Rand ragen).
  h.passtInsFenster = async (was) => {
    const m = await c.werte(() => ({ breite: document.documentElement.scrollWidth, fenster: window.innerWidth }));
    h.pruefe(m.breite <= m.fenster, `${was}: kein seitliches Scrollen`, `scrollWidth ${m.breite} > innerWidth ${m.fenster}`);
  };

  // Von der Liste aus abmelden und als anderer Mitarbeiter anmelden.
  h.wechsleZu = async (name, pin = '1234') => {
    await h.knopf('Abmelden', '.ansicht-liste');
    await h.warteMitarbeiterAuswahl();
    await c.klick({ text: name, sel: 'button.mitarbeiter', genau: true });
    await h.pinEingeben(pin);
    await h.warteListe();
  };

  // ---- Artikel öffnen und bearbeiten
  h.oeffneAusListe = async (schluessel, name) => {
    await c.klick({ js: `[...document.querySelectorAll('.ansicht-liste section.abschnitt-${schluessel} button.zeile')].find((z) => z.querySelector('.name').firstChild.textContent.trim() === ${JSON.stringify(name)})` });
    await h.warteAnsicht('artikel');
    await c.warteAuf(() => document.querySelector('.ansicht-artikel .bereich button'), { text: 'Aktionsknöpfe des Artikels' });
  };
  h.oeffneAusSuche = async (name) => {
    await c.klick({ js: `[...document.querySelectorAll('.ansicht-suche button.zeile')].find((z) => z.querySelector('.name').firstChild.textContent.trim() === ${JSON.stringify(name)})` });
    await h.warteAnsicht('artikel');
    await c.warteAuf(() => document.querySelector('.ansicht-artikel .bereich button'), { text: 'Aktionsknöpfe des Artikels' });
  };
  h.knopf = async (text, wurzel = '#ansicht') => {
    await c.klick({ text, in: wurzel, sel: 'button', genau: true });
    await c.pause(60);
  };
  h.mhdEintippen = (isoDatum) => c.tippe('#mhd', eingabe(isoDatum));
  h.waehleOption = async (selector, optionText) => {
    const wert = await c.werte((sel, t) => [...document.querySelector(sel).options].find((o) => o.textContent === t)?.value, selector, optionText);
    if (wert === undefined) throw new Error(`Option „${optionText}“ fehlt in ${selector}`);
    await c.setzeWert(selector, wert);
  };

  return h;
}
