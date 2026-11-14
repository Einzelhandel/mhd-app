// Zurück-Taste des Handys: Welche Ansicht gehört zu welchem Eintrag der Browser-Historie?
// Reine Logik, kein DOM; app.js spiegelt die Entscheidungen in history.pushState/replaceState.
//
// Der Stapel hat einen Eintrag je Historien-Eintrag: { ansicht, daten }.

// Anmeldung und PIN legen keine Einträge an: Zurück führt nie dorthin.
export const OHNE_EINTRAG = new Set(['anmeldung', 'pin']);
// Durchgangsansichten (Kamera, Formular) werden beim Weitergehen ersetzt:
// Von Scan → Neuer Artikel → Artikel führt Zurück zur Liste, nicht ins Formular.
export const DURCHGANG = new Set(['scan', 'artikel-neu']);

export const neuerStapel = () => ({ eintraege: [], position: -1 });

// Wechsel zu `ansicht`. Liefert:
//   stapel   der neue Stapel
//   aktion   'anlegen' (pushState), 'ersetzen' (replaceState) oder 'zurueck' (history.go(-schritte))
//   eintrag  der Eintrag der neuen Ansicht ({ ansicht, daten })
//   zeige    was angezeigt wird (bei 'zurueck' mit den Daten, die der Eintrag gespeichert hat)
//   vorher   (nur bei 'anlegen', sonst fehlt es) der Eintrag darunter, dessen Daten nachgetragen wurden
//            (z. B. der Suchtext), samt Stelle `nr`; er ist per replaceState zu aktualisieren
// `daten.zurueck` ({ ansicht, daten }) sagt, in welchem Zustand die Ansicht darunter wieder erscheinen soll.
export function vor(stapel, ansicht, daten) {
  const basis = stapel.eintraege.slice(0, stapel.position + 1);
  const oben = basis.at(-1);
  const zurueck = daten?.zurueck;

  if (oben && !OHNE_EINTRAG.has(ansicht) && oben.ansicht !== ansicht) {
    const ziel = basis.findLastIndex((e) => e.ansicht === ansicht);
    if (ziel >= 0) {
      const eintraege = basis.slice(0, ziel + 1);
      return {
        stapel: { eintraege, position: ziel },
        aktion: 'zurueck',
        schritte: basis.length - 1 - ziel,
        eintrag: eintraege[ziel],
        zeige: { ansicht, daten: daten ?? eintraege[ziel].daten },
      };
    }
  }

  const eintrag = { ansicht, daten };
  const ersetzen = !oben || OHNE_EINTRAG.has(ansicht) || OHNE_EINTRAG.has(oben.ansicht)
    || DURCHGANG.has(oben.ansicht) || oben.ansicht === ansicht;
  if (ersetzen) {
    const eintraege = [...basis.slice(0, -1), eintrag];
    return { stapel: { eintraege, position: eintraege.length - 1 }, aktion: 'ersetzen', eintrag, zeige: eintrag };
  }
  const ergebnis = { aktion: 'anlegen', eintrag, zeige: eintrag };
  if (zurueck && zurueck.ansicht === oben.ansicht) {
    basis[basis.length - 1] = { ansicht: oben.ansicht, daten: zurueck.daten };
    ergebnis.vorher = { nr: basis.length - 1, ...basis.at(-1) };
  }
  const eintraege = [...basis, eintrag];
  return { ...ergebnis, stapel: { eintraege, position: eintraege.length - 1 } };
}

// Der Benutzer ist per Zurück (oder Vor) bei Eintrag `nr` gelandet.
// `sitzung`: { angemeldet, pin } = Markt-Konto angemeldet / PIN-Sitzung gültig.
// Geschützte Ansichten erscheinen nur mit gültiger PIN; sonst tritt PIN oder Anmeldung an ihre Stelle.
// Liefert { stapel, eintrag, ersetzen } (ersetzen: der Eintrag der Historie muss überschrieben werden)
// oder null, wenn der Eintrag unbekannt ist (z. B. nach Neuladen der Seite).
export function zurueckZu(stapel, nr, sitzung) {
  const gespeichert = Number.isInteger(nr) ? stapel.eintraege[nr] : undefined;
  if (!gespeichert) return null;
  let soll = gespeichert.ansicht;
  if (!sitzung.angemeldet) soll = 'anmeldung';
  else if (!sitzung.pin) soll = 'pin';
  else if (OHNE_EINTRAG.has(soll)) soll = 'liste';
  const ersetzen = soll !== gespeichert.ansicht;
  const eintrag = ersetzen ? { ansicht: soll } : gespeichert;
  const eintraege = stapel.eintraege.slice();
  eintraege[nr] = eintrag;
  return { stapel: { eintraege, position: nr }, eintrag, ersetzen };
}
