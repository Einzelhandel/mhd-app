// Szenarien zur Anmeldung: Markt-Konto, PIN, abgelaufene PIN, PIN-Sperre, Abmelden.
import { jetztPlus } from './rahmen.mjs';

const UEBERSCHRIFTEN = [
  'Abgelaufen / versäumt (2)', 'Läuft heute ab (1)', 'Heute prüfen (2)', 'Heute reduzieren (2)', 'Ohne Bestand – wieder da? (1)',
];

export default [
  {
    nr: 1,
    name: 'Anmelden: Konto, Mitarbeiter, falsche und richtige PIN',
    erlaubt: [{ status: 400, url: '/auth/v1/token', fehler: 'invalid_credentials' }],
    async lauf(h) {
      const { c } = h;
      await h.start();
      await h.marktAnmelden('demo', 'falsch');
      await c.warteAuf(() => !document.getElementById('meldung').hidden, { text: 'Fehlermeldung zum Passwort' });
      h.gleich(await h.meldung(), 'Konto oder Passwort stimmt nicht.', 'Meldung bei falschem Passwort');
      h.gleich(await h.ansicht(), 'anmeldung', 'bleibt auf der Anmeldung');
      h.gleich(await c.werte(() => localStorage.getItem('mhd-markt')), null, 'kein Konto gemerkt');

      await h.marktAnmelden('demo', 'test');
      await h.warteMitarbeiterAuswahl();
      h.gleich(await h.text('.ansicht-pin h1'), 'Demo-Markt', 'Überschrift der Auswahl');
      h.gleich(await h.texte('.ansicht-pin button.mitarbeiter'), ['Anna', 'Ben', 'Chef'], 'Mitarbeiter zur Auswahl');
      h.pruefe(await c.werte(() => Boolean(localStorage.getItem('mhd-markt'))), 'Markt-Konto ist auf dem Gerät gemerkt');
      await h.foto('auswahl');

      await c.klick({ text: 'Anna', sel: 'button.mitarbeiter', genau: true });
      await c.warteAuf(() => document.querySelector('#pin'), { text: 'PIN-Feld' });
      await h.pinEingeben('0000');
      await c.warteAuf(() => !document.getElementById('meldung').hidden, { text: 'Meldung zur PIN' });
      h.gleich(await h.meldung(), 'Die PIN stimmt nicht.', 'Meldung bei falscher PIN');
      h.gleich(await h.ansicht(), 'pin', 'bleibt bei der PIN');
      h.gleich((await h.mitarbeiter('Anna')).fehlversuche, 1, 'DB: ein Fehlversuch');
      h.gleich(await h.sitzungen('Anna'), [], 'DB: keine Sitzung nach falscher PIN');

      await h.pinEingeben('1234');
      await h.warteListe();
      h.gleich(await h.texte('.ansicht-liste section.abschnitt h2'), UEBERSCHRIFTEN, 'fünf Abschnitte in fester Reihenfolge');
      h.gleich(await h.text('.ansicht-liste h1'), 'Heute, Mo 16.11.', 'Überschrift der Liste mit dem Datum des Servers');
      h.gleich(await h.text('.ansicht-liste .wer'), 'Anna', 'angemeldet als');
      h.gleich((await h.mitarbeiter('Anna')).fehlversuche, 0, 'DB: Fehlversuche zurückgesetzt');
      h.gleich((await h.sitzungen('Anna')).length, 1, 'DB: genau eine Sitzung');
      h.pruefe(await c.werte(() => Boolean(sessionStorage.getItem('mhd-pin'))), 'PIN-Sitzung im Tab');
      await h.foto('liste');
      await h.passtInsFenster('Liste');
    },
  },
  {
    nr: 8,
    name: 'PIN abgelaufen: PIN-Ansicht statt Fehlerseite, Markt-Konto bleibt',
    erlaubt: [{ status: 400, fehler: 'PIN_ABGELAUFEN' }],
    async lauf(h) {
      const { c } = h;
      await h.alsMitarbeiter('Anna');
      const quark = 'SPEISEQUARK MAGERSTUFE';
      const vorher = (await h.protokoll(quark)).length;
      await h.setzeJetzt(jetztPlus(31)); // 31 Minuten ohne Aktion: die Sitzung ist abgelaufen

      // Der Artikel lässt sich noch öffnen (das Datum „heute“ kennt die Seite schon); beim Speichern merkt es der Server.
      await h.oeffneAusListe('pruefen', quark);
      h.gleich(await h.ansicht(), 'artikel', 'Artikel öffnet sich');
      await h.knopf('Geprüft', '.ansicht-artikel');
      await h.warteAnsicht('pin');
      await h.warteMitarbeiterAuswahl();
      await h.ruhe();
      h.gleich(await h.meldung(), 'Bitte die PIN neu eingeben.', 'Meldung zur PIN, keine Fehlerseite');
      h.gleich(await h.texte('.ansicht-pin button.mitarbeiter'), ['Anna', 'Ben', 'Chef'], 'Auswahl der Mitarbeiter');
      h.pruefe(await c.werte(() => Boolean(localStorage.getItem('mhd-markt'))), 'Markt-Konto blieb angemeldet');
      h.gleich(await c.werte(() => sessionStorage.getItem('mhd-pin')), null, 'abgelaufene PIN-Sitzung ist weg');
      h.gleich((await h.protokoll(quark)).length, vorher, 'DB: die Aktion wurde nicht ausgeführt');
      await h.foto('pin-ansicht');

      await c.klick({ text: 'Anna', sel: 'button.mitarbeiter', genau: true });
      await h.pinEingeben('1234');
      await h.warteListe();
      h.pruefe((await h.namenIn('pruefen')).includes(quark), 'nach der PIN wieder die Liste, Artikel unverändert darin');

      // Zweiter Weg: die Seite wird nach langer Pause wieder sichtbar.
      await h.setzeJetzt(jetztPlus(70));
      await c.werte(() => document.dispatchEvent(new Event('visibilitychange')));
      await h.warteAnsicht('pin');
      await h.warteMitarbeiterAuswahl();
      await h.ruhe();
      h.gleich(await h.meldung(), 'Bitte die PIN neu eingeben.', 'Meldung nach dem Aufwecken');
      h.pruefe(await c.werte(() => Boolean(localStorage.getItem('mhd-markt'))), 'Markt-Konto blieb auch hier angemeldet');
    },
  },
  {
    nr: 13,
    name: 'PIN-Sperre: fünf Fehlversuche, Uhrzeit, Aufhebung nach 15 Minuten',
    async lauf(h) {
      const { c } = h;
      await h.start();
      await h.marktAnmelden();
      await h.warteMitarbeiterAuswahl();
      await c.klick({ text: 'Ben', sel: 'button.mitarbeiter', genau: true });
      await c.warteAuf(() => document.querySelector('#pin'), { text: 'PIN-Feld' });
      for (let i = 1; i <= 4; i++) {
        await h.pinEingeben('0000');
        await h.ruhe();
        h.gleich(await h.meldung(), 'Die PIN stimmt nicht.', `Fehlversuch ${i}`);
      }
      await h.pinEingeben('0000');
      await h.ruhe();
      // Die Sperre dauert 15 Minuten ab 09:00 Uhr (Europe/Berlin).
      h.gleich(await h.meldung(), 'Dieser Mitarbeiter ist gesperrt. Gesperrt bis 09:15 Uhr.', 'Meldung mit Uhrzeit');
      const ben = await h.mitarbeiter('Ben');
      h.pruefe(ben.gesperrt && /^2026-11-16 08:15:00/.test(ben.gesperrt_bis), 'DB: gesperrt bis 09:15 Uhr Ortszeit', ben);
      await h.foto('gesperrt');

      await h.pinEingeben('1234'); // die richtige PIN gilt während der Sperre nicht
      await h.ruhe();
      h.gleich(await h.meldung(), 'Dieser Mitarbeiter ist gesperrt. Gesperrt bis 09:15 Uhr.', 'richtige PIN wird während der Sperre abgelehnt');
      h.gleich(await h.ansicht(), 'pin', 'bleibt bei der PIN');
      h.gleich(await h.sitzungen('Ben'), [], 'DB: keine Sitzung während der Sperre');

      await h.setzeJetzt(jetztPlus(16));
      await h.pinEingeben('1234');
      await h.warteListe();
      h.gleich(await h.text('.ansicht-liste .wer'), 'Ben', 'nach 16 Minuten klappt die Anmeldung');
      h.gleich((await h.sitzungen('Ben')).length, 1, 'DB: Sitzung angelegt');
      h.gleich((await h.mitarbeiter('Ben')).gesperrt, false, 'DB: Sperre aufgehoben');
    },
  },
  {
    nr: 15,
    name: 'Abmelden: sofort zur PIN-Ansicht, Sitzung in der Datenbank gelöscht',
    async lauf(h) {
      const { c, s } = h;
      await h.alsMitarbeiter('Anna');
      h.gleich((await h.sitzungen('Anna')).length, 1, 'DB: Sitzung vor dem Abmelden');

      // Messung in der Seite: vom Tipp auf „Abmelden“ bis zu den Namen in der PIN-Ansicht.
      await c.werte(() => {
        window.__m = {};
        document.addEventListener('click', (e) => { if (e.target.closest('button')?.textContent.trim() === 'Abmelden') window.__m.t0 = performance.now(); }, true);
        new MutationObserver((_, o) => {
          if (document.querySelector('.ansicht-pin button.mitarbeiter')) { window.__m.t1 = performance.now(); o.disconnect(); }
        }).observe(document.getElementById('ansicht'), { childList: true, subtree: true });
      });
      s.verzoegere(2000, { nur: 'mhd_pin_abmelden' }); // nur der Abmelde-Aufruf ist langsam
      try {
        await c.klick({ text: 'Abmelden', in: '.ansicht-liste', sel: 'button', genau: true });
        await c.warteAuf(() => window.__m.t1, { text: 'PIN-Ansicht nach dem Abmelden', ms: 5000 });
        const dauer = await c.werte(() => window.__m.t1 - window.__m.t0);
        h.pruefe(dauer < 500, 'PIN-Ansicht erscheint in unter 500 ms', `${Math.round(dauer)} ms`);
        h.notiz(`PIN-Ansicht nach ${Math.round(dauer)} ms bei 2000 ms langsamem Abmelde-Aufruf`);
        h.gleich((await h.sitzungen('Anna')).length, 1, 'DB: der langsame Aufruf ist noch nicht durch');
        h.gleich(await c.werte(() => sessionStorage.getItem('mhd-pin')), null, 'PIN-Sitzung im Tab sofort gelöscht');
        await h.foto('abgemeldet');
        const ende = Date.now() + 8000;
        while (Date.now() < ende && (await h.sitzungen('Anna')).length) await c.pause(100);
        h.gleich(await h.sitzungen('Anna'), [], 'DB: Sitzung in mhd.sitzungen gelöscht');
      } finally {
        s.verzoegere(0);
      }

      // Zum Vergleich (nur festgehalten, nicht bewertet): Ist der ganze Server langsam, kommen die Namen der PIN-Ansicht erst mit
      // deren eigener Abfrage (mhd_markt).
      await c.klick({ text: 'Anna', sel: 'button.mitarbeiter', genau: true });
      await h.pinEingeben('1234');
      await h.warteListe();
      await c.werte(() => {
        window.__m = {};
        document.addEventListener('click', (e) => { if (e.target.closest('button')?.textContent.trim() === 'Abmelden') window.__m.t0 = performance.now(); }, true);
        new MutationObserver((_, o) => {
          if (document.querySelector('.ansicht-pin') && !window.__m.t1) window.__m.t1 = performance.now();
          if (document.querySelector('.ansicht-pin button.mitarbeiter')) { window.__m.t2 = performance.now(); o.disconnect(); }
        }).observe(document.getElementById('ansicht'), { childList: true, subtree: true });
      });
      s.verzoegere(800);
      try {
        await c.klick({ text: 'Abmelden', in: '.ansicht-liste', sel: 'button', genau: true });
        await c.warteAuf(() => window.__m.t2, { text: 'Namen in der PIN-Ansicht', ms: 5000 });
        const m = await c.werte(() => window.__m);
        h.notiz(`Bei 800 ms langsamem Server: Ansicht nach ${Math.round(m.t1 - m.t0)} ms, Namen der Mitarbeiter nach ${Math.round(m.t2 - m.t0)} ms`);
      } finally {
        s.verzoegere(0);
      }
    },
  },
];
