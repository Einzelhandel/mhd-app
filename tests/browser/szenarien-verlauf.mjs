// Szenario zur Zurück-Taste des Handys (Browser-Verlauf).
const BUTTER = 'Deutsche Markenbutter - mildgesäuert';
const QUARK = 'SPEISEQUARK MAGERSTUFE';

export default [
  {
    nr: 14,
    name: 'Zurück-Taste: Liste, Suche, nach Aktion, nach Abmelden',
    async lauf(h) {
      const { c } = h;
      await h.alsMitarbeiter('Anna');

      // Liste → Artikel → Zurück = Liste
      await h.oeffneAusListe('laeuft_ab', BUTTER);
      h.pruefe(await c.zurueck(), 'Zurück-Schritt möglich');
      await h.warteListe();
      h.gleich(await h.ansicht(), 'liste', 'Zurück aus dem Artikel führt zur Liste');
      h.gleich(await h.text('.ansicht-liste h1'), 'Heute, Mo 16.11.', 'Liste ist wieder da');

      // Suche mit Text → Artikel → Zurück = Suche mit demselben Text
      await h.knopf('Suche', '.ansicht-liste');
      await h.warteAnsicht('suche');
      await c.tippe('#suchtext', 'sky');
      await c.warteAuf(() => document.querySelectorAll('.ansicht-suche button.zeile').length === 2, { text: 'zwei Treffer für „sky“' });
      await h.ruhe();
      await h.oeffneAusSuche('Skyr Natur');
      h.pruefe(await c.zurueck(), 'Zurück-Schritt aus dem Artikel möglich');
      await h.warteAnsicht('suche');
      await c.warteAuf(() => document.querySelectorAll('.ansicht-suche button.zeile').length === 2, { text: 'Treffer nach dem Zurück' });
      h.gleich(await c.werte(() => document.getElementById('suchtext').value), 'sky', 'Suchtext bleibt erhalten');
      h.gleich((await h.texte('.ansicht-suche .zeile .name')).sort(), ['Skyr', 'Skyr Natur'], 'dieselben Treffer');
      h.pruefe(await c.zurueck(), 'Zurück-Schritt aus der Suche möglich');
      await h.warteListe();
      h.gleich(await h.ansicht(), 'liste', 'Zurück aus der Suche führt zur Liste');

      // Abmelden: Weder Vor noch Zurück bringt die Liste oder den Artikel eines Abgemeldeten zurück.
      await h.oeffneAusListe('laeuft_ab', BUTTER);
      await c.zurueck();
      await h.warteListe();
      await h.knopf('Abmelden', '.ansicht-liste');
      await h.warteMitarbeiterAuswahl();
      h.pruefe(await c.vor(), 'Vor-Schritt zum früheren Artikel möglich');
      await h.warteAnsicht('pin');
      await h.warteMitarbeiterAuswahl();
      h.gleich(await h.ansicht(), 'pin', 'Vor führt nicht in den Artikel, sondern bleibt bei der PIN-Ansicht');
      h.gleich(await h.anzahl('.ansicht-artikel, .ansicht-liste'), 0, 'weder Artikel noch Liste im DOM (Vor)');
      h.pruefe(await c.zurueck(), 'Zurück-Schritt möglich');
      await h.warteAnsicht('pin');
      await h.warteMitarbeiterAuswahl();
      h.gleich(await h.ansicht(), 'pin', 'Zurück führt nicht in die Liste, sondern bleibt bei der PIN-Ansicht');
      h.gleich(await h.anzahl('.ansicht-artikel, .ansicht-liste'), 0, 'weder Artikel noch Liste im DOM (Zurück)');
      await h.foto('nach-abmelden');

      // Nach einer Aktion (Geprüft) führt Zurück nicht wieder in den erledigten Artikel.
      await c.klick({ text: 'Anna', sel: 'button.mitarbeiter', genau: true });
      await h.pinEingeben('1234');
      await h.warteListe();
      await h.oeffneAusListe('pruefen', QUARK);
      await h.knopf('Geprüft', '.ansicht-artikel');
      await h.warteListe();
      h.pruefe(!(await h.alleNamen()).includes(QUARK), 'Artikel ist erledigt und nicht mehr in der Liste');
      const verlauf = await c.verlauf();
      const davor = verlauf.entries[verlauf.currentIndex - 1]?.url;
      h.pruefe(davor !== undefined && !/^http:\/\/127\.0\.0\.1:\d+\/$/.test(davor), 'vor der Liste liegt kein weiterer Eintrag der App (kein Artikel)', davor);
      h.pruefe(await c.zurueck(), 'Zurück-Schritt möglich');
      await c.pause(300);
      h.gleich(await h.anzahl('.ansicht-artikel'), 0, 'Zurück zeigt den erledigten Artikel nicht');
    },
  },
];
