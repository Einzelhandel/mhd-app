// Minimaler Browser-Treiber über das DevTools-Protokoll (CDP), ohne npm-Abhängigkeit (Node 22+: fetch, WebSocket).
// Startet Chrome oder Edge headless mit eigenem Wegwerf-Profil (ohne Passwortverwaltung), als Handy 390 x 844 mit
// Touch, verbindet sich mit dem ersten Tab und bietet: navigiere, werte (evaluate), warteAuf, klick (Fingertipp
// oder Maus als echtes Eingabe-Ereignis), tippe, taste, setzeWert, zurueck/vor (Browser-Zurück), foto und ein
// Protokoll von Konsolenfehlern, Ausnahmen, Sicherheitsverstößen (CSP) und fehlgeschlagenen Anfragen.
// Aufbau übernommen aus einem früheren eigenen Projekt.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Chrome zuerst, sonst Edge – beide sprechen dasselbe DevTools-Protokoll.
export const BROWSER = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/microsoft-edge',
].find(existsSync);

// Wegwerf-Profil löschen; der Browser gibt Dateien nach dem Beenden evtl. erst kurz danach frei.
const profilWeg = (profil) => {
  try { rmSync(profil, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* bleibt liegen */ }
};

const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));

// zusatz: weitere Schalter für den Browser (z. B. eine nachgebildete Kamera).
export async function starteBrowser({ breite = 390, hoehe = 844, zusatz = [] } = {}) {
  if (!BROWSER) throw new Error('Kein Chrome oder Edge gefunden');
  const profil = mkdtempSync(join(tmpdir(), 'mhd-cdp-'));
  // Das Passwortfeld der Markt-Anmeldung würde sonst die Passwortverwaltung auslösen, die danach Eingaben verschluckt.
  mkdirSync(join(profil, 'Default'), { recursive: true });
  writeFileSync(join(profil, 'Default', 'Preferences'), JSON.stringify({
    credentials_enable_service: false,
    profile: { password_manager_enabled: false },
  }));
  const prozess = spawn(BROWSER, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', `--user-data-dir=${profil}`, '--password-store=basic', '--use-mock-keychain',
    '--hide-scrollbars', '--disable-extensions', '--disable-renderer-backgrounding',
    `--window-size=${breite},${hoehe}`, '--lang=de-DE', ...zusatz, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsBrowser = await new Promise((ok, fehler) => {
    let text = '';
    const uhr = setTimeout(() => fehler(new Error(`Der Browser meldet keinen DevTools-Port:\n${text}`)), 20000);
    prozess.stderr.on('data', (d) => {
      text += d;
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(text);
      if (m) { clearTimeout(uhr); ok(m[1]); }
    });
    prozess.once('exit', (code) => { clearTimeout(uhr); fehler(new Error(`Der Browser endete sofort (Code ${code}):\n${text}`)); });
  });
  const port = new URL(wsBrowser).port;
  let ziel;
  for (let i = 0; i < 50 && !ziel; i++) {
    const liste = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    ziel = liste.find((t) => t.type === 'page');
    if (!ziel) await pause(100);
  }
  const ws = new WebSocket(ziel.webSocketDebuggerUrl);
  await new Promise((ok, fehler) => { ws.onopen = ok; ws.onerror = fehler; });

  let naechsteId = 1;
  const offen = new Map();
  const hoerer = new Map(); // methode → Set(fn)
  ws.onmessage = (nachricht) => {
    const m = JSON.parse(nachricht.data);
    if (m.id && offen.has(m.id)) {
      const { ok, fehler, methode } = offen.get(m.id);
      offen.delete(m.id);
      if (m.error) fehler(new Error(`${methode}: ${m.error.message}`));
      else ok(m.result);
    } else if (m.method) {
      for (const fn of hoerer.get(m.method) ?? []) fn(m.params);
    }
  };
  const sende = (methode, params = {}, ms = 20000) => new Promise((ok, fehler) => {
    const id = naechsteId++;
    const uhr = setTimeout(() => { offen.delete(id); fehler(new Error(`Zeitüberschreitung CDP ${methode}`)); }, ms);
    offen.set(id, { ok: (x) => { clearTimeout(uhr); ok(x); }, fehler: (e) => { clearTimeout(uhr); fehler(e); }, methode });
    ws.send(JSON.stringify({ id, method: methode, params }));
  });
  const auf = (methode, fn) => {
    if (!hoerer.has(methode)) hoerer.set(methode, new Set());
    hoerer.get(methode).add(fn);
    return () => hoerer.get(methode).delete(fn);
  };
  const einmal = (methode, ms = 30000) => new Promise((ok, fehler) => {
    const uhr = setTimeout(() => { weg(); fehler(new Error(`Zeitüberschreitung: ${methode}`)); }, ms);
    const weg = auf(methode, (p) => { clearTimeout(uhr); weg(); ok(p); });
  });

  // ---- Protokoll: Konsole, Ausnahmen, Sicherheitsverstöße, Netzwerk
  // Eintrag: { art, text, url?, status?, fehler? }. Die Meldung „Failed to load resource“ des Browsers (Log-Quelle
  // network) wird nicht doppelt geführt: Fehlerantworten stehen als art 'http' mit Status und Fehlercode im Protokoll.
  const protokoll = [];
  const anfragen = new Map();
  auf('Runtime.consoleAPICalled', (p) => {
    if (p.type === 'error' || p.type === 'assert' || p.type === 'warning') {
      protokoll.push({ art: `console.${p.type}`, text: p.args.map((a) => a.value ?? a.description ?? '').join(' ') });
    }
  });
  auf('Runtime.exceptionThrown', (p) => {
    const d = p.exceptionDetails;
    protokoll.push({ art: 'exception', text: `${d.exception?.description ?? d.text} (${d.url ?? ''}:${d.lineNumber})` });
  });
  auf('Log.entryAdded', (p) => {
    if (p.entry.source === 'network') return;
    if (p.entry.level === 'error' || p.entry.level === 'warning') {
      protokoll.push({ art: `log.${p.entry.source}.${p.entry.level}`, text: p.entry.text, url: p.entry.url });
    }
  });
  auf('Network.requestWillBeSent', (p) => anfragen.set(p.requestId, { url: p.request.url, methode: p.request.method }));
  auf('Network.responseReceived', (p) => {
    const a = anfragen.get(p.requestId);
    if (a) a.status = p.response.status;
    if (p.response.status >= 400) {
      const eintrag = { art: 'http', text: `${p.response.status} ${p.response.url}`, url: p.response.url, status: p.response.status, fehler: null };
      protokoll.push(eintrag);
      if (a) a.eintrag = eintrag;
    }
  });
  // Den Fehlercode aus dem Antworttext nachtragen (die Antwort ist erst nach dem Laden lesbar).
  auf('Network.loadingFinished', (p) => {
    const a = anfragen.get(p.requestId);
    if (!a?.eintrag) return;
    a.gelesen = sende('Network.getResponseBody', { requestId: p.requestId }).then((r) => {
      try { const j = JSON.parse(r.body); a.eintrag.fehler = j.message ?? j.error_code ?? j.msg ?? null; } catch { /* kein JSON */ }
    }).catch(() => {});
  });
  auf('Network.loadingFailed', (p) => {
    const a = anfragen.get(p.requestId);
    if (!p.canceled) protokoll.push({ art: 'netz', text: `${p.errorText} ${a?.url ?? ''}`, url: a?.url });
  });
  const dialoge = []; // alert/confirm der Seite: werden angenommen, aber festgehalten
  auf('Page.javascriptDialogOpening', (p) => {
    dialoge.push(p);
    sende('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
  });

  await Promise.all([sende('Page.enable'), sende('Runtime.enable'), sende('Log.enable'), sende('Network.enable')]);
  await sende('Emulation.setDeviceMetricsOverride', { width: breite, height: hoehe, deviceScaleFactor: 1, mobile: true });
  await sende('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

  // Wartet, bis alle Fehlerantworten gelesen sind; danach ist das Protokoll vollständig.
  async function protokollFertig() {
    await Promise.all([...anfragen.values()].map((a) => a.gelesen));
    return protokoll;
  }

  // ---------------------------------------------------------------- API

  async function werte(ausdruck, ...argumente) {
    const text = typeof ausdruck === 'function'
      ? `(${ausdruck.toString()})(...${JSON.stringify(argumente)})` : ausdruck;
    const r = await sende('Runtime.evaluate', { expression: text, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) {
      throw new Error(`evaluate: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    }
    return r.result.value;
  }

  async function warteAuf(ausdruck, { ms = 10000, text = null } = {}, ...argumente) {
    const ende = Date.now() + ms;
    let letzter;
    while (Date.now() < ende) {
      try { letzter = await werte(ausdruck, ...argumente); if (letzter) return letzter; } catch (e) { letzter = e.message; }
      await pause(50);
    }
    throw new Error(`Zeitüberschreitung beim Warten auf ${text ?? String(ausdruck).slice(0, 160)} (zuletzt: ${JSON.stringify(letzter)?.slice(0, 200)})`);
  }

  async function navigiere(url) {
    const geladen = einmal('Page.loadEventFired');
    await sende('Page.navigate', { url });
    await geladen;
  }

  // Mitte eines Elements in Viewport-Koordinaten (scrollt es ins Bild). ziel: CSS-Selektor oder
  // { text, in, sel, genau, nr } (Element nach Text), { label } (Feld nach Beschriftung) oder { js } (Ausdruck, der ein Element liefert).
  // Wie bei einem echten Finger zählt, was ganz oben liegt: ist das Element verdeckt oder gesperrt, ist das ein Fehler.
  async function punkt(ziel) {
    const p = await werte((z) => {
      let el;
      if (typeof z === 'string') el = document.querySelector(z);
      else if (z.js) el = (0, eval)(z.js);
      else if (z.label !== undefined) {
        const l = [...document.querySelectorAll('label')].filter((x) => x.getClientRects().length && x.textContent.trim().startsWith(z.label))[z.nr ?? 0];
        el = l?.control;
      } else {
        const wurzel = z.in ? document.querySelector(z.in) : document;
        const alle = [...(wurzel?.querySelectorAll(z.sel ?? 'button, [role="button"], a, label, summary') ?? [])]
          .filter((e) => (z.genau ? e.textContent.trim() === z.text : e.textContent.includes(z.text)) && e.getClientRects().length);
        el = alle[z.nr ?? 0];
      }
      if (!el) return { fehler: 'nicht gefunden' };
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      if (el.disabled) return { fehler: 'gesperrt (disabled)' };
      const oben = document.elementFromPoint(x, y);
      if (!oben || !(el === oben || el.contains(oben) || oben.closest('label')?.control === el)) {
        return { fehler: `verdeckt von <${oben?.tagName.toLowerCase()} class="${oben?.className}">` };
      }
      return { x, y, b: r.width, h: r.height };
    }, ziel);
    if (p.fehler) throw new Error(`Element ${p.fehler}: ${JSON.stringify(ziel)}`);
    return p;
  }

  // Ein Fingertipp (touchStart/touchEnd) bzw. ein Mausklick, beides als echte Eingabe-Ereignisse.
  async function klick(ziel, { maus = false } = {}) {
    const { x, y } = await punkt(ziel);
    if (maus) {
      const m = (type, extra = {}) => sende('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, ...extra });
      await m('mouseMoved', { button: 'none' });
      await m('mousePressed', { buttons: 1 });
      await m('mouseReleased', { buttons: 0 });
    } else {
      const tp = [{ x, y, radiusX: 4, radiusY: 4, force: 1, id: 1 }];
      await sende('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp });
      await sende('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    }
    await pause(60);
  }

  // Tippt Text in ein Feld: antippen (Fokus), Inhalt auswählen und löschen, dann einfügen wie die Bildschirmtastatur.
  async function tippe(ziel, text, { enter = false, tab = false } = {}) {
    await klick(ziel);
    await werte(() => { const e = document.activeElement; if (e && 'value' in e) e.select?.(); });
    await taste('Delete');
    if (text) await sende('Input.insertText', { text });
    if (enter) await taste('Enter');
    if (tab) await taste('Tab');
  }

  const TASTEN = { Tab: 9, Enter: 13, Escape: 27, Delete: 46, Backspace: 8 };
  async function taste(key) {
    const code = TASTEN[key];
    await sende('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code: key, windowsVirtualKeyCode: code });
    if (key === 'Enter') await sende('Input.dispatchKeyEvent', { type: 'char', key, text: '\r' });
    await sende('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code });
  }

  // Auswahllisten lassen sich headless nicht antippen: Wert setzen und input + change auslösen, wie nach der Auswahl.
  async function setzeWert(selector, wert) {
    const ok = await werte((s, w) => {
      const e = document.querySelector(s);
      if (!e) return false;
      e.focus();
      e.value = w;
      e.dispatchEvent(new Event('input', { bubbles: true }));
      e.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }, selector, wert);
    if (!ok) throw new Error(`Feld nicht gefunden: ${selector}`);
  }

  // Browser-Zurück und -Vor über den Verlauf des Tabs (wie die Taste des Handys). Liefert false, wenn es keinen Eintrag gibt.
  async function schritt(richtung) {
    const { currentIndex, entries } = await sende('Page.getNavigationHistory');
    const eintrag = entries[currentIndex + richtung];
    if (!eintrag) return false;
    await sende('Page.navigateToHistoryEntry', { entryId: eintrag.id });
    await pause(100);
    return true;
  }
  const zurueck = () => schritt(-1);
  const vor = () => schritt(1);
  const verlauf = () => sende('Page.getNavigationHistory'); // { currentIndex, entries: [{ url, … }] }

  async function foto(datei) {
    const r = await sende('Page.captureScreenshot', { format: 'png' });
    writeFileSync(datei, Buffer.from(r.data, 'base64'));
  }

  async function schliessen() {
    try { await sende('Browser.close'); } catch { /* schon zu */ }
    try { ws.close(); } catch { /* egal */ }
    await new Promise((ok) => { if (prozess.exitCode !== null) ok(); else { prozess.once('exit', ok); setTimeout(ok, 5000); } });
    if (prozess.exitCode === null) prozess.kill('SIGKILL');
    profilWeg(profil);
  }

  // Notbremse bei einem Absturz des Testlaufs (synchron, vor process.exit): Browser beenden, Profil löschen.
  function notAus() {
    try { if (prozess.exitCode === null) prozess.kill('SIGKILL'); } catch { /* schon zu */ }
    profilWeg(profil);
  }

  return {
    sende, auf, werte, warteAuf, navigiere, punkt, klick, tippe, taste, setzeWert, zurueck, vor, verlauf,
    foto, schliessen, notAus, protokoll, protokollFertig, dialoge, pause,
  };
}
