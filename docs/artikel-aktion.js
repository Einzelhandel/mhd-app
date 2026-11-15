// Artikel-Ansicht: welche Datenbank-Aufrufe zu „Geprüft“ und „Reduziert“ gehören. Reine Logik, kein DOM.
import { leseDatum } from './datum.js';

export const DATUM_FEHLER = 'Bitte ein Datum eingeben, z. B. 201126 für 20.11.26.';

// art: 'geprueft' | 'reduziert'; feldText: Inhalt des Feldes „Vorderstes MHD“.
// Liefert die Aufrufe in der Reihenfolge, in der sie gesendet werden ([{ art, mhd? }]),
// oder { fehler } mit der Meldung für das Feld (dann wird nichts gesendet).
// „Reduziert“ mit anderem MHD als gespeichert: erst „geprüft“ mit dem neuen MHD, dann „reduziert“.
export function schritte(art, feldText, artikel, heute) {
  const mhd = leseDatum(feldText, heute);
  if (!mhd) return { fehler: DATUM_FEHLER };
  if (art === 'geprueft') return [{ art: 'geprueft', mhd }];
  if (mhd === artikel.mhd) return [{ art }];
  return [{ art: 'geprueft', mhd }, { art }];
}

// Welche Knöpfe der Artikel anbietet: 'neu' (MHD noch nie gespeichert: MHD der vordersten Ware speichern oder aus dem Sortiment nehmen),
// 'ohne_bestand' (ruhend oder ohne Bestand: wieder da, weiter ohne Bestand, aus dem Sortiment nehmen) oder 'bestand'.
// 'neu' folgt aus dem Zustand des Artikels (versaeumt 'mhd_fehlt' vom Server), egal ob er gerade angelegt,
// gescannt oder aus der Liste geöffnet wurde; `neu` aus den Ansichtsdaten gilt zusätzlich, nur ohne Bestand.
export function panelArt(artikel, neu = false) {
  if (!artikel.bestand && artikel.aktiv !== false && (neu || artikel.versaeumt === 'mhd_fehlt')) return 'neu';
  return artikel.aktiv === false || !artikel.bestand ? 'ohne_bestand' : 'bestand';
}
