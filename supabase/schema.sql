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

-- Ein Artikel als JSON für die Oberfläche. abschnitt, versaeumt und seit_tagen
-- (Fachregeln aus Abschnitt 8 des Entwurfs) sind hier noch null; die Stufe mit
-- der Liste ersetzt diesen Funktionskörper bei gleicher Signatur.
create or replace function mhd.artikel_json(p_artikel mhd.artikel)
returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
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
    'abschnitt', null,
    'versaeumt', null,
    'seit_tagen', null)
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
grant execute on function public.mhd_warengruppen(uuid) to authenticated;
grant execute on function public.mhd_artikel_suchen(uuid, text) to authenticated;
grant execute on function public.mhd_artikel_liste(uuid, text, boolean) to authenticated;
grant execute on function public.mhd_artikel_speichern(uuid, bigint, jsonb) to authenticated;

commit;
