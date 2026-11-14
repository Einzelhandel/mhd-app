// Ansicht „Neuer Artikel“: ein Strichcode, den der Markt noch nicht kennt (nach dem Scan),
// oder – nur Marktleitung – ein Artikel ohne Strichcode (Waagenware).
// daten: { ean | null, vorschlag: { name, marke, menge } | null, quelle: 'off' | 'hand', zurueck? }
// Dasselbe Formular ändert einen vorhandenen Artikel (nur Marktleitung): daten = { artikel, artikelZurueck? },
// wobei `artikelZurueck` der Zurück-Eintrag der Artikel-Ansicht ist, von der aus bearbeitet wird.
import { ansichten, wechsle, mhdRpc } from './app.js';
import { element, meldung, mitSperre, fehlertext, ausweg } from './hilfe.js';

const MAX_NAME = 120;
const MAX_TEXT = 60; // Marke, Menge, Platz (so kürzt auch die Datenbank)

ansichten['artikel-neu'] = async (wurzel, daten) => {
  const bearbeiten = daten.artikel ?? null;
  const vorschlag = bearbeiten ?? daten.vorschlag ?? null;
  // Zurück: dorthin, woher man kam; nach einem Scan wieder zur Kamera; beim Bearbeiten zum Artikel.
  const zurueck = () => {
    if (bearbeiten) return wechsle('artikel', { artikel: bearbeiten, zurueck: daten.artikelZurueck });
    const z = daten.zurueck ?? { ansicht: daten.ean ? 'scan' : 'liste' };
    wechsle(z.ansicht, z.daten);
  };
  const kopf = element('header', { class: 'kopf' },
    element('button', { type: 'button', class: 'knopf klein', onclick: zurueck }, 'Zurück'),
    element('h1', {}, bearbeiten ? 'Artikel bearbeiten' : 'Neuer Artikel'));

  let gruppen;
  try {
    gruppen = await mhdRpc('mhd_warengruppen');
  } catch (fehler) {
    if (fehler.behandelt) throw fehler;
    meldung(fehlertext(fehler.message));
    wurzel.append(kopf, ausweg(() => wechsle('artikel-neu', daten), zurueck));
    return;
  }

  const feld = (id, beschriftung, wert, extra = {}) => {
    const eingabe = element('input', { id, name: id, type: 'text', autocomplete: 'off', value: wert ?? '', ...extra });
    return { eingabe, zeile: element('div', { class: 'feld' }, element('label', { for: id }, beschriftung), eingabe) };
  };
  const name = feld('name', 'Name', vorschlag?.name, { maxlength: MAX_NAME, required: true, 'aria-required': 'true' });
  const marke = feld('marke', 'Marke', vorschlag?.marke, { maxlength: MAX_TEXT });
  const menge = feld('menge', 'Menge', vorschlag?.menge, { maxlength: MAX_TEXT });
  const platz = feld('platz', 'Platz (z. B. Kühlregal 3)', bearbeiten?.platz, { maxlength: MAX_TEXT });
  const gruppe = element('select', { id: 'warengruppe', name: 'warengruppe', required: true, 'aria-required': 'true' },
    element('option', { value: '' }, 'Bitte wählen'),
    gruppen.map((g) => element('option', { value: g.id, selected: g.id === bearbeiten?.warengruppe_id }, g.name)));

  const hinweis = !bearbeiten && vorschlag && element('p', { class: 'hinweis-text' }, 'Vorschlag aus Open Food Facts – bitte prüfen');
  const ean = bearbeiten ? bearbeiten.ean : daten.ean;
  const strichcode = ean && element('p', { class: 'einzelheit' }, `Strichcode ${ean}`);

  // Ein anderer Mitarbeiter war schneller: den vorhandenen Artikel öffnen, ohne Fehlermeldung.
  async function vorhandenenOeffnen() {
    const artikel = daten.ean ? await mhdRpc('mhd_artikel_suchen', { p_ean: daten.ean }) : null;
    if (!artikel) return false;
    wechsle('artikel', { artikel, fokus: 'mhd' });
    return true;
  }

  function speichern() {
    if (!name.eingabe.value.trim()) {
      meldung(fehlertext('NAME_FEHLT'));
      name.eingabe.focus();
      return;
    }
    if (!gruppe.value) {
      meldung('Bitte eine Warengruppe wählen.');
      gruppe.focus();
      return;
    }
    meldung('');
    mitSperre(wurzel, async () => {
      let artikel;
      try {
        artikel = await mhdRpc('mhd_artikel_speichern', {
          p_id: bearbeiten?.id ?? null,
          p_daten: {
            ean: ean ?? null,
            name: name.eingabe.value.trim(),
            marke: marke.eingabe.value.trim(),
            menge: menge.eingabe.value.trim(),
            platz: platz.eingabe.value.trim(),
            warengruppe_id: Number(gruppe.value),
            // Beim Bearbeiten bleibt die Quelle, wie sie ist. 'off' sonst nur, wenn ein Vorschlag aus Open Food Facts zu sehen war.
            ...(bearbeiten ? {} : { quelle: vorschlag && daten.quelle === 'off' ? 'off' : 'hand' }),
          },
        });
      } catch (fehler) {
        if (fehler.message === 'ARTIKEL_VORHANDEN' && await vorhandenenOeffnen()) return;
        throw fehler;
      }
      if (bearbeiten) {
        wechsle('artikel', { artikel, zurueck: daten.artikelZurueck });
        meldung('Gespeichert.', 'ok');
        return;
      }
      wechsle('artikel', { artikel, fokus: 'mhd', neu: true });
      meldung('Artikel angelegt. Jetzt das vorderste MHD eingeben.', 'ok');
    });
  }

  wurzel.append(...[
    kopf,
    hinweis,
    strichcode,
    element('form', { class: 'formular', novalidate: true, onsubmit: (e) => { e.preventDefault(); speichern(); } },
      name.zeile, marke.zeile, menge.zeile, platz.zeile,
      element('div', { class: 'feld' }, element('label', { for: 'warengruppe' }, 'Warengruppe'), gruppe),
      element('button', { type: 'submit', class: 'knopf haupt' }, 'Speichern'))].filter(Boolean));
  name.eingabe.focus();
};
