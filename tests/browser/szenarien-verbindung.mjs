// Szenarien zur Verbindung: abgelaufenes Token des Markt-Kontos, hängender Server.
import { tag } from './rahmen.mjs';

const QUARK = 'SPEISEQUARK MAGERSTUFE';
const KEINE_VERBINDUNG = 'Keine Verbindung. Bitte prüfe das Netz.';

export default [
  {
    nr: 18,
    name: 'Token abgelaufen: stille Erneuerung, Mitarbeiter merkt nichts',
    erlaubt: [{ status: 401, url: '/rest/v1/rpc/mhd_aktion' }],
    async lauf(h) {
      const { c } = h;
      await h.alsMitarbeiter('Anna');
      const vorher = await c.werte(() => JSON.parse(localStorage.getItem('mhd-markt')));
      const zeilen = (await h.protokoll(QUARK)).length;
      await h.post('/test/token-ablauf', {}); // der Server kennt das Token nicht mehr, das Erneuerungs-Token gilt
      await h.oeffneAusListe('pruefen', QUARK);
      await h.mhdEintippen(tag(30));
      await h.knopf('Geprüft', '.ansicht-artikel');
      await h.warteListe();
      h.gleich(await h.hinweis(), 'Geprüft.', 'die Aktion gelingt');
      h.gleich(await h.meldung(), '', 'keine Fehlermeldung');
      h.gleich(await h.ansicht(), 'liste', 'keine Anmeldeseite');
      const nachher = await c.werte(() => JSON.parse(localStorage.getItem('mhd-markt')));
      h.pruefe(nachher && nachher.token !== vorher.token && nachher.refresh !== vorher.refresh, 'neues Token-Paar gespeichert');
      h.pruefe(await c.werte(() => Boolean(sessionStorage.getItem('mhd-pin'))), 'PIN-Sitzung blieb');
      const p = await h.protokoll(QUARK);
      h.gleich([p.length, p.at(-1).art, p.at(-1).mhd_neu], [zeilen + 1, 'geprueft', tag(30)], 'DB: genau eine Protokollzeile');
      h.gleich(await h.istListe(), await h.sollListe(), 'Liste entspricht der Datenbank');
    },
  },
  {
    nr: 19,
    name: 'Zeitgrenze: Server hängt, nach 15 Sekunden Meldung, Knöpfe wieder bedienbar',
    async lauf(h) {
      const { c, s } = h;
      await h.alsMitarbeiter('Anna');
      const zeilen = (await h.protokoll(QUARK)).length;
      await h.oeffneAusListe('pruefen', QUARK);
      s.verzoegere(17000, { nur: 'mhd_aktion' });
      try {
        await h.knopf('Geprüft', '.ansicht-artikel');
        h.pruefe(await c.werte(() => [...document.querySelectorAll('.ansicht-artikel .bereich button')].every((b) => b.disabled)), 'Knöpfe gesperrt, solange der Aufruf läuft');
        const t0 = Date.now();
        await c.warteAuf((t) => document.getElementById('meldung').textContent === t, { text: 'Meldung nach der Zeitgrenze', ms: 20000 }, KEINE_VERBINDUNG);
        const dauer = Date.now() - t0;
        h.pruefe(dauer > 12000 && dauer < 17000, 'Meldung nach etwa 15 Sekunden', `${dauer} ms`);
        h.notiz(`Meldung nach ${dauer} ms (Server antwortet erst nach 17000 ms)`);
        h.gleich(await h.ansicht(), 'artikel', 'bleibt im Artikel');
        h.gleich(await c.werte(() => [...document.querySelectorAll('.ansicht-artikel .bereich button')].map((b) => b.disabled)), [false, false, false], 'Knöpfe wieder bedienbar');
        await h.foto('zeitgrenze');
        // Die Anfrage war schon beim Server; er führt sie noch aus. Abwarten, damit das nächste Szenario sauber beginnt.
        const ende = Date.now() + 8000;
        while (Date.now() < ende && (await h.protokoll(QUARK)).length === zeilen) await c.pause(200);
        h.gleich((await h.protokoll(QUARK)).length, zeilen + 1, 'DB: die abgebrochene Aktion kam trotzdem an (ob sie gespeichert ist, zeigt danach die Liste)');
      } finally {
        s.verzoegere(0);
      }
      await h.knopf('Geprüft', '.ansicht-artikel');
      await h.warteListe();
      h.gleich(await h.hinweis(), 'Geprüft.', 'derselbe Knopf funktioniert danach wieder');
    },
  },
];
