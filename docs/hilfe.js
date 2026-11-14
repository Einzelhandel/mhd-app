// Gemeinsame Helfer der Oberfläche. Beim Import wird nichts am DOM angefasst.
// Aufbau übernommen aus einem früheren eigenen Projekt.

export const $ = (id) => document.getElementById(id);

// element('button', { class: 'x', onclick: fn, hidden: true }, 'Text', kindElement)
// Text wird immer als Textknoten eingefügt, nie als HTML.
export function element(tag, attribute = {}, ...kinder) {
  const e = document.createElement(tag);
  for (const [name, wert] of Object.entries(attribute || {})) {
    if (wert === false || wert == null) continue;
    if (name.startsWith('on') && typeof wert === 'function') e.addEventListener(name.slice(2), wert);
    else if (name === 'class') e.className = wert;
    else e.setAttribute(name, wert === true ? '' : wert);
  }
  for (const k of kinder.flat(Infinity)) {
    if (k == null || k === false) continue;
    e.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return e;
}

// Attribute eines PIN-Feldes. Das Gerät im Markt teilen sich mehrere Mitarbeiter: Der Browser darf eine PIN weder
// zum Speichern anbieten noch beim nächsten Mitarbeiter eintragen, deshalb kein Passwortfeld; die Ziffern
// verdeckt die Klasse pin-feld per CSS. Die Sicherheitsattribute lassen sich nicht überschreiben.
export function pinAttribute(extra = {}) {
  return {
    ...extra,
    type: 'text', inputmode: 'numeric', pattern: '[0-9]*', autocomplete: 'off', maxlength: '6',
    autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false',
    class: ['pin-feld', extra.class].filter(Boolean).join(' '),
  };
}

export const pinFeld = (extra = {}) => element('input', pinAttribute(extra));

const FEHLER = {
  // Browser-Schicht und Anmeldung
  KEINE_VERBINDUNG: 'Keine Verbindung. Bitte prüfe das Netz.',
  NICHT_ANGEMELDET: 'Die Anmeldung des Marktes ist abgelaufen. Bitte neu anmelden.',
  invalid_credentials: 'Konto oder Passwort stimmt nicht.',
  invalid_grant: 'Konto oder Passwort stimmt nicht.',
  PIN_FALSCH: 'Die PIN stimmt nicht.',
  PIN_GESPERRT: 'Dieser Mitarbeiter ist gesperrt.',
  // Datenbank
  AKTION_UNGUELTIG: 'Diese Aktion gibt es nicht.',
  ARTIKEL_UNBEKANNT: 'Diesen Artikel gibt es nicht (mehr).',
  ARTIKEL_VORHANDEN: 'Diesen Artikel gibt es schon.',
  BESTAND_VORHANDEN: 'Der Artikel hat Bestand. Er lässt sich nur ohne Bestand aus dem Sortiment nehmen.',
  EAN_UNGUELTIG: 'Der Strichcode ist ungültig.',
  KEIN_BESTAND: 'Der Artikel hat keinen Bestand.',
  KEIN_ZUGRIFF: 'Kein Zugriff: Dieses Konto gehört zu keinem Markt.',
  KONTO_UNBEKANNT: 'Dieses Konto gibt es nicht.',
  LETZTE_LEITUNG: 'Die letzte Marktleitung lässt sich nicht ändern oder entfernen.',
  MHD_FEHLT: 'Bitte ein MHD eingeben.',
  MITARBEITER_UNBEKANNT: 'Diesen Mitarbeiter gibt es nicht (mehr).',
  NAME_FEHLT: 'Bitte einen Namen eingeben.',
  NAME_VERGEBEN: 'Diesen Namen gibt es schon.',
  NUR_LEITUNG: 'Das darf nur die Marktleitung.',
  PIN_ABGELAUFEN: 'Bitte die PIN neu eingeben.',
  PIN_UNGUELTIG: 'Die PIN muss aus 4 bis 6 Ziffern bestehen.',
  PROTOKOLL_UNVERAENDERLICH: 'Das Protokoll lässt sich nicht ändern.',
  QUELLE_UNGUELTIG: 'Die Quelle der Artikeldaten ist ungültig.',
  REGEL_UNGUELTIG: 'Die Regel ist ungültig: Reduzieren darf nicht früher kommen als Prüfen.',
  ROLLE_UNGUELTIG: 'Die Rolle ist ungültig.',
  WAAGENCODE: 'Das ist ein Waagen-Etikett, kein Artikel-Strichcode.',
  WARENGRUPPE_UNBEKANNT: 'Diese Warengruppe gibt es nicht (mehr).',
};

export function fehlertext(code) {
  return FEHLER[code] || 'Das hat nicht geklappt. Bitte noch einmal versuchen.';
}

// Fehler stehen oben, bis die nächste Meldung kommt.
// Erfolg (art 'ok') erscheint als Hinweis unten und verschwindet nach 3 Sekunden.
let hinweisUhr = null;
export function meldung(text, art = 'fehler') {
  const feld = $('meldung');
  const hinweis = Boolean(text) && art === 'ok';
  if (hinweis) {
    const h = $('hinweis');
    h.textContent = text;
    h.hidden = false;
    clearTimeout(hinweisUhr);
    hinweisUhr = setTimeout(() => { h.hidden = true; }, 3000);
  }
  feld.textContent = hinweis ? '' : text || '';
  feld.hidden = hinweis || !text;
  if (text && !hinweis) feld.scrollIntoView({ block: 'nearest' });
}

// Sperrt alle Knöpfe unterhalb von `wurzel`, solange `aufgabe` läuft (kein doppeltes Absenden).
// Ein weiterer Aufruf für dieselbe `wurzel` in dieser Zeit (z. B. Enter im Feld, das keinen Knopf braucht)
// wird ignoriert. Fehler werden angezeigt, es sei denn, sie sind schon behandelt (z. B. Wechsel zur Anmeldung).
// `zeigeFehler` (optional) nimmt den Fehlertext statt der Meldung oben, z. B. für eine Stelle am Formular.
const gesperrt = new WeakSet();
export async function mitSperre(wurzel, aufgabe, zeigeFehler = meldung) {
  if (gesperrt.has(wurzel)) return undefined;
  gesperrt.add(wurzel);
  const knoepfe = [...wurzel.querySelectorAll('button')].filter((k) => !k.disabled);
  for (const k of knoepfe) k.disabled = true;
  try {
    return await aufgabe();
  } catch (fehler) {
    if (!fehler.behandelt) zeigeFehler(fehlertext(fehler.message));
  } finally {
    gesperrt.delete(wurzel);
    for (const k of knoepfe) k.disabled = false;
  }
}

// Ausweg, wenn eine Ansicht ihre Daten nicht laden konnte: „Erneut versuchen“ und (wenn `zurueck`
// gegeben ist) „Zurück“. Die Fehlermeldung selbst steht oben (meldung()).
export function ausweg(erneut, zurueck) {
  return element('div', { class: 'ausweg' },
    element('button', { type: 'button', class: 'knopf haupt', onclick: erneut }, 'Erneut versuchen'),
    zurueck && element('button', { type: 'button', class: 'knopf', onclick: zurueck }, 'Zurück'));
}

// Uhrzeit (Europe/Berlin) eines Zeitstempels, z. B. '14:05'.
export function uhrzeit(zeitstempel) {
  return new Date(zeitstempel).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' });
}
