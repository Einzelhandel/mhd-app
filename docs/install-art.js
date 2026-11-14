// Entscheidung für den Hinweis „Als App installieren“: reine Logik, kein DOM.
// Aufbau übernommen aus einem früheren eigenen Projekt.

// 'knopf' = der Browser bietet die Installation an (beforeinstallprompt, Android/Chrome),
// 'ios' = iPhone/iPad (Apple erlaubt keinen Knopf, nur Teilen → Zum Home-Bildschirm),
// 'menue' = sonst; null = läuft schon als App.
export function installArt({ installiert, kannFragen, ios }) {
  if (installiert) return null;
  if (kannFragen) return 'knopf';
  return ios ? 'ios' : 'menue';
}

// iPadOS meldet sich als Mac; nur der Touchscreen unterscheidet es.
export function istIos(userAgent, plattform, touchPunkte) {
  return /iPhone|iPad|iPod/.test(userAgent) || (plattform === 'MacIntel' && touchPunkte > 1);
}
