# MHD-App

Webseite, mit der die Mitarbeiter eines Supermarktes am Handy das
Mindesthaltbarkeitsdatum (MHD) der Ware im Regal kontrollieren: Artikel scannen,
MHD der vordersten Ware eingeben, die App berechnet den nächsten Termin und zeigt
jeden Tag, was heute zu prüfen, zu reduzieren oder rauszunehmen ist. Was
abgelaufen oder versäumt ist, bleibt auf der Liste stehen, bis jemand es erledigt.

Statische Seite ohne Framework und ohne Build-Schritt (`docs/`, für GitHub Pages),
dahinter eine PostgreSQL-Datenbank bei Supabase; die gesamte Fachlogik steht in
einer SQL-Datei (`supabase/schema.sql`). Warum so gebaut wurde, was die App
bewusst nicht kann und wie die Fachregeln lauten, steht im Entwurf:
[`entwurf/2026-11-14-mhd-app.md`](entwurf/2026-11-14-mhd-app.md).
Bedienung für den Markt: [ANLEITUNG.md](ANLEITUNG.md).

**Stand der Prüfung:** Die App ist bisher nur gegen einen lokalen Testserver
gelaufen, nicht gegen ein echtes Supabase-Projekt und nicht auf echten Handys.
Genaueres steht unter „Grenzen“.

## Ausprobieren ohne Konto

Voraussetzung: Git und Node.js ab Version 22. Alle Befehle für die
Eingabeaufforderung von Windows (cmd.exe):

```
git clone https://github.com/<organisation>/mhd-app.git
cd /d mhd-app
npm install
npm start
```

`<organisation>` ist ein Platzhalter und durch die tatsächliche Adresse des
Repositorys zu ersetzen.

Der Server meldet `http://127.0.0.1:8123/`; ebenso geht `http://localhost:8123/`. Diese Adresse im Browser öffnen.
Der Testserver führt die echte
Oberfläche (`docs/`) gegen die echten SQL-Funktionen aus, in einer eingebauten
Datenbank (PGlite) mit erfundenen Demo-Daten. Es wird nichts in die Cloud
geschickt; der Server hört nur auf diesem Rechner. Beendet wird er mit Strg+C.

| Eingabe | Wert |
|---|---|
| Konto des Marktes | `demo` |
| Passwort | `test` |
| Mitarbeiter Anna oder Ben | PIN `1234` |
| Marktleitung Chef | PIN `9999` |

Diese Zugangsdaten gelten nur für den lokalen Testserver. Für eine Demo im
Internet stehen Konto, Passwort und PINs nicht im Repository; sie werden der
prüfenden IT direkt übergeben. So kann kein Fremder die Demo-Mitarbeiter sperren
oder PINs durchprobieren.

Die Demo-Artikel haben echte Strichcodes (Namen und Strichcodes stammen aus Open
Food Facts), die MHDs sind erfunden und relativ zu heute gesetzt, sodass jeder
Abschnitt der Liste gefüllt ist. Die Datenbank liegt nur im Speicher: Nach jedem
Neustart des Servers ist alles wieder im Ausgangszustand.

Die Kamera funktioniert im Browser nur über HTTPS oder über `localhost`. Am
selben Rechner geht der Scan also: Der Browser-Test liest den Strichcode eines
Demo-Artikels aus der künstlichen Kamera von Chrome über die mitgelieferte
Bibliothek (mit einer echten Webcam nicht ausprobiert). Vom Handy im WLAN auf den
Rechner zuzugreifen geht nicht (der Server hört nur lokal), ein Handy braucht die
veröffentlichte HTTPS-Adresse. Ohne Kamera lässt sich jeder Strichcode auch eintippen; die
Strichcodes der Demo-Artikel stehen in der Artikelansicht.

## Tests

```
npm test
npm run test:browser
```

- `npm test`: Datenbank- und Logiktests gegen PGlite mit nachgebildeten
  Supabase-Rollen. Es wird kein Server und kein Browser gebraucht.
- `npm run test:browser`: Durchklick-Szenarien in Chrome oder Edge ohne Fenster
  (als Handy 390 x 844 mit Touch) gegen den lokalen Testserver. Der Test sucht
  Chrome oder Edge an den üblichen Orten unter `C:/Program Files`. Er schreibt
  Fotos in einen Ordner `fotos` unter `tests/browser/` (wird beim Lauf angelegt,
  nicht im Repository). Der Test startet seinen
  eigenen Server auf einem freien Port; ein laufendes `npm start` stört nicht.

Erwartet wird: alle Tests grün. Die Anzahl ändert sich mit dem Code und steht
deshalb nicht hier.

## Sicherheitsprinzip

Das Repository ist öffentlich, die Daten sind es nicht. Alle Tabellen liegen im
Schema `mhd`; Row Level Security ist eingeschaltet, es gibt bewusst keine
Policies, und `anon`/`authenticated` haben keinen Zugriff auf das Schema. Der
Browser ruft ausschließlich `SECURITY DEFINER`-Funktionen `public.mhd_*` auf
(feste `search_path`-Einstellung, alle Namen voll qualifiziert), die Anmeldung,
Rolle (Marktleitung, Mitarbeiter) und Markt serverseitig prüfen. Der Schlüssel in
`docs/config.js` ist absichtlich öffentlich (der öffentliche Schlüssel, nie der
`service_role`-Schlüssel). `tests/rechte.test.mjs` prüft jede `public.mhd_*`-Funktion
auf Rechte und Marktgrenze: neue Funktionen müssen dort eingetragen werden.

Anmeldung in zwei Stufen:

1. **Konto des Marktes** (Supabase Auth, E-Mail und Passwort, ein Konto je
   Markt). Das Gerät bleibt angemeldet. Ohne dieses Konto kommt niemand an Daten.
2. **Mitarbeiter und PIN** (4 bis 6 Ziffern) innerhalb des Marktes. Jede Aktion
   wird einem Mitarbeiter zugeordnet. PINs liegen nur als Hash vor
   (`pgcrypto`, bcrypt). Nach 5 falschen Eingaben ist der Mitarbeiter 15 Minuten
   gesperrt; eine neue PIN durch die Marktleitung hebt die Sperre auf. Nach 30
   Minuten ohne Aktion verlangt die App die PIN erneut; die PIN-Sitzung endet
   außerdem mit dem Tab. Gespeichert wird je Mitarbeiter nur ein Anzeigename.

Weiteres:

- Das Protokoll der Aktionen wird nur angefügt, nie geändert.
- Kein `innerHTML` und keine verwandten Aufrufe im Code (Namen kommen von Open
  Food Facts und von Benutzern); `tests/kein-innerhtml.test.mjs` prüft das.
- Strenge Content-Security-Policy in `docs/index.html`: Skripte und Stile nur von
  der eigenen Seite, Verbindungen nur zu Supabase und `world.openfoodfacts.org`.
  Die Strichcode-Bibliothek liegt als Datei im Repository (`docs/vendor/`), es wird
  nichts von einem CDN geladen.
- PIN-Felder sind bewusst keine Passwortfelder: Das Gerät teilen sich mehrere
  Mitarbeiter, der Browser soll keine PIN speichern oder vorschlagen. Die Ziffern
  werden per Stil verdeckt (wirkt in Chrome, Edge und Safari; in Firefox werden
  sie lesbar angezeigt).
- Falle beim Ändern der Datenbank: Ändern sich die Parameter einer Funktion,
  legt `create or replace` eine zweite Funktion an; die alte bleibt mitsamt
  Rechten aufrufbar. Vorher `drop function if exists public.<name>(<alte Typen>);`
  ausführen. Der Hinweis steht auch im Kopf von `supabase/schema.sql`.

Die Open-Food-Facts-Abfrage geht direkt vom Browser an `world.openfoodfacts.org`;
dabei wird nur der Strichcode übertragen.

## Eigenes Supabase-Projekt

Diese Schritte sind nach bestem Wissen beschrieben, aber **noch nie gegen ein
echtes Supabase-Projekt durchgespielt**. Beim ersten Aufsetzen bitte jeden
Schritt prüfen.

1. **Projekt anlegen** in der Region Frankfurt (EU).
2. **Selbst-Registrierung abschalten:** unter Authentication den Schalter „Allow
   new users to sign up“ ausschalten. Sonst kann sich jeder ein Konto anlegen. Er
   käme zwar an keine Daten, soll aber gar nicht erst hinein.
3. **Konto des Marktes anlegen:** im Dashboard unter Authentication, Users einen
   Benutzer `<konto>@example.com` mit Passwort anlegen. In der App wird nur der
   Teil vor dem `@` getippt (die App ergänzt `@example.com`; die Domain ist
   reserviert und kann keine Post empfangen).
4. **Schema laden:** den Inhalt von `supabase/schema.sql` im SQL-Editor ausführen.
   pgcrypto liegt bei Supabase im Schema `extensions`; die Datei erwartet das.
5. **Markt mit erster Marktleitung anlegen** (im SQL-Editor):

   ```
   select mhd.markt_anlegen('Marktname', '<konto>@example.com', 'Name der Leitung', '<PIN>');
   ```

   Die PIN besteht aus 4 bis 6 Ziffern. Weitere Mitarbeiter legt die
   Marktleitung danach in der App an.
6. **Adresse und Schlüssel eintragen:** in `docs/config.js` `SUPABASE_URL` und
   `SUPABASE_KEY` ersetzen. Die Werte stehen im Projekt unter Project Settings,
   API Keys. Eingetragen wird der öffentliche Schlüssel („publishable“ bzw.
   `anon`), **nie** der `service_role`-Schlüssel.
7. **Veröffentlichen:** bei GitHub Pages den Ordner `/docs` des Hauptzweigs
   einstellen. Die Adresse ist HTTPS, damit geht die Kamera auf dem Handy.

Außerdem:

- `supabase/schema.sql` und `supabase/demo-daten.sql` lassen sich wiederholt
  ausführen. Ein Update der Datenbank ist die erneut ausgeführte Datei (bei
  geänderten Funktionsparametern vorher die alte Funktion löschen, siehe oben).
- **Weiteren Markt anlegen:** weiterer Benutzer im Dashboard, dann wieder
  `select mhd.markt_anlegen(...)`. Die Märkte sind in der Datenbank getrennt
  (jede Zeile trägt die Markt-Nummer).
- **Demo-Daten:** `supabase/demo-daten.sql` ausführen, dann

  ```
  select mhd.demo_einrichten('demo@example.com', '<Leitungs-PIN>');
  ```

  Das legt den erfundenen Demo-Markt mit Anna, Ben und der Leitung „Chef“ an.
  Die Leitungs-PIN und das Passwort des Demo-Kontos gehören nicht ins
  Repository, sondern werden direkt übergeben. Zurücksetzen der Demo (Artikel,
  Protokoll, Warengruppen, Sperren, PINs von Anna und Ben): derselbe Aufruf ohne
  PIN, `select mhd.demo_einrichten('demo@example.com');`; die Leitungs-PIN bleibt
  dann unverändert. Dies löscht nur die Daten des Demo-Markts.
- Wer Supabase nicht nutzen will: Die Fachlogik ist reines PostgreSQL; die
  Oberfläche spricht nur eine PostgREST-ähnliche Schnittstelle an. Ob ein Betrieb
  mit selbst gehostetem Supabase oder PostgreSQL mit PostgREST ohne Änderungen
  geht, wurde nicht ausprobiert.

## Aufbau

| Pfad | Inhalt |
|---|---|
| `docs/` | Die App als statische Seite für GitHub Pages: HTML, CSS, JavaScript-Module ohne Framework und ohne Build |
| `docs/config.js` | Adresse und öffentlicher Schlüssel von Supabase, Adresse von Open Food Facts |
| `docs/vendor/` | Strichcode-Bibliothek ZXing 0.23.0 (unveränderte Kopie, Apache-Lizenz 2.0), nur als Ersatz, wenn der Browser keine eigene Erkennung hat |
| `docs/manifest.webmanifest` | Angaben für „Als App installieren“ (Name, Icons, Farben) |
| `docs/sw.js` | Kleiner Service Worker nur gegen veraltete Dateien nach einem Update; speichert nichts, macht die App nicht offlinefähig |
| `supabase/schema.sql` | Schema `mhd` mit allen Tabellen und der gesamten Fachlogik, dazu die Browser-Funktionen `public.mhd_*`. Idempotent |
| `supabase/demo-daten.sql` | Erfundener Demo-Markt mit Testartikeln, wiederholbar |
| `tests/` | Datenbank- und Logiktests (`node --test`), der lokale Testserver `tests/server.mjs` |
| `tests/browser/` | Durchklick-Szenarien in Chrome oder Edge |
| `werkzeug/` | Hilfsskript, das die Icons erzeugt |
| `entwurf/` | Entwurf mit Fachregeln und Entscheidungen (nicht unter `docs/`, damit er nicht als Webseite ausgeliefert wird) |
| `ANLEITUNG.md` | Bedienung für Mitarbeiter und Marktleitung |

Aufbau und Sicherheitsmuster sind aus einem früheren Projekt des Autors
übernommen; die betroffenen Dateien tragen im Kopf einen Vermerk.

## Grenzen

Bekannte Grenzen der Fachlichkeit (Entwurf, Abschnitt 13):

- Ein Artikel, der nie gescannt wurde, ist der App unbekannt. Gegenmittel: ein
  Rundgang beim Start und Scannen beim Einräumen.
- Kein Offline-Betrieb: Ohne Netz geht nichts.
- Keine Push-Benachrichtigungen, keine Anbindung an Kasse oder Warenwirtschaft.
- Ein MHD je Artikel (das früheste im Regal).
- Abgewogene Ware mit Waagen-Etikett (Nummern, die mit 2 beginnen) wird nicht
  gescannt; solche Artikel legt die Marktleitung ohne Strichcode an, die
  Mitarbeiter wählen sie über „Suche“ und „nur ohne Strichcode“.
- Open Food Facts deckt nicht alle Artikel ab; fehlende Artikel werden von Hand
  benannt.

**Nicht geprüft:**

- Die App lief bisher **nur gegen den lokalen Testserver** (nachgebildetes
  PostgREST und nachgebildete Anmeldung), **noch nicht gegen ein echtes
  Supabase-Projekt**. Die Einrichtungsschritte oben sind beim ersten echten
  Aufsetzen zu prüfen.
- **Kein Test auf echten Handys:** Kamera-Scan auf Android und iPhone, die
  schnelle Strichcode-Erkennung von Chrome auf Android, die Kamera in der
  installierten App auf dem iPhone, der Installationsdialog auf Android, das Icon
  auf dem iPhone und die Bildschirmtastatur.
- Die Verdeckung der PIN-Ziffern wirkt in Chrome, Edge und Safari; in Firefox
  werden die Ziffern lesbar angezeigt.
- Wie viel vom Sortiment eines Marktes Open Food Facts abdeckt: nicht gemessen.
- Ob ein kostenloses Supabase-Projekt bei Inaktivität pausiert und was ein
  Bezahltarif kostet: nicht geprüft.
- Das Verhalten bei schlechter Verbindung im Markt: nicht gemessen.
- Ob die Verwendung von Supabase und der Betrieb mit echten Marktdaten
  datenschutzrechtlich freigegeben ist (insbesondere ein
  Auftragsverarbeitungsvertrag): offen, nicht Teil dieser Prüfung.

## Rechte

© 2026 Dang Tu Nguyen. Alle Rechte vorbehalten. Der Quelltext ist öffentlich
einsehbar, steht aber unter keiner Open-Source-Lizenz. Einzelheiten in
[`LICENSE`](LICENSE). Die mitgelieferte Bibliothek ZXing steht unter der
Apache-Lizenz 2.0 (`docs/vendor/LICENSE-zxing.txt`).
