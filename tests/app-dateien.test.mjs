// App-Dateien: Manifest, Icons, Verweise in index.html und die Content-Types des Testservers.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { starteServer } from './server.mjs';

const lese = (name) => readFileSync(new URL(`../docs/${name}`, import.meta.url));
const manifest = () => JSON.parse(lese('manifest.webmanifest').toString('utf8'));
const html = () => lese('index.html').toString('utf8');
const SIGNATUR = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test('Manifest: Name, Anzeige, Pfade, Farben, beide Icons', () => {
  const m = manifest();
  assert.equal(m.name, 'MHD');
  assert.equal(m.short_name, 'MHD');
  assert.equal(m.description, 'MHD-Kontrolle im Markt');
  assert.equal(m.lang, 'de');
  assert.equal(m.display, 'standalone');
  assert.equal(m.start_url, './');
  assert.equal(m.scope, './');
  assert.equal(m.theme_color, '#1B5E20');
  assert.equal(m.background_color, '#1B5E20');
  assert.deepEqual(m.icons.map((i) => [i.sizes, i.type]).sort(), [['192x192', 'image/png'], ['512x512', 'image/png']]);
  for (const i of m.icons) assert.ok(existsSync(new URL(`../docs/${i.src}`, import.meta.url)), i.src);
});

for (const [datei, kante] of [['icon-192.png', 192], ['icon-512.png', 512]]) {
  test(`${datei}: PNG mit ${kante}x${kante} Pixeln`, () => {
    const png = lese(datei);
    assert.deepEqual(png.subarray(0, 8), SIGNATUR);
    assert.equal(png.subarray(12, 16).toString('latin1'), 'IHDR');
    assert.equal(png.readUInt32BE(16), kante);
    assert.equal(png.readUInt32BE(20), kante);
  });
}

test('index.html: Manifest, apple-touch-icon, theme-color, Icon-Link', () => {
  const h = html();
  assert.match(h, /<link rel="manifest" href="manifest\.webmanifest">/);
  assert.match(h, /<link rel="apple-touch-icon" href="icon-192\.png">/);
  assert.match(h, /<meta name="theme-color" content="#1B5E20">/);
  assert.match(h, /<link rel="icon" href="icon-192\.png" type="image\/png">/);
});

test('jede in index.html genannte lokale Datei existiert in docs/', () => {
  const lokal = [...html().matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]).filter((p) => !/^(https?:|data:|\/)/.test(p));
  assert.ok(lokal.length >= 4);
  for (const p of lokal) assert.ok(existsSync(new URL(`../docs/${p}`, import.meta.url)), p);
});

let s;
before(async () => { s = await starteServer(); });
after(async () => { await s.stop(); });

test('Testserver liefert Manifest und Icons mit den richtigen Content-Types', async () => {
  const typ = async (pfad) => {
    const r = await fetch(s.url + pfad);
    assert.equal(r.status, 200, pfad);
    return r.headers.get('content-type');
  };
  assert.match(await typ('/manifest.webmanifest'), /^application\/manifest\+json/);
  assert.match(await typ('/icon-192.png'), /^image\/png/);
  assert.match(await typ('/icon-512.png'), /^image\/png/);
});

test('icons-erzeugen.mjs schreibt bei jedem Lauf dieselben Bytes wie die eingecheckten Icons', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { execFileSync } = await import('node:child_process');
  const skript = new URL('../werkzeug/icons-erzeugen.mjs', import.meta.url);
  const ordner = mkdtempSync(join(tmpdir(), 'mhd-icons-'));
  try {
    execFileSync(process.execPath, [fileURLToPath(skript), ordner]);
    for (const datei of ['icon-192.png', 'icon-512.png']) {
      assert.ok(readFileSync(join(ordner, datei)).equals(lese(datei)), datei);
    }
  } finally { rmSync(ordner, { recursive: true, force: true }); }
});
