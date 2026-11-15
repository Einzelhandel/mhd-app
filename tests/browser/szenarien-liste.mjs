// Szenarien zur Tagesliste: Artikel prüfen, aussortieren, reduzieren, Datumswechsel, versäumter Termin, Textsicherheit.
import { tag, HEUTE } from './rahmen.mjs';

const QUARK = 'SPEISEQUARK MAGERSTUFE';
const BUTTER = 'Deutsche Markenbutter - mildgesäuert';
const ROT = 'rgb(198, 40, 40)'; // --rot in style.css

export default [
  {
    nr: 2,
    name: 'Prüfen: MHD eintippen, Geprüft, Artikel verlässt die Liste',
    async lauf(h) {
      const { c } = h;
      await h.alsMitarbeiter('Anna');
      h.pruefe((await h.namenIn('pruefen')).includes(QUARK), `„${QUARK}“ steht unter „Heute prüfen“`);
      await h.oeffneAusListe('pruefen', QUARK);
      h.gleich(await h.text('.ansicht-artikel h1'), QUARK, 'Artikel-Ansicht');
      h.gleich(await c.werte(() => document.getElementById('mhd').value), '19.11.26', 'Feld zeigt das gespeicherte MHD');
      await h.passtInsFenster('Artikel');
      await h.foto('artikel');
      await h.mhdEintippen(tag(30));
      await h.knopf('Geprüft', '.ansicht-artikel');
      await h.warteListe();
      h.gleich(await h.hinweis(), 'Geprüft.', 'Bestätigung');
      h.pruefe(!(await h.alleNamen()).includes(QUARK), 'Artikel steht nicht mehr in der Liste', await h.alleNamen());
      const a = await h.artikel(QUARK);
      h.gleich([a.mhd, a.bestand, a.letzte], [tag(30), true, HEUTE], 'DB: neues MHD, Bestand, letzte Aktion heute');
      const p = await h.protokoll(QUARK);
      h.gleich(p.at(-1), { art: 'geprueft', mhd_alt: tag(3), mhd_neu: tag(30), mitarbeiter: 'Anna' }, 'DB: Protokollzeile');
      h.gleich(p.length, 2, 'DB: eine Zeile mehr als nach dem Zurücksetzen');
      h.gleich(await h.istListe(), await h.sollListe(), 'Liste entspricht der Datenbank');

      // Zweimal Enter im MHD-Feld, während der erste Aufruf noch läuft: nur eine Aktion.
      const HAFER = 'Haferflocken Kernig';
      await h.oeffneAusListe('pruefen', HAFER);
      h.s.verzoegere(800, { nur: 'mhd_aktion' });
      try {
        await c.tippe('#mhd', '311226', { enter: true });
        await c.taste('Enter');
        await h.warteListe();
      } finally {
        h.s.verzoegere(0);
      }
      h.gleich((await h.protokoll(HAFER)).length, 2, 'DB: zweimal Enter ergibt eine Protokollzeile');
    },
  },
  {
    nr: 3,
    name: 'Abgelaufen: Aussortiert, Kein Bestand, Artikel verlässt die Liste',
    async lauf(h) {
      const { c } = h;
      await h.alsMitarbeiter('Anna');
      h.pruefe((await h.namenIn('abgelaufen')).includes('Kefir'), 'Kefir steht unter „Abgelaufen / versäumt“');
      await h.oeffneAusListe('abgelaufen', 'Kefir');
      await h.knopf('Aussortiert', '.ansicht-artikel');
      await c.warteAuf(() => [...document.querySelectorAll('.ansicht-artikel button')].some((b) => b.textContent.trim() === 'Kein Bestand'), { text: 'Frage nach dem neuen MHD' });
      h.pruefe((await h.text('.ansicht-artikel .frage')).startsWith('Ware aussortiert'), 'Rückfrage nach dem vordersten MHD');
      await h.foto('aussortiert');
      await h.knopf('Kein Bestand', '.ansicht-artikel');
      await h.warteListe();
      h.gleich(await h.hinweis(), 'Aussortiert.', 'Bestätigung');
      h.pruefe(!(await h.alleNamen()).includes('Kefir'), 'Kefir steht in keinem Abschnitt mehr', await h.alleNamen());
      const a = await h.artikel('Kefir');
      h.gleich([a.bestand, a.mhd, a.letzte], [false, null, HEUTE], 'DB: kein Bestand, kein MHD');
      h.gleich((await h.protokoll('Kefir')).at(-1), { art: 'aussortiert', mhd_alt: tag(-1), mhd_neu: null, mitarbeiter: 'Anna' }, 'DB: Protokollzeile');
      h.gleich(await h.istListe(), await h.sollListe(), 'Liste entspricht der Datenbank');
    },
  },
  {
    nr: 4,
    name: 'Reduzieren: Reduziert gelingt, Artikel verlässt den Abschnitt',
    async lauf(h) {
      const { c } = h;
      await h.alsMitarbeiter('Anna');
      h.gleich((await h.namenIn('reduzieren')).sort(), ['Hackfleisch gemischt', 'Skyr'], 'Abschnitt „Heute reduzieren“ vorher');
      await h.oeffneAusListe('reduzieren', 'Skyr');
      await h.foto('artikel');
      await h.knopf('Reduziert', '.ansicht-artikel');
      await h.warteListe();
      h.gleich(await h.hinweis(), 'Als reduziert vermerkt.', 'Erfolg, keine Fehlermeldung');
      h.gleich(await h.meldung(), '', 'keine Fehlermeldung oben');
      h.gleich(await h.namenIn('reduzieren'), ['Hackfleisch gemischt'], 'Skyr ist aus dem Abschnitt, der andere Artikel bleibt');
      const a = await h.artikel('Skyr');
      h.gleich([a.reduziert, a.bestand, a.mhd], [true, true, tag(2)], 'DB: reduziert = true, MHD unverändert');
      h.gleich((await h.protokoll('Skyr')).at(-1), { art: 'reduziert', mhd_alt: tag(2), mhd_neu: tag(2), mitarbeiter: 'Anna' }, 'DB: Protokollzeile');
      h.gleich(await h.istListe(), await h.sollListe(), 'Liste entspricht der Datenbank');
      // Der Artikel zeigt danach „Bereits reduziert.“
      await c.klick({ text: 'Suche', in: '.ansicht-liste', sel: 'button', genau: true });
      await h.warteAnsicht('suche');
      await c.tippe('#suchtext', 'skyr', { enter: true });
      await h.ruhe();
      await h.oeffneAusSuche('Skyr');
      h.pruefe((await h.text('.ansicht-artikel')).includes('Bereits reduziert.'), 'Artikel zeigt „Bereits reduziert.“');
    },
  },
  {
    nr: 7,
    name: 'Über Nacht: neuer Tag laut Server, Liste lädt beim Aufwecken neu',
    async lauf(h) {
      const { c } = h;
      await h.alsMitarbeiter('Anna');
      h.gleich(await h.namenIn('laeuft_ab'), [BUTTER], 'gestern „Läuft heute ab“: die Butter');
      h.gleich(await h.text('.ansicht-liste h1'), 'Heute, Mo 16.11.', 'Überschrift vor dem Tageswechsel');
      h.pruefe(!(await h.namenIn('abgelaufen')).includes(BUTTER), 'Butter ist noch nicht abgelaufen');

      await h.setzeHeute(tag(1)); // Mitternacht ist vorbei; die Seite blieb offen
      await c.werte(() => document.dispatchEvent(new Event('visibilitychange')));
      await c.warteAuf((n) => [...document.querySelectorAll('.ansicht-liste section.abschnitt-abgelaufen .zeile .name')].some((e) => e.firstChild.textContent.trim() === n),
        { text: 'Butter im roten Abschnitt' }, BUTTER);
      await h.ruhe();
      const zeile = (await h.liste()).find((a) => a.schluessel === 'abgelaufen').zeilen.find((z) => z.name === BUTTER);
      h.gleich(zeile.status, 'abgelaufen seit 1 Tag', 'Status der Butter');
      h.gleich(await h.text('.ansicht-liste h1'), 'Heute, Di 17.11.', 'Überschrift nach dem Tageswechsel');
      h.pruefe(!(await h.namenIn('laeuft_ab')).includes(BUTTER), 'Butter steht nicht mehr unter „Läuft heute ab“');
      const farben = await c.werte(() => {
        const sec = document.querySelector('.ansicht-liste section.abschnitt-abgelaufen');
        return { kopf: getComputedStyle(sec.querySelector('h2')).backgroundColor, rand: getComputedStyle(sec.querySelector('.zeile')).borderLeftColor };
      });
      h.gleich(farben, { kopf: ROT, rand: ROT }, 'Abschnitt und Zeile sind rot');
      h.gleich(await h.istListe(), await h.sollListe(), 'Liste entspricht der Datenbank am neuen Tag');
      await h.foto('neuer-tag');
    },
  },
  {
    nr: 12,
    name: 'Versäumter Termin mit MHD heute: roter Abschnitt und „läuft heute ab“',
    async lauf(h) {
      const { c } = h;
      // „Skyr“ (MHD in zwei Tagen, Reduzieren war fällig) bleibt unbearbeitet; der Tag wird auf sein MHD gestellt.
      await h.alsMitarbeiter('Anna', '1234', { heute: tag(2) });
      const a = await h.artikel('Skyr');
      h.gleich([a.mhd, a.reduziert, a.letzte], [tag(2), false, tag(-1)], 'DB: Skyr unbearbeitet, MHD ist heute');
      const abgelaufen = (await h.liste()).find((x) => x.schluessel === 'abgelaufen');
      const zeile = abgelaufen?.zeilen.find((z) => z.name === 'Skyr');
      h.pruefe(Boolean(zeile), 'Skyr steht unter „Abgelaufen / versäumt“', await h.liste());
      h.gleich(zeile?.status, 'Reduzieren versäumt seit 2 Tagen · läuft heute ab', 'Status mit „läuft heute ab“');
      h.pruefe(!(await h.namenIn('laeuft_ab')).includes('Skyr'), 'nicht zusätzlich unter „Läuft heute ab“');
      const kopf = await c.werte(() => getComputedStyle(document.querySelector('.ansicht-liste section.abschnitt-abgelaufen h2')).backgroundColor);
      h.gleich(kopf, ROT, 'Abschnitt ist rot');
      await h.foto('liste');
      await h.oeffneAusListe('abgelaufen', 'Skyr');
      h.gleich(await h.text('.ansicht-artikel .status-gross'), 'Reduzieren versäumt seit 2 Tagen · läuft heute ab', 'derselbe Status im Artikel');
      h.pruefe(await c.werte(() => document.querySelector('.ansicht-artikel .status-gross').classList.contains('abschnitt-abgelaufen')), 'Status im Artikel ist rot');
      await h.foto('artikel');
      await h.knopf('Zurück', '.ansicht-artikel');
      await h.warteListe();
      h.gleich(await h.istListe(), await h.sollListe(), 'Liste entspricht der Datenbank');
    },
  },
  {
    nr: 10,
    name: 'Text-Sicherheit: HTML im Artikelnamen bleibt Text',
    async lauf(h) {
      const { c } = h;
      const name = '<img src=x onerror=alert(1)>';
      await h.alsMitarbeiter('Chef', '9999', {
        async vorher() {
          const gruppe = (await h.eins("select id from mhd.warengruppen where name = 'Molkerei'")).id;
          await h.api('Chef', 'mhd_artikel_speichern', {
            p_id: null,
            p_daten: { name, marke: '<b>fett</b>', menge: '<script>alert(2)</script>', platz: '"><svg onload=alert(3)>', warengruppe_id: Number(gruppe) },
          });
          const id = (await h.artikel(name)).id;
          await h.api('Chef', 'mhd_aktion', { p_artikel: Number(id), p_art: 'geprueft', p_mhd: tag(-1) });
        },
      });
      h.pruefe((await h.namenIn('abgelaufen')).includes(name), 'Name steht als Text in der Liste', await h.alleNamen());
      h.gleich(await h.anzahl('#ansicht img, #ansicht b, #ansicht svg, #ansicht script'), 0, 'Liste: kein img, b, svg, script im DOM');
      await h.oeffneAusListe('abgelaufen', name);
      h.gleich(await h.text('.ansicht-artikel h1'), name, 'Artikel: Name als Text');
      h.gleich(await h.texte('.ansicht-artikel dd'), ['<b>fett</b>', '<script>alert(2)</script>', '"><svg onload=alert(3)>', 'Molkerei'], 'Artikel: Angaben als Text');
      h.gleich(await h.anzahl('#ansicht img, #ansicht b, #ansicht svg, #ansicht script'), 0, 'Artikel: kein img, b, svg, script im DOM');
      await h.foto('artikel');
      await h.knopf('Zurück', '.ansicht-artikel');
      await h.warteListe();
      await h.knopf('Suche', '.ansicht-liste');
      await h.warteAnsicht('suche');
      await c.tippe('#suchtext', 'onerror', { enter: true });
      await h.ruhe();
      h.gleich(await h.texte('.ansicht-suche .zeile .name'), [name], 'Suche findet den Namen als Text');
      h.gleich(await h.anzahl('#ansicht img, #ansicht b, #ansicht svg, #ansicht script'), 0, 'Suche: kein img, b, svg, script im DOM');
      h.gleich(await h.anzahl('img'), 0, 'im ganzen Dokument kein img');
      h.gleich(c.dialoge.length, 0, 'kein alert ausgelöst');
    },
  },
  {
    nr: 22,
    name: 'Suche: bei 50 Treffern der Hinweis, genauer zu suchen',
    async lauf(h) {
      const { c } = h;
      const HINWEIS = 'Es werden die ersten 50 Treffer gezeigt. Bitte genauer suchen.';
      await h.alsMitarbeiter('Anna', '1234', {
        vorher: () => h.sql(`insert into mhd.artikel (markt_id, name, quelle, ohne_bestand_seit, letzte_aktion_am)
          select m.id, 'Testartikel ' || g, 'hand', mhd.heute(), mhd.heute()
            from mhd.maerkte m, generate_series(1, 40) g where m.name = 'Demo-Markt'`),
      });
      await h.knopf('Suche', '.ansicht-liste');
      await h.warteAnsicht('suche');
      await c.warteAuf(() => document.querySelectorAll('.ansicht-suche button.zeile').length > 0, { text: 'Treffer' });
      await h.ruhe();
      h.gleich(await h.anzahl('.ansicht-suche button.zeile'), 50, '50 Treffer (55 Artikel im Markt)');
      h.gleich(await h.texte('.ansicht-suche .treffer-grenze'), [HINWEIS], 'Hinweis bei 50 Treffern');
      await h.foto('grenze');
      await c.tippe('#suchtext', 'kefir', { enter: true });
      await h.ruhe();
      h.gleich(await h.texte('.ansicht-suche .zeile .name'), ['Kefir'], 'genauer gesucht: ein Treffer');
      h.gleich(await h.anzahl('.ansicht-suche .treffer-grenze'), 0, 'kein Hinweis bei weniger Treffern');
      h.gleich(await h.text('.ansicht-suche .inhalt'), 'Kefir500 g · Kühlregal 1MHD 15.11.26abgelaufen seit 1 Tag', 'nur die Trefferzeile, sonst nichts');
    },
  },
  {
    nr: 23,
    name: 'Über Nacht: scheitert das Neuladen, versucht es der Minutentakt erneut',
    async lauf(h) {
      const { c } = h;
      await h.alsMitarbeiter('Anna');
      h.gleich(await h.text('.ansicht-liste h1'), 'Heute, Mo 16.11.', 'Überschrift vor dem Tageswechsel');
      // Zählt die Listenaufrufe der Seite; "scheitern" lässt den nächsten Aufruf an die Liste ohne Antwort enden.
      await c.werte(() => {
        window.__listen = 0; window.__scheitern = 0; window.__spaet = 0;
        const f = window.fetch;
        window.fetch = (url, ...a) => {
          if (String(url).includes('mhd_liste')) {
            window.__listen++;
            if (window.__scheitern > 0) { window.__scheitern--; return Promise.reject(new TypeError('Failed to fetch')); }
          }
          if (String(url).includes('mhd_liste') && window.__spaet > 0) { // Antwort kommt spät: das Laden ist unterwegs
            const ms = window.__spaet; window.__spaet = 0;
            return new Promise((ok) => setTimeout(ok, ms)).then(() => f(url, ...a));
          }
          return f(url, ...a);
        };
      });
      const takt = () => c.werte(() => window.__takte.forEach((fn) => fn()));
      const listen = () => c.werte(() => window.__listen);

      await takt();
      await h.ruhe();
      h.gleich(await listen(), 0, 'ohne Tageswechsel löst der Takt keinen Aufruf aus');

      await h.setzeHeute(tag(1));
      // Die Uhr des Geräts geht über Mitternacht (gilt nur für new Date() ohne Zeitangabe).
      await c.werte(() => {
        const Echt = window.Date; window.__echtesDatum = Echt;
        window.Date = class extends Echt { constructor(...a) { super(...(a.length ? a : [Echt.now() + 86400000])); } };
      });
      try {
        await c.werte(() => { window.__scheitern = 1; });
        await takt();
        await c.warteAuf(() => document.getElementById('meldung').textContent !== '', { text: 'Fehlermeldung' });
        await h.ruhe();
        h.gleich(await listen(), 1, 'erster Versuch nach Mitternacht');
        h.gleich(await h.text('.ansicht-liste h1'), 'Heute, Mo 16.11.', 'Überschrift unverändert, solange das Laden scheitert');
        h.pruefe((await h.alleNamen()).length > 0, 'die alte Liste bleibt stehen');

        // Der Server antwortet spät; zwei Takte kurz hintereinander starten nur ein Laden.
        await c.werte(() => { window.__spaet = 1500; });
        await takt();
        await takt();
        h.gleich(await listen(), 2, 'der nächste Takt lädt erneut, der zweite Takt startet kein zweites Laden');
        await c.warteAuf(() => document.querySelector('.ansicht-liste h1').textContent === 'Heute, Di 17.11.', { text: 'neue Überschrift' });
        await h.ruhe();
        h.gleich(await listen(), 2, 'auch nach der späten Antwort bleibt es bei einem Aufruf');
        h.gleich(await h.meldung(), '', 'Fehlermeldung ist weg');
        h.gleich(await h.istListe(), await h.sollListe(), 'Liste entspricht der Datenbank am neuen Tag');

        await takt();
        await h.ruhe();
        h.gleich(await listen(), 2, 'nach dem Erfolg lädt der Takt nicht mehr');
      } finally {
        await c.werte(() => { if (window.__echtesDatum) window.Date = window.__echtesDatum; });
      }
    },
  },
];
