-- MHD-App – Datenbank (Stufe 0: Grundgerüst)
--
-- Einmal komplett im Supabase SQL-Editor ausführen. Erneutes Ausführen ist
-- unschädlich und behält alle Daten.
--
-- Zuvor in Supabase ein Markt-Konto anlegen (Authentication > Users, E-Mail und
-- Passwort). Danach den Markt mit seiner ersten Marktleitung im SQL-Editor anlegen:
--   select mhd.markt_anlegen('Marktname', 'markt@example.com', 'Name der Leitung', '1234');
--
-- ACHTUNG bei späteren Änderungen: Ändern sich die Parameter einer Funktion,
-- legt "create or replace" eine ZWEITE Funktion an; die alte bleibt mitsamt
-- ihren Rechten aufrufbar. Dann vorher die alte Fassung ausdrücklich löschen:
--   drop function if exists public.<name>(<alte Parametertypen>);
--
-- Sicherheitsprinzip: Alle Tabellen liegen im Schema "mhd"; darauf haben die
-- Rollen anon und authenticated keinen Zugriff, Row Level Security ist überall
-- aktiv und es gibt keine Policies. Der Browser ruft nur Funktionen in "public"
-- mit Präfix mhd_ auf (security definer, Anmeldung und Markt werden auf dem
-- Server geprüft). Funktionen im Schema "mhd" sind intern.
-- Aufbau übernommen aus einem früheren eigenen Projekt.

begin;

-- Auf Supabase liegt pgcrypto im Schema "extensions".
create extension if not exists pgcrypto with schema extensions;

create schema if not exists mhd;
revoke all on schema mhd from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- „Heute“ und „jetzt“
-- ---------------------------------------------------------------------------

-- „Heute“ in der Zeitzone des Marktes, nie current_date. Die Einstellung
-- mhd.heute (GUC) gibt es nur für Tests und fixiert das Datum; in Produktion ist sie leer.
create or replace function mhd.heute()
returns date
language sql stable
set search_path = ''
as $$
  select coalesce(nullif(current_setting('mhd.heute', true), '')::date,
                  (now() at time zone 'Europe/Berlin')::date)
$$;

-- Der aktuelle Zeitpunkt, nie now() in Fachfunktionen. Die Einstellung
-- mhd.jetzt (GUC) gibt es nur für Tests; in Produktion ist sie leer.
create or replace function mhd.jetzt()
returns timestamptz
language sql stable
set search_path = ''
as $$
  select coalesce(nullif(current_setting('mhd.jetzt', true), '')::timestamptz, now())
$$;

-- ---------------------------------------------------------------------------
-- Tabellen
-- ---------------------------------------------------------------------------

create table if not exists mhd.maerkte (
  id   bigint generated always as identity primary key,
  name text not null check (btrim(name) <> '')
);

-- Das Markt-Konto (Supabase Auth, ein Konto je Markt).
create table if not exists mhd.markt_konten (
  user_id  uuid primary key references auth.users (id) on delete cascade,
  markt_id bigint not null references mhd.maerkte (id) on delete cascade
);

create table if not exists mhd.mitarbeiter (
  id           bigint generated always as identity primary key,
  markt_id     bigint not null references mhd.maerkte (id) on delete cascade,
  name         text not null check (btrim(name) <> ''),
  rolle        text not null check (rolle in ('leitung', 'mitarbeiter')),
  pin_hash     text not null,
  aktiv        boolean not null default true,
  fehlversuche integer not null default 0,
  gesperrt_bis timestamptz,
  unique (markt_id, name)
);

create table if not exists mhd.sitzungen (
  token         uuid primary key default gen_random_uuid(),
  mitarbeiter_id bigint not null references mhd.mitarbeiter (id) on delete cascade,
  letzte_aktion timestamptz not null default mhd.jetzt()
);

create table if not exists mhd.warengruppen (
  id                    bigint generated always as identity primary key,
  markt_id              bigint not null references mhd.maerkte (id) on delete cascade,
  name                  text not null check (btrim(name) <> ''),
  pruef_vorlauf_tage    integer not null check (pruef_vorlauf_tage >= 0),
  reduzier_vorlauf_tage integer not null,
  max_intervall_tage    integer not null check (max_intervall_tage >= 1),
  unique (markt_id, name),
  check (reduzier_vorlauf_tage between 0 and pruef_vorlauf_tage)
);

create table if not exists mhd.artikel (
  id                 bigint generated always as identity primary key,
  markt_id           bigint not null references mhd.maerkte (id) on delete cascade,
  ean                text check (ean ~ '^([0-9]{8}|[0-9]{13})$'),
  name               text not null check (btrim(name) <> '' and char_length(name) <= 120),
  marke              text,
  menge              text,
  platz              text,
  warengruppe_id     bigint references mhd.warengruppen (id) on delete set null,
  quelle             text not null check (quelle in ('off', 'hand')),
  mhd                date,
  bestand            boolean not null default false,
  reduziert          boolean not null default false,
  letzte_aktion_am   date,
  ohne_bestand_seit  date,
  aktiv              boolean not null default true,
  unique (markt_id, ean)
);

-- Nur anfügen, nie ändern (Trigger unten).
create table if not exists mhd.protokoll (
  id             bigint generated always as identity primary key,
  markt_id       bigint not null references mhd.maerkte (id),
  artikel_id     bigint references mhd.artikel (id),
  mitarbeiter_id bigint references mhd.mitarbeiter (id),
  zeitpunkt      timestamptz not null default mhd.jetzt(),
  art            text not null,
  mhd_alt        date,
  mhd_neu        date
);

alter table mhd.maerkte       enable row level security;
alter table mhd.markt_konten  enable row level security;
alter table mhd.mitarbeiter   enable row level security;
alter table mhd.sitzungen     enable row level security;
alter table mhd.warengruppen  enable row level security;
alter table mhd.artikel       enable row level security;
alter table mhd.protokoll     enable row level security;

-- Zustände, die es nicht geben darf (idempotent nachgezogen): Bestand braucht MHD
-- und Prüftag; ohne Bestand muss feststehen, seit wann.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'artikel_bestand_check'
                    and conrelid = 'mhd.artikel'::regclass) then
    alter table mhd.artikel add constraint artikel_bestand_check
      check (not bestand or (mhd is not null and letzte_aktion_am is not null));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'artikel_ohne_bestand_check'
                    and conrelid = 'mhd.artikel'::regclass) then
    alter table mhd.artikel add constraint artikel_ohne_bestand_check
      check (bestand or ohne_bestand_seit is not null);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Protokoll ist unveränderlich
-- ---------------------------------------------------------------------------

-- Ausnahme nur für das Zurücksetzen der Demo-Daten (Einstellung mhd.demo_reset = 1).
create or replace function mhd.protokoll_schuetzen()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('mhd.demo_reset', true), '') = '1' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  raise exception 'PROTOKOLL_UNVERAENDERLICH';
end;
$$;

drop trigger if exists protokoll_unveraenderlich on mhd.protokoll;
create trigger protokoll_unveraenderlich
  before update or delete on mhd.protokoll
  for each row execute function mhd.protokoll_schuetzen();

-- ---------------------------------------------------------------------------
-- PIN und Markt anlegen
-- ---------------------------------------------------------------------------

-- Die PIN-Regel (4 bis 6 Ziffern) an einer Stelle; liefert den Hash.
create or replace function mhd.pin_hash(p_pin text)
returns text
language plpgsql
set search_path = ''
as $$
begin
  if p_pin is null or p_pin !~ '^[0-9]{4,6}$' then
    raise exception 'PIN_UNGUELTIG';
  end if;
  return extensions.crypt(p_pin, extensions.gen_salt('bf'));
end;
$$;

-- Legt Markt, Konto-Verknüpfung, erste Marktleitung und die Standard-Warengruppen an.
-- Das Konto (E-Mail) muss in Supabase Auth schon existieren.
create or replace function mhd.markt_anlegen(p_name text, p_email text, p_leitung text, p_pin text)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_user_id  uuid;
  v_markt_id bigint;
begin
  select id into v_user_id from auth.users where lower(email) = lower(btrim(p_email));
  if v_user_id is null then
    raise exception 'KONTO_UNBEKANNT';
  end if;

  insert into mhd.maerkte (name) values (p_name) returning id into v_markt_id;
  insert into mhd.markt_konten (user_id, markt_id) values (v_user_id, v_markt_id);
  insert into mhd.mitarbeiter (markt_id, name, rolle, pin_hash)
    values (v_markt_id, p_leitung, 'leitung', mhd.pin_hash(p_pin));

  insert into mhd.warengruppen (markt_id, name, pruef_vorlauf_tage, reduzier_vorlauf_tage, max_intervall_tage)
  select v_markt_id, v.name, v.pruef, v.reduzier, v.hoechst
  from (values
    ('Molkerei', 3, 2, 30),
    ('Fleisch und Wurst', 2, 1, 14),
    ('Backwaren', 2, 1, 14),
    ('Feinkost und Salate', 3, 2, 14),
    ('Tiefkühl', 30, 14, 60),
    ('Trockensortiment', 14, 7, 30),
    ('Süßwaren', 14, 7, 30),
    ('Getränke', 30, 14, 60),
    ('Konserven', 30, 14, 90),
    ('Drogerie', 30, 14, 90),
    ('Sonstiges', 7, 3, 30)
  ) as v (name, pruef, reduzier, hoechst);

  return v_markt_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Terminlogik
-- ---------------------------------------------------------------------------

-- Nächster Termin eines Artikels, berechnet nach einer Aktion am Tag p_letzte.
-- Drei Termine je MHD: prüfen (MHD - p_pruef), reduzieren (MHD - p_reduzier,
-- entfällt, wenn schon reduziert) und läuft heute ab (am MHD-Tag). Es zählt der
-- früheste Termin, der nach p_letzte liegt, spätestens aber p_letzte + p_max
-- (dann als „pruefen“). Bei gleichem Datum gilt: laeuft_ab vor reduzieren vor
-- pruefen. Liegt p_letzte auf oder nach dem MHD, gibt es keinen Termin (keine Zeile).
create or replace function mhd.termin(
  p_mhd date, p_letzte date, p_reduziert boolean,
  p_pruef int, p_reduzier int, p_max int)
returns table (datum date, art text)
language sql immutable
set search_path = ''
as $$
  select k.datum, k.art
    from (
      select p_mhd - p_pruef as datum, 'pruefen' as art, 3 as rang
      union all
      select p_mhd - p_reduzier, 'reduzieren', 2 where not p_reduziert
      union all
      select p_mhd, 'laeuft_ab', 1
      union all
      select p_letzte + p_max, 'pruefen', 3
    ) as k
   where p_letzte < p_mhd and k.datum > p_letzte
   order by k.datum, k.rang
   limit 1
$$;

-- ---------------------------------------------------------------------------
-- Anmeldung: Markt-Konto und PIN
-- ---------------------------------------------------------------------------

-- Der Markt des angemeldeten Kontos (auth.uid()); ohne Konto oder Verknüpfung KEIN_ZUGRIFF.
create or replace function mhd.mein_markt()
returns bigint
language plpgsql stable
set search_path = ''
as $$
declare
  v_markt_id bigint;
begin
  select markt_id into v_markt_id from mhd.markt_konten where user_id = auth.uid();
  if v_markt_id is null then
    raise exception 'KEIN_ZUGRIFF';
  end if;
  return v_markt_id;
end;
$$;

-- Der Mitarbeiter hinter einer Sitzung. Die Sitzung muss zum Markt des Kontos
-- gehören, der Mitarbeiter aktiv sein und die letzte Aktion höchstens 30 Minuten
-- zurückliegen; jeder Aufruf verlängert die Sitzung. Sonst PIN_ABGELAUFEN.
create or replace function mhd.wer(p_sitzung uuid)
returns mhd.mitarbeiter
language plpgsql
set search_path = ''
as $$
declare
  v_markt_id bigint := mhd.mein_markt();
  v_m        mhd.mitarbeiter;
begin
  select m.* into v_m
    from mhd.sitzungen s
    join mhd.mitarbeiter m on m.id = s.mitarbeiter_id
   where s.token = p_sitzung
     and m.markt_id = v_markt_id
     and m.aktiv
     and s.letzte_aktion >= mhd.jetzt() - interval '30 minutes';
  if v_m.id is null then
    raise exception 'PIN_ABGELAUFEN';
  end if;
  update mhd.sitzungen set letzte_aktion = mhd.jetzt() where token = p_sitzung;
  return v_m;
end;
$$;

-- Wie wer, aber nur für die Marktleitung (sonst NUR_LEITUNG).
create or replace function mhd.leitung(p_sitzung uuid)
returns mhd.mitarbeiter
language plpgsql
set search_path = ''
as $$
declare
  v_m mhd.mitarbeiter := mhd.wer(p_sitzung);
begin
  if v_m.rolle <> 'leitung' then
    raise exception 'NUR_LEITUNG';
  end if;
  return v_m;
end;
$$;

-- Markt und aktive Mitarbeiter (nur Id und Name) für die Auswahl nach der Markt-Anmeldung.
create or replace function public.mhd_markt()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_markt_id bigint := mhd.mein_markt();
begin
  return jsonb_build_object(
    'markt', (select jsonb_build_object('id', m.id, 'name', m.name) from mhd.maerkte m where m.id = v_markt_id),
    'mitarbeiter', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) order by x.name, x.id)
        from mhd.mitarbeiter x
       where x.markt_id = v_markt_id and x.aktiv), '[]'::jsonb));
end;
$$;

-- PIN-Anmeldung. Falsche PIN ist KEINE Exception: sie würde das Hochzählen von
-- fehlversuche zurückrollen und die Sperre wirkungslos machen. Fehler als JSON.
-- Nach 5 falschen PINs ist der Mitarbeiter 15 Minuten gesperrt.
create or replace function public.mhd_pin_anmelden(p_mitarbeiter bigint, p_pin text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_markt_id bigint := mhd.mein_markt();
  v_m        mhd.mitarbeiter;
  v_token    uuid;
begin
  select * into v_m from mhd.mitarbeiter
   where id = p_mitarbeiter and markt_id = v_markt_id and aktiv
   for update;
  if v_m.id is null then
    return jsonb_build_object('ok', false, 'fehler', 'PIN_FALSCH', 'gesperrt_bis', null);
  end if;

  if v_m.gesperrt_bis is not null and v_m.gesperrt_bis > mhd.jetzt() then
    return jsonb_build_object('ok', false, 'fehler', 'PIN_GESPERRT', 'gesperrt_bis', v_m.gesperrt_bis);
  end if;

  if v_m.pin_hash <> extensions.crypt(coalesce(p_pin, ''), v_m.pin_hash) then
    if v_m.fehlversuche + 1 >= 5 then
      update mhd.mitarbeiter
         set fehlversuche = 0, gesperrt_bis = mhd.jetzt() + interval '15 minutes'
       where id = v_m.id
       returning gesperrt_bis into v_m.gesperrt_bis;
      return jsonb_build_object('ok', false, 'fehler', 'PIN_GESPERRT', 'gesperrt_bis', v_m.gesperrt_bis);
    end if;
    update mhd.mitarbeiter set fehlversuche = fehlversuche + 1 where id = v_m.id;
    return jsonb_build_object('ok', false, 'fehler', 'PIN_FALSCH', 'gesperrt_bis', null);
  end if;

  update mhd.mitarbeiter set fehlversuche = 0, gesperrt_bis = null where id = v_m.id;
  -- Abgelaufene Sitzungen des Marktes (länger als 30 Minuten ohne Aktion) aufräumen.
  delete from mhd.sitzungen s
   using mhd.mitarbeiter x
   where x.id = s.mitarbeiter_id and x.markt_id = v_markt_id
     and s.letzte_aktion < mhd.jetzt() - interval '30 minutes';
  insert into mhd.sitzungen (mitarbeiter_id, letzte_aktion) values (v_m.id, mhd.jetzt())
    returning token into v_token;
  return jsonb_build_object('ok', true, 'sitzung', v_token, 'name', v_m.name, 'rolle', v_m.rolle);
end;
$$;

-- Beendet die Sitzung; eine unbekannte oder fremde Sitzung wird still ignoriert.
create or replace function public.mhd_pin_abmelden(p_sitzung uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_markt_id bigint := mhd.mein_markt();
begin
  delete from mhd.sitzungen s
   using mhd.mitarbeiter m
   where s.token = p_sitzung and m.id = s.mitarbeiter_id and m.markt_id = v_markt_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Artikel und Warengruppen
-- ---------------------------------------------------------------------------

-- Ein Artikel als JSON für die Oberfläche, mit Abschnitt der Liste „Heute“
-- (Fachregeln aus Abschnitt 8 des Entwurfs). Der nächste Termin wird bei jedem
-- Lesen aus mhd.termin berechnet und nie gespeichert; letzte_aktion_am ist
-- der Ausgangstag. Nur aktive Artikel gehören in die Liste.
--   mit Bestand:  MHD vor heute            -> abgelaufen (versaeumt „abgelaufen“)
--                 Termin vor heute         -> abgelaufen (versaeumt = Art des Termins)
--                 Termin heute             -> Abschnitt = Art des Termins
--   ohne Bestand: seit mehr als max_intervall_tage -> ohne_bestand
-- Ohne Warengruppe gelten vorsichtshalber die Werte von „Sonstiges“ (7/3/30),
-- damit ein Artikel nicht still aus der Liste fällt.
create or replace function mhd.artikel_json(p_artikel mhd.artikel)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_heute     date := mhd.heute();
  v_pruef     int := 7;
  v_reduzier  int := 3;
  v_max       int := 30;
  v_abschnitt text;
  v_versaeumt text;
  v_seit      int;
  v_termin    record;
begin
  if p_artikel.warengruppe_id is not null then
    select w.pruef_vorlauf_tage, w.reduzier_vorlauf_tage, w.max_intervall_tage
      into v_pruef, v_reduzier, v_max
      from mhd.warengruppen w where w.id = p_artikel.warengruppe_id;
  end if;

  if p_artikel.aktiv and p_artikel.bestand and p_artikel.mhd is not null then
    if p_artikel.mhd < v_heute then
      v_abschnitt := 'abgelaufen';
      v_versaeumt := 'abgelaufen';
      v_seit := v_heute - p_artikel.mhd;
    else
      select * into v_termin
        from mhd.termin(p_artikel.mhd, coalesce(p_artikel.letzte_aktion_am, v_heute - 1),
                        p_artikel.reduziert, v_pruef, v_reduzier, v_max);
      if v_termin.datum < v_heute then
        v_abschnitt := 'abgelaufen';
        v_versaeumt := v_termin.art;
        v_seit := v_heute - v_termin.datum;
      elsif v_termin.datum = v_heute then
        v_abschnitt := v_termin.art;
      end if;
    end if;
  elsif p_artikel.aktiv and not p_artikel.bestand and p_artikel.ohne_bestand_seit is not null
        and p_artikel.ohne_bestand_seit + v_max < v_heute then
    v_abschnitt := 'ohne_bestand';
    v_seit := v_heute - p_artikel.ohne_bestand_seit;
  end if;

  return jsonb_build_object(
    'id', p_artikel.id,
    'ean', p_artikel.ean,
    'name', p_artikel.name,
    'marke', p_artikel.marke,
    'menge', p_artikel.menge,
    'platz', p_artikel.platz,
    'warengruppe_id', p_artikel.warengruppe_id,
    'warengruppe', (select w.name from mhd.warengruppen w where w.id = p_artikel.warengruppe_id),
    'mhd', p_artikel.mhd,
    'bestand', p_artikel.bestand,
    'reduziert', p_artikel.reduziert,
    'aktiv', p_artikel.aktiv,
    'abschnitt', v_abschnitt,
    'versaeumt', v_versaeumt,
    'seit_tagen', v_seit);
end;
$$;

-- Die Warengruppen des Marktes mit ihren Vorlaufzeiten, nach Name.
create or replace function public.mhd_warengruppen(p_sitzung uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_m mhd.mitarbeiter := mhd.wer(p_sitzung);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', w.id,
             'name', w.name,
             'pruef_vorlauf_tage', w.pruef_vorlauf_tage,
             'reduzier_vorlauf_tage', w.reduzier_vorlauf_tage,
             'max_intervall_tage', w.max_intervall_tage) order by w.name, w.id)
      from mhd.warengruppen w
     where w.markt_id = v_m.markt_id), '[]'::jsonb);
end;
$$;

-- Der Artikel zu einer EAN im eigenen Markt, sonst null.
create or replace function public.mhd_artikel_suchen(p_sitzung uuid, p_ean text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_m mhd.mitarbeiter := mhd.wer(p_sitzung);
  v_a mhd.artikel;
begin
  select * into v_a from mhd.artikel
   where markt_id = v_m.markt_id and ean = btrim(p_ean);
  if v_a.id is null then
    return null;
  end if;
  return mhd.artikel_json(v_a);
end;
$$;

-- Höchstens 50 Artikel des Marktes nach Name. Die Suche ignoriert Groß- und
-- Kleinschreibung und sucht in Name, Marke und EAN (reiner Textvergleich,
-- Platzhalterzeichen haben keine Wirkung). p_ohne_ean zeigt nur Artikel ohne EAN.
create or replace function public.mhd_artikel_liste(
  p_sitzung uuid, p_suche text default '', p_ohne_ean boolean default false)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_m     mhd.mitarbeiter := mhd.wer(p_sitzung);
  v_suche text := lower(btrim(coalesce(p_suche, '')));
begin
  return coalesce((
    with t as (
      select a from mhd.artikel a
       where a.markt_id = v_m.markt_id
         and (not coalesce(p_ohne_ean, false) or a.ean is null)
         and (v_suche = ''
              or position(v_suche in lower(a.name)) > 0
              or position(v_suche in lower(coalesce(a.marke, ''))) > 0
              or position(v_suche in coalesce(a.ean, '')) > 0)
       order by lower(a.name), a.name, a.id
       limit 50)
    select jsonb_agg(mhd.artikel_json(t.a) order by lower((t.a).name), (t.a).name, (t.a).id) from t
  ), '[]'::jsonb);
end;
$$;

-- Legt einen Artikel an (p_id null) oder ändert ihn (p_id gesetzt).
-- p_daten: { ean, name, marke, menge, platz, warengruppe_id, quelle }.
-- Mit EAN darf jeder Mitarbeiter anlegen; ohne EAN anlegen und jedes Ändern nur
-- die Marktleitung. Beim Ändern bleibt die EAN unverändert. Geprüft wird nur das
-- Format der EAN (8 oder 13 Ziffern) und der Waagen-Code (erste Ziffer 2); die
-- Prüfziffer prüft der Browser.
create or replace function public.mhd_artikel_speichern(p_sitzung uuid, p_id bigint, p_daten jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_m      mhd.mitarbeiter := mhd.wer(p_sitzung);
  v_daten  jsonb := coalesce(p_daten, '{}'::jsonb);
  v_ean    text := nullif(btrim(v_daten ->> 'ean'), '');
  v_name   text := nullif(btrim(v_daten ->> 'name'), '');
  v_quelle text := nullif(btrim(v_daten ->> 'quelle'), '');
  v_wg     bigint := nullif(btrim(v_daten ->> 'warengruppe_id'), '')::bigint;
  v_a      mhd.artikel;
begin
  if p_id is not null or v_ean is null then
    v_m := mhd.leitung(p_sitzung);
  end if;

  if p_id is null and v_ean is not null then
    if v_ean !~ '^([0-9]{8}|[0-9]{13})$' then
      raise exception 'EAN_UNGUELTIG';
    end if;
    if left(v_ean, 1) = '2' then
      raise exception 'WAAGENCODE';
    end if;
  end if;

  if v_name is null then
    raise exception 'NAME_FEHLT';
  end if;
  v_name := btrim(left(v_name, 120));

  if v_quelle is not null and v_quelle not in ('off', 'hand') then
    raise exception 'QUELLE_UNGUELTIG';
  end if;

  if v_wg is not null and not exists (
       select 1 from mhd.warengruppen w where w.id = v_wg and w.markt_id = v_m.markt_id) then
    raise exception 'WARENGRUPPE_UNBEKANNT';
  end if;

  if p_id is null then
    begin
      insert into mhd.artikel (markt_id, ean, name, marke, menge, platz, warengruppe_id, quelle, bestand, ohne_bestand_seit)
      values (v_m.markt_id, v_ean, v_name,
              nullif(btrim(v_daten ->> 'marke'), ''), nullif(btrim(v_daten ->> 'menge'), ''),
              nullif(btrim(v_daten ->> 'platz'), ''), v_wg,
              coalesce(v_quelle, 'hand'), false, mhd.heute())
      returning * into v_a;
    exception when unique_violation then
      raise exception 'ARTIKEL_VORHANDEN';
    end;
  else
    update mhd.artikel
       set name = v_name,
           marke = nullif(btrim(v_daten ->> 'marke'), ''),
           menge = nullif(btrim(v_daten ->> 'menge'), ''),
           platz = nullif(btrim(v_daten ->> 'platz'), ''),
           warengruppe_id = v_wg,
           quelle = coalesce(v_quelle, quelle)
     where id = p_id and markt_id = v_m.markt_id
     returning * into v_a;
    if v_a.id is null then
      raise exception 'ARTIKEL_UNBEKANNT';
    end if;
  end if;
  return mhd.artikel_json(v_a);
end;
$$;

-- ---------------------------------------------------------------------------
-- Liste „Heute“ und Aktionen
-- ---------------------------------------------------------------------------

-- Das Protokoll kennt genau die fünf Aktionen (idempotent nachgezogen).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'protokoll_art_check'
                    and conrelid = 'mhd.protokoll'::regclass) then
    alter table mhd.protokoll add constraint protokoll_art_check
      check (art in ('geprueft', 'reduziert', 'aussortiert', 'ohne_bestand', 'ruht'));
  end if;
end;
$$;

-- Die Liste „Heute“: aktive Artikel des eigenen Marktes in fünf Abschnitten,
-- je Artikel nur im obersten zutreffenden; sortiert nach Platz (leere zuletzt), dann Name.
create or replace function public.mhd_liste(p_sitzung uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_m mhd.mitarbeiter := mhd.wer(p_sitzung);
begin
  return (
    with t as (
      select a.platz, a.name, a.id, mhd.artikel_json(a) as j
        from mhd.artikel a
       where a.markt_id = v_m.markt_id and a.aktiv)
    select jsonb_build_object(
      'heute', mhd.heute(),
      'abschnitte', jsonb_build_object(
        'abgelaufen',   coalesce(jsonb_agg(t.j order by t.platz nulls last, lower(t.name), t.name, t.id)
                                 filter (where t.j ->> 'abschnitt' = 'abgelaufen'), '[]'::jsonb),
        'laeuft_ab',    coalesce(jsonb_agg(t.j order by t.platz nulls last, lower(t.name), t.name, t.id)
                                 filter (where t.j ->> 'abschnitt' = 'laeuft_ab'), '[]'::jsonb),
        'pruefen',      coalesce(jsonb_agg(t.j order by t.platz nulls last, lower(t.name), t.name, t.id)
                                 filter (where t.j ->> 'abschnitt' = 'pruefen'), '[]'::jsonb),
        'reduzieren',   coalesce(jsonb_agg(t.j order by t.platz nulls last, lower(t.name), t.name, t.id)
                                 filter (where t.j ->> 'abschnitt' = 'reduzieren'), '[]'::jsonb),
        'ohne_bestand', coalesce(jsonb_agg(t.j order by t.platz nulls last, lower(t.name), t.name, t.id)
                                 filter (where t.j ->> 'abschnitt' = 'ohne_bestand'), '[]'::jsonb)))
      from t);
end;
$$;

-- Eine Aktion am Artikel (jede zählt als Prüfung, setzt letzte_aktion_am auf heute
-- und schreibt eine Protokollzeile):
--   geprueft      p_mhd Pflicht (MHD_FEHLT); Bestand, Reduziert-Vermerk nur bei gleichem
--                 MHD, ohne_bestand_seit leer, aktiv (holt auch einen ruhenden Artikel
--                 und „wieder da“ zurück)
--   reduziert     Bestand nötig (KEIN_BESTAND)
--   aussortiert   mit p_mhd wie geprueft, aber nicht reduziert; ohne p_mhd: kein Bestand
--   ohne_bestand  nur ohne Bestand (BESTAND_VORHANDEN): stellt die Frage neu
--   ruht          nur ohne Bestand (BESTAND_VORHANDEN): nimmt den Artikel aus der Liste
--                 (aktiv = false); ein Artikel mit Bestand darf nicht verschwinden
-- Es gilt der letzte Stand (keine Sperre gegen gleichzeitige Aktionen).
create or replace function public.mhd_aktion(
  p_sitzung uuid, p_artikel bigint, p_art text, p_mhd date default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_m     mhd.mitarbeiter := mhd.wer(p_sitzung);
  v_heute date := mhd.heute();
  v_alt   mhd.artikel;
  v_neu   mhd.artikel;
begin
  if p_art is null or p_art not in ('geprueft', 'reduziert', 'aussortiert', 'ohne_bestand', 'ruht') then
    raise exception 'AKTION_UNGUELTIG';
  end if;

  select * into v_alt from mhd.artikel
   where id = p_artikel and markt_id = v_m.markt_id
   for update;
  if v_alt.id is null then
    raise exception 'ARTIKEL_UNBEKANNT';
  end if;

  if p_art = 'geprueft' and p_mhd is null then
    raise exception 'MHD_FEHLT';
  elsif p_art = 'reduziert' and not v_alt.bestand then
    raise exception 'KEIN_BESTAND';
  elsif p_art in ('ohne_bestand', 'ruht') and v_alt.bestand then
    raise exception 'BESTAND_VORHANDEN';
  end if;

  if p_art = 'geprueft' or (p_art = 'aussortiert' and p_mhd is not null) then
    update mhd.artikel
       set mhd = p_mhd,
           bestand = true,
           reduziert = (p_art = 'geprueft' and v_alt.reduziert and v_alt.mhd is not distinct from p_mhd),
           ohne_bestand_seit = null,
           aktiv = true,
           letzte_aktion_am = v_heute
     where id = v_alt.id returning * into v_neu;
  elsif p_art = 'reduziert' then
    update mhd.artikel set reduziert = true, letzte_aktion_am = v_heute
     where id = v_alt.id returning * into v_neu;
  elsif p_art = 'aussortiert' then
    update mhd.artikel
       set bestand = false, mhd = null, reduziert = false,
           ohne_bestand_seit = v_heute, letzte_aktion_am = v_heute
     where id = v_alt.id returning * into v_neu;
  elsif p_art = 'ohne_bestand' then
    update mhd.artikel set ohne_bestand_seit = v_heute, letzte_aktion_am = v_heute
     where id = v_alt.id returning * into v_neu;
  else
    update mhd.artikel set aktiv = false, letzte_aktion_am = v_heute
     where id = v_alt.id returning * into v_neu;
  end if;

  insert into mhd.protokoll (markt_id, artikel_id, mitarbeiter_id, zeitpunkt, art, mhd_alt, mhd_neu)
  values (v_m.markt_id, v_alt.id, v_m.id, mhd.jetzt(), p_art, v_alt.mhd, v_neu.mhd);

  return mhd.artikel_json(v_neu);
end;
$$;

-- ---------------------------------------------------------------------------
-- Marktleitung: Mitarbeiter, Regeln der Warengruppen, Protokoll
-- ---------------------------------------------------------------------------

-- Alle Mitarbeiter des Marktes (auch inaktive) nach Name; gesperrt = PIN gerade gesperrt.
create or replace function public.mhd_mitarbeiter_liste(p_sitzung uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_m mhd.mitarbeiter := mhd.leitung(p_sitzung);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', x.id, 'name', x.name, 'rolle', x.rolle, 'aktiv', x.aktiv,
             'gesperrt', coalesce(x.gesperrt_bis > mhd.jetzt(), false)) order by x.name, x.id)
      from mhd.mitarbeiter x
     where x.markt_id = v_m.markt_id), '[]'::jsonb);
end;
$$;

-- Legt einen Mitarbeiter an (p_id null) oder ändert ihn.
-- p_daten: { name, rolle, aktiv, pin }. Die PIN ist beim Anlegen Pflicht; beim Ändern
-- optional, setzt sie neu und hebt Sperre und Fehlversuche auf. Die letzte aktive
-- Leitung darf weder herabgestuft noch deaktiviert werden. Deaktivieren beendet
-- die Sitzungen des Mitarbeiters. Mitarbeiter werden nie gelöscht (Protokoll).
create or replace function public.mhd_mitarbeiter_speichern(p_sitzung uuid, p_id bigint, p_daten jsonb)
returns bigint
language plpgsql security definer
set search_path = ''
as $$
declare
  v_m     mhd.mitarbeiter := mhd.leitung(p_sitzung);
  v_daten jsonb := coalesce(p_daten, '{}'::jsonb);
  v_name  text := nullif(btrim(v_daten ->> 'name'), '');
  v_rolle text := nullif(btrim(v_daten ->> 'rolle'), '');
  v_pin   text := nullif(v_daten ->> 'pin', '');
  v_alt   mhd.mitarbeiter;
  v_aktiv boolean;
  v_id    bigint;
begin
  if v_name is null then
    raise exception 'NAME_FEHLT';
  end if;
  if v_rolle is null or v_rolle not in ('leitung', 'mitarbeiter') then
    raise exception 'ROLLE_UNGUELTIG';
  end if;

  -- Die aktiven Leitungen des Marktes sperren, damit zwei gleichzeitige Änderungen
  -- nicht beide die „letzte“ Leitung entfernen.
  perform 1 from mhd.mitarbeiter
   where markt_id = v_m.markt_id and rolle = 'leitung' and aktiv for update;

  if p_id is null then
    v_aktiv := coalesce((v_daten ->> 'aktiv')::boolean, true);
    begin
      insert into mhd.mitarbeiter (markt_id, name, rolle, pin_hash, aktiv)
      values (v_m.markt_id, v_name, v_rolle, mhd.pin_hash(v_pin), v_aktiv)
      returning id into v_id;
    exception when unique_violation then
      raise exception 'NAME_VERGEBEN';
    end;
    return v_id;
  end if;

  select * into v_alt from mhd.mitarbeiter where id = p_id and markt_id = v_m.markt_id for update;
  if v_alt.id is null then
    raise exception 'MITARBEITER_UNBEKANNT';
  end if;
  v_aktiv := coalesce((v_daten ->> 'aktiv')::boolean, v_alt.aktiv);

  if v_alt.rolle = 'leitung' and v_alt.aktiv and not (v_rolle = 'leitung' and v_aktiv)
     and not exists (select 1 from mhd.mitarbeiter x
                      where x.markt_id = v_m.markt_id and x.rolle = 'leitung' and x.aktiv and x.id <> v_alt.id) then
    raise exception 'LETZTE_LEITUNG';
  end if;

  begin
    update mhd.mitarbeiter
       set name = v_name, rolle = v_rolle, aktiv = v_aktiv,
           pin_hash = case when v_pin is null then pin_hash else mhd.pin_hash(v_pin) end,
           fehlversuche = case when v_pin is null then fehlversuche else 0 end,
           gesperrt_bis = case when v_pin is null then gesperrt_bis else null end
     where id = v_alt.id;
  exception when unique_violation then
    raise exception 'NAME_VERGEBEN';
  end;

  if not v_aktiv then
    delete from mhd.sitzungen where mitarbeiter_id = v_alt.id;
  end if;
  return v_alt.id;
end;
$$;

-- Legt eine Warengruppe an (p_id null) oder ändert ihre Regel.
-- p_daten: { name, pruef_vorlauf_tage, reduzier_vorlauf_tage, max_intervall_tage }.
-- Regelverstoß (Zahl fehlt, Reduzier-Vorlauf größer als Prüf-Vorlauf, Höchstabstand
-- unter 1) ist REGEL_UNGUELTIG. Die Termine werden bei jedem Lesen neu berechnet,
-- eine Änderung wirkt also sofort auf alle Artikel der Gruppe.
create or replace function public.mhd_warengruppe_speichern(p_sitzung uuid, p_id bigint, p_daten jsonb)
returns bigint
language plpgsql security definer
set search_path = ''
as $$
declare
  v_m     mhd.mitarbeiter := mhd.leitung(p_sitzung);
  v_daten jsonb := coalesce(p_daten, '{}'::jsonb);
  v_name  text := nullif(btrim(v_daten ->> 'name'), '');
  v_id    bigint;
begin
  if v_name is null then
    raise exception 'NAME_FEHLT';
  end if;

  begin
    if p_id is null then
      insert into mhd.warengruppen (markt_id, name, pruef_vorlauf_tage, reduzier_vorlauf_tage, max_intervall_tage)
      values (v_m.markt_id, v_name,
              (v_daten ->> 'pruef_vorlauf_tage')::integer,
              (v_daten ->> 'reduzier_vorlauf_tage')::integer,
              (v_daten ->> 'max_intervall_tage')::integer)
      returning id into v_id;
    else
      update mhd.warengruppen
         set name = v_name,
             pruef_vorlauf_tage = (v_daten ->> 'pruef_vorlauf_tage')::integer,
             reduzier_vorlauf_tage = (v_daten ->> 'reduzier_vorlauf_tage')::integer,
             max_intervall_tage = (v_daten ->> 'max_intervall_tage')::integer
       where id = p_id and markt_id = v_m.markt_id
       returning id into v_id;
    end if;
  exception
    when unique_violation then
      raise exception 'NAME_VERGEBEN';
    when check_violation or not_null_violation or invalid_text_representation or numeric_value_out_of_range then
      raise exception 'REGEL_UNGUELTIG';
  end;

  if v_id is null then
    raise exception 'WARENGRUPPE_UNBEKANNT';
  end if;
  return v_id;
end;
$$;

-- Das Protokoll des Marktes, neueste Zeilen zuerst, höchstens 500. p_von und p_bis
-- sind ganze Kalendertage in Europe/Berlin (beide eingeschlossen); null lässt die
-- Grenze offen. Mitarbeiter und Artikel sind Namen; p_mitarbeiter und p_artikel filtern.
create or replace function public.mhd_protokoll(
  p_sitzung uuid, p_von date, p_bis date, p_mitarbeiter bigint default null, p_artikel bigint default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_m mhd.mitarbeiter := mhd.leitung(p_sitzung);
begin
  return coalesce((
    with t as (
      select p.id, p.zeitpunkt, p.art, p.mhd_alt, p.mhd_neu, x.name as mitarbeiter, a.name as artikel, a.ean
        from mhd.protokoll p
        left join mhd.mitarbeiter x on x.id = p.mitarbeiter_id
        left join mhd.artikel a on a.id = p.artikel_id
       where p.markt_id = v_m.markt_id
         and (p_von is null or p.zeitpunkt >= p_von::timestamp at time zone 'Europe/Berlin')
         and (p_bis is null or p.zeitpunkt < (p_bis + 1)::timestamp at time zone 'Europe/Berlin')
         and (p_mitarbeiter is null or p.mitarbeiter_id = p_mitarbeiter)
         and (p_artikel is null or p.artikel_id = p_artikel)
       order by p.zeitpunkt desc, p.id desc
       limit 500)
    select jsonb_agg(jsonb_build_object(
             'zeitpunkt', t.zeitpunkt, 'mitarbeiter', t.mitarbeiter, 'artikel', t.artikel,
             'ean', t.ean, 'art', t.art, 'mhd_alt', t.mhd_alt, 'mhd_neu', t.mhd_neu)
           order by t.zeitpunkt desc, t.id desc)
      from t), '[]'::jsonb);
end;
$$;

revoke all on function mhd.heute() from public, anon, authenticated;
revoke all on function mhd.jetzt() from public, anon, authenticated;
revoke all on function mhd.protokoll_schuetzen() from public, anon, authenticated;
revoke all on function mhd.pin_hash(text) from public, anon, authenticated;
revoke all on function mhd.mein_markt() from public, anon, authenticated;
revoke all on function mhd.wer(uuid) from public, anon, authenticated;
revoke all on function mhd.leitung(uuid) from public, anon, authenticated;
revoke all on function public.mhd_markt() from public, anon, authenticated;
revoke all on function public.mhd_pin_anmelden(bigint, text) from public, anon, authenticated;
revoke all on function public.mhd_pin_abmelden(uuid) from public, anon, authenticated;
grant execute on function public.mhd_markt() to authenticated;
grant execute on function public.mhd_pin_anmelden(bigint, text) to authenticated;
grant execute on function public.mhd_pin_abmelden(uuid) to authenticated;
revoke all on function mhd.markt_anlegen(text, text, text, text) from public, anon, authenticated;
revoke all on function mhd.termin(date, date, boolean, int, int, int) from public, anon, authenticated;
revoke all on function mhd.artikel_json(mhd.artikel) from public, anon, authenticated;
revoke all on function public.mhd_warengruppen(uuid) from public, anon, authenticated;
revoke all on function public.mhd_artikel_suchen(uuid, text) from public, anon, authenticated;
revoke all on function public.mhd_artikel_liste(uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.mhd_artikel_speichern(uuid, bigint, jsonb) from public, anon, authenticated;
revoke all on function public.mhd_liste(uuid) from public, anon, authenticated;
revoke all on function public.mhd_aktion(uuid, bigint, text, date) from public, anon, authenticated;
grant execute on function public.mhd_liste(uuid) to authenticated;
grant execute on function public.mhd_aktion(uuid, bigint, text, date) to authenticated;
grant execute on function public.mhd_warengruppen(uuid) to authenticated;
grant execute on function public.mhd_artikel_suchen(uuid, text) to authenticated;
grant execute on function public.mhd_artikel_liste(uuid, text, boolean) to authenticated;
grant execute on function public.mhd_artikel_speichern(uuid, bigint, jsonb) to authenticated;
revoke all on function public.mhd_mitarbeiter_liste(uuid) from public, anon, authenticated;
revoke all on function public.mhd_mitarbeiter_speichern(uuid, bigint, jsonb) from public, anon, authenticated;
revoke all on function public.mhd_warengruppe_speichern(uuid, bigint, jsonb) from public, anon, authenticated;
revoke all on function public.mhd_protokoll(uuid, date, date, bigint, bigint) from public, anon, authenticated;
grant execute on function public.mhd_mitarbeiter_liste(uuid) to authenticated;
grant execute on function public.mhd_mitarbeiter_speichern(uuid, bigint, jsonb) to authenticated;
grant execute on function public.mhd_warengruppe_speichern(uuid, bigint, jsonb) to authenticated;
grant execute on function public.mhd_protokoll(uuid, date, date, bigint, bigint) to authenticated;

commit;
