// Ansicht „Scannen“: Kamera, Handeingabe (auch für Handscanner, die als Tastatur arbeiten)
// und die Entscheidung, was nach einem gelesenen Strichcode geschieht.
//
// Strichcode-Leser: Wo der Browser einen BarcodeDetector hat, der EAN-13 kann (Chrome auf Android), wird er
// benutzt; scheitert er 5-mal in Folge, übernimmt die Bibliothek. Sonst wird gleich vendor/zxing.min.js
// nachgeladen. Diese Datei ist eine unveränderte Kopie von
// node_modules/@zxing/library/umd/index.min.js aus dem npm-Paket @zxing/library 0.23.0
// (Lizenz: vendor/LICENSE-zxing.txt, Kopie von node_modules/@zxing/library/LICENSE).
import { ansichten, wechsle, mhdRpc } from './app.js';
import { element, meldung, fehlertext } from './hilfe.js';
import { normalisiereEan, istWaagencode } from './ean.js';
import { holeOff } from './off.js';

const TAKT_MS = 200;
const FORMATE = ['ean_13', 'ean_8', 'upc_a'];
const MAX_FEHLER = 5; // so viele Fehler von detect() in Folge, dann die Bibliothek
const NICHT_LESBAR = 'Strichcode nicht lesbar. Bitte noch einmal scannen oder Nummer eintippen.';
const WAAGE = 'Waagen-Etikett: Artikel bitte aus der Liste wählen.';

// Reine Entscheidung ohne DOM. `rpc` und `off` werden übergeben (in der App: mhdRpc und holeOff).
// Reihenfolge: Text prüfen, Waagen-Code, Artikel im Markt suchen, nur für Unbekannte Open Food Facts fragen.
export async function nachScan(text, { rpc, off }) {
  const ean = normalisiereEan(text);
  if (!ean) return { ziel: 'fehler', meldung: NICHT_LESBAR };
  if (istWaagencode(ean)) return { ziel: 'suche', daten: { ohneEan: true }, meldung: WAAGE };
  const artikel = await rpc('mhd_artikel_suchen', { p_ean: ean });
  if (artikel) return { ziel: 'artikel', daten: { artikel, vonScan: true } };
  const vorschlag = (await off(ean)) ?? null;
  return { ziel: 'artikel-neu', daten: { ean, vorschlag, quelle: vorschlag ? 'off' : 'hand' } };
}

// Liest die Kamera denselben Strichcode wie beim eben bearbeiteten Artikel (`eben`, EAN aus der Datenbank)?
// Nach einer Aktion kehrt die App zum Scanner zurück; die Ware liegt dann oft noch vor der Kamera.
export function gleicherCode(text, eben) {
  return Boolean(eben) && (text === eben || normalisiereEan(text) === eben);
}

// ---- Kamera ----

// Welcher Leser: 'detektor' nur, wenn der BarcodeDetector EAN-13 kann (`formate` aus getSupportedFormats(),
// null ohne BarcodeDetector), sonst 'zxing'. Mancher Browser kennt den Konstruktor, erkennt aber nichts.
export function leserWahl(formate) {
  return Array.isArray(formate) && formate.includes('ean_13') ? 'detektor' : 'zxing';
}

// Liest mit `erster`; nach MAX_FEHLER Fehlern in Folge wird der Ersatz einmal geholt und liest von da an.
// „Nichts erkannt“ (null) zählt als gelungener Versuch. Lässt sich der Ersatz nicht holen: Fehler LESER_FEHLT.
export function mitErsatz(erster, holeErsatz, grenze = MAX_FEHLER) {
  let fehler = 0;
  let ersatz = null;
  return async (bild) => {
    if (ersatz) return ersatz(bild);
    try {
      const text = await erster(bild);
      fehler = 0;
      return text;
    } catch {
      fehler += 1;
      if (fehler < grenze) return null;
      try { ersatz = await holeErsatz(); } catch { throw new Error('LESER_FEHLT'); }
      return null;
    }
  };
}

function ladeZxing() {
  if (globalThis.ZXing) return Promise.resolve(globalThis.ZXing);
  return new Promise((ok, nein) => {
    const skript = element('script', { src: 'vendor/zxing.min.js' });
    skript.addEventListener('load', () => (globalThis.ZXing ? ok(globalThis.ZXing) : nein(new Error('ZXING'))));
    skript.addEventListener('error', () => nein(new Error('ZXING')));
    document.head.append(skript);
  });
}

async function unterstuetzteFormate() {
  if (!('BarcodeDetector' in window)) return null;
  try { return await window.BarcodeDetector.getSupportedFormats(); } catch { return null; }
}

// Liefert eine Funktion video → gelesener Text oder null.
async function baueLeser() {
  const formate = await unterstuetzteFormate();
  if (leserWahl(formate) === 'detektor') {
    try {
      const detektor = new window.BarcodeDetector({ formats: FORMATE.filter((f) => formate.includes(f)) });
      return mitErsatz(async (video) => (await detektor.detect(video))[0]?.rawValue ?? null, baueZxing);
    } catch { /* Konstruktor scheitert: Bibliothek nehmen */ }
  }
  return baueZxing();
}

async function baueZxing() {
  const Z = await ladeZxing();
  const hinweise = new Map([[Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_A]]]);
  // Das Bild (Canvas, Graustufen) baut BrowserMultiFormatReader. Gelesen wird mit dem 1D-Leser selbst: Der
  // MultiFormatReader der Bibliothek schreibt bei jedem Bild ohne Strichcode eine Warnung in die Konsole.
  const bildleser = new Z.BrowserMultiFormatReader(hinweise);
  const leser = new Z.MultiFormatOneDReader(hinweise);
  return async (video) => {
    try { return leser.decode(bildleser.createBinaryBitmap(video), hinweise).getText(); } catch { return null; } // „nichts gefunden“ ist der Normalfall
  };
}

const KEINE_KAMERA = {
  sicher: 'Die Kamera ist hier nicht verfügbar (sie braucht eine sichere Verbindung). Bitte die Nummer eintippen.',
  NotAllowedError: 'Die Kamera ist nicht erlaubt. Bitte in den Einstellungen des Browsers freigeben oder die Nummer eintippen.',
  NotFoundError: 'Es wurde keine Kamera gefunden. Bitte die Nummer eintippen.',
  anders: 'Die Kamera lässt sich nicht starten. Bitte die Nummer eintippen.',
  leser: 'Scannen geht auf diesem Gerät nicht. Bitte die Nummer eintippen.',
};

// daten (optional): { eben } – Strichcode des Artikels, der gerade bearbeitet wurde (siehe gleicherCode).
ansichten.scan = (wurzel, daten) => {
  const eben = daten?.eben ?? null;
  let strom = null;
  let takt = null;
  let laeuft = false; // ein Ergebnis wird gerade verarbeitet: nicht weiter lesen
  let letzter = null; // zuletzt von der Kamera gelesener Text: dieselbe Nummer nicht noch einmal behandeln

  const video = element('video', { class: 'kamera', playsinline: true, autoplay: true, hidden: true });
  video.muted = true;
  const status = element('p', { class: 'hinweis-text' }, 'Kamera wird gestartet …');
  const feld = element('input', {
    id: 'ean', name: 'ean', type: 'text', inputmode: 'numeric', pattern: '[0-9]*',
    autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false',
  });

  function stoppeKamera() {
    clearInterval(takt);
    takt = null;
    for (const spur of strom?.getTracks() ?? []) spur.stop();
    strom = null;
  }

  function ohneKamera(grund) {
    stoppeKamera();
    video.hidden = true;
    status.textContent = KEINE_KAMERA[grund] ?? KEINE_KAMERA.anders;
    feld.focus();
  }

  async function verarbeite(text) {
    if (laeuft || !wurzel.isConnected) return;
    laeuft = true;
    meldung('');
    const vorher = status.textContent;
    status.textContent = 'Artikel wird gesucht …';
    try {
      const ergebnis = await nachScan(text, { rpc: mhdRpc, off: holeOff });
      if (!wurzel.isConnected) return;
      if (ergebnis.ziel === 'fehler') {
        meldung(ergebnis.meldung);
        feld.select();
        return;
      }
      stoppeKamera();
      wechsle(ergebnis.ziel, ergebnis.ziel === 'suche' ? { ...ergebnis.daten, hinweis: ergebnis.meldung } : ergebnis.daten);
    } catch (fehler) {
      letzter = null; // gleich noch einmal versuchen dürfen
      if (!fehler.behandelt) meldung(fehlertext(fehler.message));
    } finally {
      laeuft = false;
      if (status.textContent === 'Artikel wird gesucht …') status.textContent = vorher;
    }
  }

  async function starteKamera() {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) return ohneKamera('sicher');
    let neu;
    try {
      neu = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    } catch (fehler) {
      return ohneKamera(fehler.name);
    }
    if (!wurzel.isConnected) { // Ansicht schon verlassen, während die Kamera anlief
      for (const spur of neu.getTracks()) spur.stop();
      return undefined;
    }
    strom = neu;
    video.srcObject = neu;
    video.hidden = false;
    video.play().catch(() => {});
    let lies;
    try {
      lies = await baueLeser();
    } catch {
      return ohneKamera('leser');
    }
    if (!wurzel.isConnected) { stoppeKamera(); return undefined; }
    status.textContent = 'Strichcode ins Bild halten.';
    let beschaeftigt = false;
    takt = setInterval(async () => {
      if (!wurzel.isConnected) { stoppeKamera(); return; } // Ansicht verlassen
      if (beschaeftigt || laeuft || video.readyState < 2) return;
      beschaeftigt = true;
      try {
        const text = await lies(video);
        if (text && text !== letzter && !gleicherCode(text, eben) && !laeuft) {
          letzter = text;
          verarbeite(text);
        }
      } catch (fehler) {
        if (fehler.message === 'LESER_FEHLT') ohneKamera('leser'); // auch die Bibliothek lässt sich nicht laden
      } finally {
        beschaeftigt = false;
      }
    }, TAKT_MS);
    return undefined;
  }

  wurzel.append(
    element('header', { class: 'kopf' },
      element('button', { type: 'button', class: 'knopf klein', onclick: () => { stoppeKamera(); wechsle('liste'); } }, 'Zurück'),
      element('h1', {}, 'Scannen')),
    video,
    status,
    element('form', { class: 'formular', novalidate: true, onsubmit: (e) => { e.preventDefault(); verarbeite(feld.value); } },
      element('label', { for: 'ean' }, 'Nummer eintippen'),
      feld,
      element('button', { type: 'submit', class: 'knopf haupt' }, 'Weiter')));
  return starteKamera();
};
