// Anmeldung in zwei Schritten: Markt-Konto (Passwort), danach Mitarbeiter und PIN.
// Aufbau übernommen aus einem früheren eigenen Projekt.
import { ansichten, wechsle, mhdRpc } from './app.js';
import { element, meldung, mitSperre, fehlertext, uhrzeit } from './hilfe.js';
import { login, logout, pinSetzen } from './sitzung.js';

ansichten.anmeldung = (wurzel) => {
  const konto = element('input', {
    id: 'konto', name: 'konto', type: 'text', autocomplete: 'username',
    autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', required: true,
  });
  const passwort = element('input', { id: 'passwort', name: 'passwort', type: 'password', autocomplete: 'current-password', required: true });
  const knopf = element('button', { type: 'submit', class: 'knopf haupt' }, 'Anmelden');

  const formular = element('form', {
    class: 'formular',
    onsubmit: (ereignis) => {
      ereignis.preventDefault();
      meldung('');
      if (!konto.value.trim() || !passwort.value) {
        meldung('Bitte Konto und Passwort eingeben.');
        return;
      }
      mitSperre(formular, async () => {
        await login(konto.value, passwort.value);
        wechsle('pin');
      });
    },
  },
  element('label', { for: 'konto' }, 'Konto des Marktes'), konto,
  element('label', { for: 'passwort' }, 'Passwort'), passwort,
  knopf);

  wurzel.append(element('h1', {}, 'MHD'), element('p', { class: 'hinweis-text' }, 'Bitte mit dem Konto des Marktes anmelden.'), formular);
  konto.focus();
};

ansichten.pin = async (wurzel) => {
  const markt = await mhdRpc('mhd_markt');
  const kopf = element('h1', {}, markt.markt.name);
  const abmelden = element('button', {
    type: 'button', class: 'knopf klein',
    onclick: () => { logout(); wechsle('anmeldung'); },
  }, 'Anderes Konto');

  const liste = element('div', { class: 'knopfliste' });
  const eingabeBereich = element('div', { class: 'pin-bereich' });
  wurzel.append(kopf, element('p', { class: 'hinweis-text' }, 'Wer bist du?'), liste, eingabeBereich, abmelden);

  if (!markt.mitarbeiter.length) {
    liste.append(element('p', {}, 'Für diesen Markt sind keine Mitarbeiter angelegt.'));
    return;
  }
  for (const m of markt.mitarbeiter) {
    liste.append(element('button', { type: 'button', class: 'knopf mitarbeiter', onclick: () => zeigePin(m) }, m.name));
  }

  function zeigePin(m) {
    meldung('');
    const pin = element('input', {
      id: 'pin', name: 'pin', type: 'password', inputmode: 'numeric', pattern: '[0-9]*',
      maxlength: '6', autocomplete: 'off', required: true, 'aria-label': `PIN von ${m.name}`,
    });
    const formular = element('form', {
      class: 'formular',
      onsubmit: (ereignis) => {
        ereignis.preventDefault();
        meldung('');
        if (!/^\d{4,6}$/.test(pin.value)) {
          meldung(fehlertext('PIN_UNGUELTIG'));
          return;
        }
        mitSperre(wurzel, async () => {
          const antwort = await mhdRpc('mhd_pin_anmelden', { p_mitarbeiter: m.id, p_pin: pin.value });
          if (!antwort.ok) {
            pin.value = '';
            meldung(antwort.gesperrt_bis
              ? `${fehlertext(antwort.fehler)} Gesperrt bis ${uhrzeit(antwort.gesperrt_bis)} Uhr.`
              : fehlertext(antwort.fehler));
            return;
          }
          pinSetzen({ sitzung: antwort.sitzung, name: antwort.name, rolle: antwort.rolle });
          wechsle('liste');
        });
      },
    },
    element('label', { for: 'pin' }, `PIN für ${m.name}`), pin,
    element('button', { type: 'submit', class: 'knopf haupt' }, 'Anmelden'));
    eingabeBereich.replaceChildren(formular);
    pin.focus();
  }
};
