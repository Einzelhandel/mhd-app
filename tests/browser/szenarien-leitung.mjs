// Szenarien zur Marktleitung und zu den App-Dateien: Einstellungen, Regeln, Protokoll, PIN-Felder, Manifest und Icons.
import { tag, eingabe, HEUTE } from './rahmen.mjs';

const QUARK = 'SPEISEQUARK MAGERSTUFE';
const REGEL_FEHLER = 'Reduzieren darf nicht früher kommen als Prüfen (die Zahl bei Reduzieren darf nicht größer sein).';

// Das Formular einer Warengruppe (Name im ersten Feld) bzw. die Zeile eines Mitarbeiters in den Einstellungen.
const gruppenFormular = (name) => `[...document.querySelectorAll('.ansicht-einstellungen form.karte')].find((f) => f.querySelector('input').value === ${JSON.stringify(name)})`;
const zahlFeld = (name, nr) => ({ js: `${gruppenFormular(name)}.querySelectorAll('input.zahl')[${nr}]` });
const gruppeSpeichern = (name) => ({ js: `${gruppenFormular(name)}.querySelector('button[type="submit"]')` });
const mitarbeiterKnopf = (name) => ({ js: `[...document.querySelectorAll('.ansicht-einstellungen .kartenzeile')].find((z) => z.querySelector('.name').textContent === ${JSON.stringify(name)}).querySelector('button')` });

export default [
  {
    nr: 9,
    name: 'Marktleitung: Einstellungen, Regel ändern, Protokoll; Mitarbeiter ohne Knopf',
    async lauf(h) {
      const { c } = h;
      await h.alsMitarbeiter('Anna');
      h.gleich(await h.knopfTexte('.ansicht-liste .kopf'), ['Abmelden'], 'Anna: weder „Einstellungen“ noch „Protokoll“');
      h.gleich(await h.sql("select rolle from mhd.mitarbeiter where name = 'Anna'").then((r) => r[0].rolle), 'mitarbeiter', 'DB: Anna ist keine Leitung');

      // Die Aktionen der Szenarien 2 bis 5, als Anna über dieselben Datenbankfunktionen (der Browser ist gerade ruhig).
      const id = async (name) => Number((await h.artikel(name)).id);
      await h.api('Anna', 'mhd_aktion', { p_artikel: await id(QUARK), p_art: 'geprueft', p_mhd: tag(30) });
      await h.api('Anna', 'mhd_aktion', { p_artikel: await id('Kefir'), p_art: 'aussortiert' });
      await h.api('Anna', 'mhd_aktion', { p_artikel: await id('Skyr'), p_art: 'reduziert' });
      const gruppe = Number((await h.eins("select id from mhd.warengruppen where name = 'Backwaren'")).id);
      await h.api('Anna', 'mhd_artikel_speichern', { p_id: null, p_daten: { ean: '4000000000006', name: 'Testbrot', quelle: 'hand', warengruppe_id: gruppe } });
      await h.api('Anna', 'mhd_aktion', { p_artikel: await id('Testbrot'), p_art: 'geprueft', p_mhd: tag(10) });

      await h.wechsleZu('Chef', '9999');
      h.gleich(await h.knopfTexte('.ansicht-liste .kopf'), ['Protokoll', 'Einstellungen', 'Abmelden'], 'Chef sieht „Protokoll“ und „Einstellungen“');
      h.pruefe((await h.namenIn('pruefen')).includes('Haferflocken Kernig'), 'Haferflocken stehen vor der Regeländerung unter „Heute prüfen“');
      await h.knopf('Protokoll', '.ansicht-liste .kopf');
      await h.warteAnsicht('protokoll');
      await c.warteAuf(() => document.querySelector('.ansicht-protokoll table.protokoll'), { text: 'Protokolltabelle' });
      await h.ruhe();
      const zeilen = await c.werte(() => [...document.querySelectorAll('.ansicht-protokoll table.protokoll tbody tr')].map((tr) => [...tr.cells].map((td) => td.textContent.trim())));
      const erwartet = [
        ['16.11. 09:00', 'Anna', QUARK, 'Geprüft', `${eingabe(tag(3))} → ${eingabe(tag(30))}`],
        ['16.11. 09:00', 'Anna', 'Kefir', 'Aussortiert', `${eingabe(tag(-1))} → –`],
        ['16.11. 09:00', 'Anna', 'Skyr', 'Reduziert', `${eingabe(tag(2))} → ${eingabe(tag(2))}`],
        ['16.11. 09:00', 'Anna', 'Testbrot', 'Geprüft', `– → ${eingabe(tag(10))}`],
      ];
      for (const z of erwartet) h.pruefe(zeilen.some((x) => JSON.stringify(x) === JSON.stringify(z)), `Protokoll zeigt ${z.slice(1, 4).join(' / ')}`, zeilen);
      const ausDb = await h.api('Chef', 'mhd_protokoll', { p_von: tag(-6), p_bis: HEUTE });
      h.gleich(zeilen.length, ausDb.length, 'Zeilen der Tabelle = Zeilen aus der Datenbank');
      await h.foto('protokoll');

      await h.knopf('Zurück', '.ansicht-protokoll');
      await h.warteListe();
      await h.knopf('Einstellungen', '.ansicht-liste .kopf');
      await h.warteAnsicht('einstellungen');
      await c.warteAuf(() => document.querySelectorAll('.ansicht-einstellungen form.karte').length >= 11, { text: 'Warengruppen der Einstellungen' });
      await h.ruhe();
      h.gleich(await h.texte('.ansicht-einstellungen .kartenzeile .name'), ['Anna', 'Ben', 'Chef'], 'Mitarbeiter in den Einstellungen');
      await h.foto('einstellungen');

      // Haferflocken (Trockensortiment 14/7/30, MHD in 14 Tagen) sind heute zu prüfen; eine längere Vorlaufzeit macht das Prüfen „versäumt“.
      await c.tippe(zahlFeld('Trockensortiment', 0), '15');
      await c.tippe(zahlFeld('Trockensortiment', 1), '20');
      await c.klick(gruppeSpeichern('Trockensortiment'));
      await c.warteAuf(() => [...document.querySelectorAll('.ansicht-einstellungen .feldfehler')].some((f) => !f.hidden), { text: 'Fehlermeldung zur Regel' });
      h.gleich(await c.werte(() => [...document.querySelectorAll('.ansicht-einstellungen .feldfehler')].find((f) => !f.hidden).textContent), REGEL_FEHLER, 'ungültige Regel wird abgewiesen');
      const roh = await h.eins("select pruef_vorlauf_tage as p, reduzier_vorlauf_tage as r from mhd.warengruppen where name = 'Trockensortiment'");
      h.gleich([roh.p, roh.r], [14, 7], 'DB: Regel unverändert');

      await c.tippe(zahlFeld('Trockensortiment', 1), '7');
      await c.klick(gruppeSpeichern('Trockensortiment'));
      await c.warteAuf(() => !document.getElementById('hinweis').hidden, { text: 'Bestätigung' });
      h.gleich(await h.hinweis(), 'Gespeichert.', 'Bestätigung');
      await h.ruhe();
      const neu = await h.eins("select pruef_vorlauf_tage as p, reduzier_vorlauf_tage as r, max_intervall_tage as m from mhd.warengruppen where name = 'Trockensortiment'");
      h.gleich([neu.p, neu.r, neu.m], [15, 7, 30], 'DB: neue Regel');
      h.gleich(await c.werte((js) => (0, eval)(js).value, zahlFeld('Trockensortiment', 0).js), '15', 'Feld zeigt den gespeicherten Wert');

      await h.knopf('Zurück', '.ansicht-einstellungen');
      await h.warteListe();
      const zeile = (await h.liste()).find((a) => a.schluessel === 'abgelaufen')?.zeilen.find((z) => z.name === 'Haferflocken Kernig');
      h.gleich(zeile?.status, 'Prüfen versäumt seit 1 Tag', 'die neue Regel wirkt sofort auf die Liste');
      h.gleich(await h.istListe(), await h.sollListe('Chef'), 'Liste entspricht der Datenbank');
    },
  },
  {
    nr: 16,
    name: 'PIN-Felder: Textfeld mit Klasse pin-feld, Seite bleibt bedienbar',
    async lauf(h) {
      const { c } = h;
      const feld = (selector) => c.werte((sel) => {
        const e = document.querySelector(sel);
        return { type: e.type, pinFeld: e.classList.contains('pin-feld'), inputmode: e.inputMode, autocomplete: e.autocomplete, maxlength: e.maxLength };
      }, selector);
      const soll = { type: 'text', pinFeld: true, inputmode: 'numeric', autocomplete: 'off', maxlength: 6 };

      await h.start();
      await h.marktAnmelden();
      await h.warteMitarbeiterAuswahl();
      await c.klick({ text: 'Anna', sel: 'button.mitarbeiter', genau: true });
      await c.warteAuf(() => document.querySelector('#pin'), { text: 'PIN-Feld' });
      h.gleich(await feld('#pin'), soll, 'PIN-Feld der Anmeldung');
      await h.pinEingeben('1234');
      await h.warteListe();
      // Nach der PIN-Anmeldung reagiert die Seite auf echte Klicks (Finger und Maus).
      await h.knopf('Suche', '.ansicht-liste');
      await h.warteAnsicht('suche');
      await c.klick({ text: 'Zurück', in: '.ansicht-suche', sel: 'button', genau: true }, { maus: true });
      await h.warteListe();
      h.gleich(await h.ansicht(), 'liste', 'Mausklick funktioniert nach der PIN-Anmeldung');

      await h.wechsleZu('Chef', '9999');
      await h.knopf('Einstellungen', '.ansicht-liste .kopf');
      await h.warteAnsicht('einstellungen');
      await c.warteAuf(() => document.querySelector('.ansicht-einstellungen .kartenzeile button'), { text: 'Mitarbeiter in den Einstellungen' });
      await h.ruhe();
      await c.klick(mitarbeiterKnopf('Anna'));
      await c.warteAuf(() => [...document.querySelectorAll('.ansicht-einstellungen label')].some((l) => l.textContent.startsWith('Neue PIN')), { text: 'Feld „Neue PIN“' });
      const neuePin = { label: 'Neue PIN' };
      await c.tippe(neuePin, '5678');
      h.gleich(await c.werte(() => { const e = document.activeElement; return { type: e.type, pinFeld: e.classList.contains('pin-feld'), inputmode: e.inputMode, autocomplete: e.autocomplete, maxlength: e.maxLength }; }), soll, 'Feld „Neue PIN“');
      await h.foto('neue-pin');
      await c.klick({ js: "document.activeElement.closest('form').querySelector('button[type=\"submit\"]')" });
      await c.warteAuf(() => !document.getElementById('hinweis').hidden, { text: 'Bestätigung' });
      h.gleich(await h.hinweis(), 'Gespeichert.', 'PIN gespeichert');
      await h.ruhe();
      const ok = await h.eins("select pin_hash = extensions.crypt('5678', pin_hash) as ok from mhd.mitarbeiter where name = 'Anna'");
      h.gleich(ok.ok, true, 'DB: Annas PIN ist jetzt 5678');
      // Nach dem Speichern reagiert die Seite weiter auf echte Klicks.
      await h.knopf('Zurück', '.ansicht-einstellungen');
      await h.warteListe();
      h.gleich(await h.ansicht(), 'liste', 'Klick nach dem Speichern der PIN funktioniert');

      await h.wechsleZu('Anna', '5678');
      h.gleich(await h.text('.ansicht-liste .wer'), 'Anna', 'Anna meldet sich mit der neuen PIN an');
    },
  },
  {
    nr: 17,
    name: 'App-Dateien: Manifest, Icons und Service Worker kommen richtig an',
    async lauf(h) {
      const { c, s } = h;
      await h.start();
      const dateien = await c.werte(async () => {
        const aus = {};
        for (const pfad of ['manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'sw.js']) {
          const a = await fetch(pfad, { cache: 'no-store' });
          const bytes = new Uint8Array(await a.arrayBuffer());
          aus[pfad] = { status: a.status, typ: a.headers.get('content-type'), anfang: [...bytes.slice(0, 8)], laenge: bytes.length };
        }
        return aus;
      });
      const PNG = [137, 80, 78, 71, 13, 10, 26, 10];
      for (const [pfad, typ] of [['manifest.webmanifest', /^application\/manifest\+json/], ['icon-192.png', /^image\/png/], ['icon-512.png', /^image\/png/], ['sw.js', /^text\/javascript/]]) {
        const d = dateien[pfad];
        h.gleich(d.status, 200, `${pfad}: Status`);
        h.pruefe(typ.test(d.typ), `${pfad}: Inhaltstyp`, d.typ);
        h.pruefe(d.laenge > 50, `${pfad}: nicht leer`, d.laenge);
      }
      h.gleich(dateien['icon-192.png'].anfang, PNG, 'icon-192.png ist ein PNG');
      h.gleich(dateien['icon-512.png'].anfang, PNG, 'icon-512.png ist ein PNG');
      const manifest = await c.werte(async () => (await fetch('manifest.webmanifest')).json());
      h.gleich([manifest.name, manifest.display, manifest.start_url], ['MHD', 'standalone', './'], 'Manifest: Name, Anzeige, Start');
      h.gleich(await c.werte(() => document.querySelector('link[rel="manifest"]').href), `${s.url}/manifest.webmanifest`, 'index.html verweist auf das Manifest');
      // Der Service Worker meldet sich an (localhost zählt als sichere Herkunft).
      const scope = await c.warteAuf(async () => (await navigator.serviceWorker.getRegistration())?.scope, { text: 'Service Worker', ms: 10000 });
      h.gleich(scope, `${s.url}/`, 'Service Worker ist angemeldet');
    },
  },
];
