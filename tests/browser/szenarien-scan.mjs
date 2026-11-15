// Szenarien zum Scannen per Handeingabe: bekannte und unbekannte Nummer, neuer Artikel, Waagen-Etikett.
import { tag } from './rahmen.mjs';

export default [
  {
    nr: 5,
    name: 'Scannen: bekannte Nummer, unbekannte Nummer, neuer Artikel',
    async lauf(h) {
      const { c } = h;
      await h.alsMitarbeiter('Anna');
      await h.knopf('Scannen', '.ansicht-liste');
      await h.warteAnsicht('scan');
      // Ohne Kamera (hier gibt es keine) bleibt die Handeingabe.
      await c.warteAuf(() => !/wird gestartet/.test(document.querySelector('.ansicht-scan .hinweis-text').textContent), { text: 'Kamera-Rückmeldung' });
      h.pruefe(/Kamera|Nummer eintippen/.test(await h.text('.ansicht-scan .hinweis-text')), 'Hinweis zur fehlenden Kamera', await h.text('.ansicht-scan .hinweis-text'));
      await h.foto('scan');
      await h.passtInsFenster('Scannen');

      h.s.verzoegere(1500, { nur: 'mhd_artikel_suchen' }); // langsame Suche: der Hinweis muss zu sehen sein
      try {
        await c.tippe('#ean', '4311501646854', { enter: true });
        const gesehen = await c.warteAuf(() => document.querySelector('.ansicht-scan .hinweis-text')?.textContent === 'Artikel wird gesucht …', { text: 'Hinweis während der Suche', ms: 1400 })
          .then(() => true, () => false);
        h.pruefe(gesehen, 'Hinweis „Artikel wird gesucht …“, solange die Suche läuft');
        await h.warteAnsicht('artikel');
      } finally {
        h.s.verzoegere(0);
      }
      await h.ruhe();
      h.gleich(await h.text('.ansicht-artikel h1'), 'Kefir', 'bekannte Nummer öffnet den Artikel');
      await h.knopf('Zurück', '.ansicht-artikel');
      await h.warteListe();

      await h.knopf('Scannen', '.ansicht-liste');
      await h.warteAnsicht('scan');
      await c.tippe('#ean', '4000000000006', { enter: true });
      await h.warteAnsicht('artikel-neu');
      await c.warteAuf(() => document.getElementById('name'), { text: 'Formular Neuer Artikel' });
      h.gleich(await h.text('.ansicht-artikel-neu h1'), 'Neuer Artikel', 'Neuanlage für die unbekannte Nummer');
      h.gleich(await c.werte(() => document.getElementById('name').value), '', 'Vorschlag ist leer');
      h.pruefe(!(await h.text('.ansicht-artikel-neu')).includes('Open Food Facts'), 'kein Hinweis auf Open Food Facts');
      h.pruefe((await h.text('.ansicht-artikel-neu')).includes('Strichcode 4000000000006'), 'Strichcode steht im Formular');
      h.gleich(await h.text('.ansicht-artikel-neu .unbekannt'),
        'Dieser Strichcode ist noch nicht in der App. Neue Ware? Dann hier anlegen. Falsche Ware gegriffen? Dann „Zurück“.',
        'Hinweis: Strichcode ist noch nicht in der App');
      await h.passtInsFenster('Neuer Artikel mit Hinweis');
      await h.foto('hinweis-unbekannt');
      await h.knopf('Speichern', '.ansicht-artikel-neu');
      h.gleich(await h.meldung(), 'Bitte einen Namen eingeben.', 'ohne Namen kein Speichern');
      await c.tippe('#name', 'Testbrot');
      await h.knopf('Speichern', '.ansicht-artikel-neu');
      h.gleich(await h.meldung(), 'Bitte eine Warengruppe wählen.', 'ohne Warengruppe kein Speichern');
      await h.waehleOption('#warengruppe', 'Backwaren');
      await h.foto('neuer-artikel');
      await h.passtInsFenster('Neuer Artikel');
      await h.knopf('Speichern', '.ansicht-artikel-neu');
      await h.warteAnsicht('artikel');
      await h.ruhe();
      h.gleich(await h.text('.ansicht-artikel h1'), 'Testbrot', 'danach der neue Artikel');
      h.gleich(await h.hinweis(), 'Artikel angelegt. Jetzt das vorderste MHD eingeben.', 'Hinweis zum MHD');
      let a = await h.artikel('Testbrot');
      h.gleich([a.ean, a.quelle, a.gruppe, a.bestand], ['4000000000006', 'hand', 'Backwaren', false], 'DB: Artikel angelegt');

      // Ein neuer Artikel: Hinweis, „MHD speichern“ und „Aus dem Sortiment nehmen“, keine Knöpfe für „ohne Bestand“.
      h.gleich(await h.text('.ansicht-artikel .frage'), 'Neuer Artikel – bitte das vorderste MHD eingeben.', 'Hinweis zum neuen Artikel');
      h.gleich(await h.knopfTexte('.ansicht-artikel .bereich'), ['MHD speichern', 'Aus dem Sortiment nehmen'], 'beide Knöpfe: „MHD speichern“ und „Aus dem Sortiment nehmen“');
      h.pruefe(!(await h.text('.ansicht-artikel')).includes('Wieder da'), 'kein „Wieder da“');
      await h.foto('neu-mhd');
      await h.passtInsFenster('Neuer Artikel nach dem Anlegen');
      await h.mhdEintippen(tag(10));
      await h.knopf('MHD speichern', '.ansicht-artikel');
      await h.warteListe();
      h.gleich(await h.hinweis(), 'MHD gespeichert.', 'Bestätigung');
      a = await h.artikel('Testbrot');
      h.gleich([a.mhd, a.bestand], [tag(10), true], 'DB: MHD gespeichert, Bestand');
      h.gleich((await h.protokoll('Testbrot')).map((p) => [p.art, p.mhd_neu, p.mitarbeiter]), [['geprueft', tag(10), 'Anna']], 'DB: Protokollzeile');
      // Zurück führt nicht ins Formular oder zum fertigen Artikel (die Liste ist die erste Stelle des Verlaufs).
      const v = await h.c.verlauf();
      h.pruefe(!/^http:\/\/127\.0\.0\.1:\d+\/$/.test(v.entries[v.currentIndex - 1]?.url ?? ''), 'vor der Liste liegt kein weiterer App-Eintrag');
      h.pruefe(await c.zurueck(), 'Zurück-Schritt möglich');
      await c.pause(300);
      h.gleich(await h.anzahl('.ansicht-artikel, .ansicht-artikel-neu'), 0, 'Zurück führt nicht in Artikel oder Formular');

      // Angelegt, aber ohne MHD zurück (Abbruch vor „MHD speichern“): Der Artikel steht sofort auf der Liste.
      await c.navigiere(`${h.s.url}/`);
      await h.warteListe();
      await h.knopf('Scannen', '.ansicht-liste');
      await h.warteAnsicht('scan');
      await c.tippe('#ean', '4000000000013', { enter: true });
      await h.warteAnsicht('artikel-neu');
      await c.warteAuf(() => document.getElementById('name'), { text: 'Formular Neuer Artikel' });
      await c.tippe('#name', 'Testsemmel');
      await h.waehleOption('#warengruppe', 'Backwaren');
      await h.knopf('Speichern', '.ansicht-artikel-neu');
      await h.warteAnsicht('artikel');
      await h.ruhe();
      h.gleich(await h.knopfTexte('.ansicht-artikel .bereich'), ['MHD speichern', 'Aus dem Sortiment nehmen'], 'zweiter neuer Artikel: beide Knöpfe');
      await h.knopf('Zurück', '.ansicht-artikel');
      await h.warteListe();
      const ohne = (await h.liste()).find((x) => x.schluessel === 'ohne_bestand');
      h.gleich(ohne?.titel, 'Ohne Bestand – wieder da? (2)', 'Abschnitt „Ohne Bestand – wieder da?“ mit dem neuen Artikel');
      h.gleich(ohne?.zeilen.find((z) => z.name === 'Testsemmel')?.status, 'MHD fehlt noch', 'Status „MHD fehlt noch“');
      h.gleich(await h.istListe(), await h.sollListe(), 'Liste entspricht der Datenbank');
      await h.foto('mhd-fehlt');
      await h.oeffneAusListe('ohne_bestand', 'Testsemmel');
      h.gleich(await h.text('.ansicht-artikel .frage'), 'Neuer Artikel – bitte das vorderste MHD eingeben.', 'aus der Liste: Hinweis zum neuen Artikel');
      h.gleich(await h.knopfTexte('.ansicht-artikel .bereich'), ['MHD speichern', 'Aus dem Sortiment nehmen'], 'aus der Liste: „MHD speichern“ und „Aus dem Sortiment nehmen“');
      h.gleich(await h.text('.ansicht-artikel .status-gross'), 'MHD fehlt noch', 'Status im Artikel');
      await h.passtInsFenster('Artikel „MHD fehlt noch“');
      await h.mhdEintippen(tag(5));
      await h.knopf('MHD speichern', '.ansicht-artikel');
      await h.warteListe();
      h.pruefe(!(await h.alleNamen()).includes('Testsemmel'), 'nach dem Speichern nicht mehr auf der Liste', await h.alleNamen());
      a = await h.artikel('Testsemmel');
      h.gleich([a.mhd, a.bestand], [tag(5), true], 'DB: MHD gespeichert, Bestand');

      // Versehentlich angelegt: „MHD fehlt noch“ lässt sich aus dem Sortiment nehmen.
      await h.knopf('Scannen', '.ansicht-liste');
      await h.warteAnsicht('scan');
      await c.tippe('#ean', '4000000000020', { enter: true });
      await h.warteAnsicht('artikel-neu');
      await c.warteAuf(() => document.getElementById('name'), { text: 'Formular Neuer Artikel' });
      await c.tippe('#name', 'Testkeks');
      await h.waehleOption('#warengruppe', 'Backwaren');
      await h.knopf('Speichern', '.ansicht-artikel-neu');
      await h.warteAnsicht('artikel');
      await h.ruhe();
      await h.knopf('Zurück', '.ansicht-artikel');
      await h.warteListe();
      await h.oeffneAusListe('ohne_bestand', 'Testkeks');
      h.gleich(await h.knopfTexte('.ansicht-artikel .bereich'), ['MHD speichern', 'Aus dem Sortiment nehmen'], 'Testkeks: beide Knöpfe');
      await h.knopf('Aus dem Sortiment nehmen', '.ansicht-artikel');
      await h.warteListe();
      h.pruefe(!(await h.alleNamen()).includes('Testkeks'), 'nach „Aus dem Sortiment nehmen“ nicht mehr auf der Liste', await h.alleNamen());
      a = await h.artikel('Testkeks');
      h.gleich(a.aktiv, false, 'DB: Artikel ruht');
      h.gleich((await h.protokoll('Testkeks')).map((p) => p.art), ['ruht'], 'DB: Protokollzeile „ruht“');
    },
  },
  {
    nr: 6,
    name: 'Scannen: Waagen-Etikett führt zur Suche „ohne Strichcode“',
    async lauf(h) {
      const { c } = h;
      await h.alsMitarbeiter('Anna');
      await h.knopf('Scannen', '.ansicht-liste');
      await h.warteAnsicht('scan');
      await c.tippe('#ean', '2912345003500', { enter: true });
      await h.warteAnsicht('suche');
      await c.warteAuf(() => document.querySelector('.ansicht-suche .zeile, .ansicht-suche .leer'), { text: 'Suchergebnis' });
      await h.ruhe();
      h.pruefe(await c.werte(() => document.getElementById('ohne-ean').checked), 'Haken „nur ohne Strichcode“ ist gesetzt');
      h.gleich(await h.text('.ansicht-suche .hinweis-text'), 'Waagen-Etikett: Artikel bitte aus der Liste wählen.', 'Hinweis zum Waagen-Etikett');
      h.gleich(await h.texte('.ansicht-suche .zeile .name'), ['Hackfleisch gemischt'], 'nur „Hackfleisch gemischt“ ist zu sehen');
      const ohne = await h.sql('select name from mhd.artikel where ean is null');
      h.gleich(ohne.map((r) => r.name), ['Hackfleisch gemischt'], 'DB: das ist der einzige Artikel ohne Strichcode');
      h.gleich(await h.sql('select count(*)::int as n from mhd.artikel where ean = $1', ['2912345003500']).then((r) => r[0].n), 0, 'DB: kein Artikel für das Etikett angelegt');
      await h.foto('suche');
      await h.passtInsFenster('Suche');
    },
  },
];
