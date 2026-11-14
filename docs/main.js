// Einstieg der Seite: erst app.js, dann die Ansichten, dann Start.
// Aufbau übernommen aus einem früheren eigenen Projekt.
import { start } from './app.js';

// Ansichten (jede trägt sich mit ansichten.<name> = … ein)
import './anmeldung.js';
import './liste.js';
import './artikel.js';
import './suche.js';
import './scan.js';
import './artikel-neu.js';
import './einstellungen.js';
import './protokoll.js';

// Service Worker nur über HTTPS oder auf localhost (nur dort gibt es navigator.serviceWorker); Fehler bleiben still.
navigator.serviceWorker?.register('sw.js').catch(() => { /* ohne Service Worker gilt der normale Zwischenspeicher */ });

start();
