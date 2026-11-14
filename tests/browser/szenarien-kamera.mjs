// Szenario mit nachgebildeter Kamera: Chrome spielt ein Video mit dem Strichcode eines Demo-Artikels ab, gelesen wird
// über die mitgelieferte Bibliothek (der BarcodeDetector des Browsers ist dafür ausgeschaltet).
// Die Schalter der Kamera gelten nur beim Start des Browsers: Das Szenario startet deshalb einen eigenen Browser.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { starteBrowser } from './cdp.mjs';
import { baueRahmen, NETZ_ZAEHLER } from './rahmen.mjs';
import { strichcodeY4m } from './strichcode-video.mjs';

const KEFIR = '4311501646854';

export default [
  {
    nr: 20,
    name: 'Kamera: Strichcode im Bild wird über die Bibliothek gelesen, der Artikel geht auf',
    async lauf(h) {
      const ordner = mkdtempSync(join(tmpdir(), 'mhd-kamera-'));
      const video = join(ordner, 'kefir.y4m');
      writeFileSync(video, strichcodeY4m(KEFIR));
      const c = await starteBrowser({
        zusatz: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${video}`],
      });
      try {
        await c.sende('Page.addScriptToEvaluateOnNewDocument', { source: NETZ_ZAEHLER });
        await c.sende('Page.addScriptToEvaluateOnNewDocument', { source: 'delete window.BarcodeDetector;' });
        // Bedient wird der zweite Browser; geprüft und gezählt wird im Rahmen des Laufs (h).
        const k = baueRahmen({ s: h.s, c });
        await k.alsMitarbeiter('Anna');
        await k.knopf('Scannen', '.ansicht-liste');
        await k.warteAnsicht('scan');
        const t0 = Date.now();
        await c.warteAuf(() => document.querySelector('.ansicht-artikel h1'), { text: 'Artikel nach dem Kamera-Scan', ms: 30000 });
        h.notiz(`Artikel ${Date.now() - t0} ms nach dem Öffnen der Kamera`);
        await k.ruhe();
        h.gleich(await k.text('.ansicht-artikel h1'), 'Kefir', 'der Strichcode im Bild öffnet den Artikel');
        h.pruefe((await k.text('.ansicht-artikel dl')).endsWith(`Strichcode${KEFIR}`), 'Strichcode des Artikels', await k.text('.ansicht-artikel dl'));
        h.pruefe(await c.werte(() => typeof window.ZXing === 'object' && Boolean(document.querySelector('script[src="vendor/zxing.min.js"]'))), 'gelesen über die mitgelieferte Bibliothek');
        h.gleich(await c.werte(() => 'BarcodeDetector' in window), false, 'ohne BarcodeDetector');
        const kamera = await c.werte(() => document.querySelector('video.kamera'));
        h.gleich(kamera, null, 'die Kamera-Ansicht ist geschlossen');
        await c.foto(`${h.fotoVorsatz}-artikel.png`);
        h.fotos.push(`${h.fotoVorsatz}-artikel.png`);
        const konsole = (await c.protokollFertig()).map((e) => `${e.art}: ${e.text}`);
        h.gleich(konsole, [], 'Konsole des Kamera-Browsers ohne Fehler');
      } finally {
        await c.schliessen();
        rmSync(ordner, { recursive: true, force: true });
      }
    },
  },
];
