// Ein Video im Format Y4M mit einem EAN-13-Strichcode, als Bild für die nachgebildete Kamera von Chrome
// (--use-file-for-fake-video-capture). Graustufen, 4:2:0, das Bild steht still.

const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const R = L.map((m) => [...m].map((b) => (b === '1' ? '0' : '1')).join(''));
const PARITAET = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

// Die 95 Module eines EAN-13 ('1' = Strich), ohne Ruhezone.
export function ean13Module(ean) {
  if (!/^\d{13}$/.test(ean)) throw new Error(`EAN-13 erwartet: ${ean}`);
  const z = [...ean].map(Number);
  const links = z.slice(1, 7).map((d, i) => (PARITAET[z[0]][i] === 'L' ? L : G)[d]).join('');
  const rechts = z.slice(7).map((d) => R[d]).join('');
  return `101${links}01010${rechts}101`;
}

// Graustufenbild (Helligkeit je Pixel, Zeile für Zeile) mit dem Strichcode in der Mitte.
export function strichcodeBild(ean, { breite = 640, hoehe = 480, modul = 4 } = {}) {
  const module = ean13Module(ean);
  const bild = new Uint8Array(breite * hoehe).fill(235);
  const links = Math.floor((breite - module.length * modul) / 2);
  const oben = Math.floor(hoehe * 0.2);
  const unten = Math.floor(hoehe * 0.8);
  for (let y = oben; y < unten; y++) {
    for (let i = 0; i < module.length; i++) {
      if (module[i] !== '1') continue;
      bild.fill(16, y * breite + links + i * modul, y * breite + links + (i + 1) * modul);
    }
  }
  return bild;
}

export function strichcodeY4m(ean, { breite = 640, hoehe = 480, bilder = 3 } = {}) {
  const y = strichcodeBild(ean, { breite, hoehe });
  const farbe = Buffer.alloc((breite / 2) * (hoehe / 2) * 2, 128); // U und V: ohne Farbe
  const teile = [Buffer.from(`YUV4MPEG2 W${breite} H${hoehe} F10:1 Ip A1:1 C420jpeg\n`, 'ascii')];
  for (let i = 0; i < bilder; i++) teile.push(Buffer.from('FRAME\n', 'ascii'), Buffer.from(y), farbe);
  return Buffer.concat(teile);
}
