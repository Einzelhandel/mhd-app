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

revoke all on function mhd.pin_hash(text) from public, anon, authenticated;
revoke all on function mhd.markt_anlegen(text, text, text, text) from public, anon, authenticated;

commit;
