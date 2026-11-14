// Erzeugt die App-Icons docs/icon-192.png und docs/icon-512.png: weißes „MHD“ auf dunkelgrünem Grund.
// Aufruf: node werkzeug/icons-erzeugen.mjs [zielordner]   (Vorgabe: docs/)
// Nur node:zlib und node:fs; das Ergebnis ist bei jedem Lauf dasselbe, die PNGs werden eingecheckt.
import { deflateSync, crc32 } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const GRUEN = [0x1b, 0x5e, 0x20];
const WEISS = [0xff, 0xff, 0xff];
const HOEHE_ANTEIL = 0.3; // Buchstabenhöhe im Verhältnis zur Kantenlänge
const RAND_ANTEIL = 0.12; // Rand, der frei bleibt (Android beschneidet das Icon rund)

// 5×7-Blockmuster, „#“ = Block
const BUCHSTABEN = {
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
};

function chunk(art, daten) {
  const kopf = Buffer.alloc(8);
  kopf.writeUInt32BE(daten.length, 0);
  kopf.write(art, 4, 'latin1');
  const pruefsumme = Buffer.alloc(4);
  pruefsumme.writeUInt32BE(crc32(Buffer.concat([kopf.subarray(4), daten])), 0);
  return Buffer.concat([kopf, daten, pruefsumme]);
}

export function zeichneIcon(kante, text = 'MHD') {
  const block = Math.round((kante * HOEHE_ANTEIL) / 7);
  const breite = (text.length * 5 + (text.length - 1)) * block; // eine Blockbreite Abstand zwischen den Buchstaben
  const hoehe = 7 * block;
  const links = Math.round((kante - breite) / 2);
  const oben = Math.round((kante - hoehe) / 2);
  if (links < kante * RAND_ANTEIL || oben < kante * RAND_ANTEIL) throw new Error('Schrift passt nicht in den freien Bereich');

  const zeilen = [];
  for (let y = 0; y < kante; y++) {
    const zeile = Buffer.alloc(1 + kante * 3); // Byte 0 = Filter „keiner“
    for (let x = 0; x < kante; x++) {
      const bx = Math.floor((x - links) / block);
      const by = Math.floor((y - oben) / block);
      const buchstabe = Math.floor(bx / 6);
      const spalte = bx % 6;
      const an = bx >= 0 && by >= 0 && by < 7 && buchstabe < text.length && spalte < 5
        && BUCHSTABEN[text[buchstabe]][by][spalte] === '#';
      Buffer.from(an ? WEISS : GRUEN).copy(zeile, 1 + x * 3);
    }
    zeilen.push(zeile);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(kante, 0);
  ihdr.writeUInt32BE(kante, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8 Bit, RGB, Standardverfahren, ohne Verschachtelung
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(zeilen), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ziel = process.argv[2] ?? fileURLToPath(new URL('../docs/', import.meta.url));
  for (const kante of [192, 512]) writeFileSync(join(ziel, `icon-${kante}.png`), zeichneIcon(kante));
}
