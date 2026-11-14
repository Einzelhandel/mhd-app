// Gemeinsamer Aufbau für alle Datenbanktests: PGlite mit nachgebildeten
// Supabase-Rollen, Standardrechten, auth.uid(), auth.users und dem Schema
// "extensions" für pgcrypto, danach das MHD-Schema (zweimal geladen).
// Aufbau übernommen aus einem früheren eigenen Projekt.
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

export const SCHEMA = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');

export async function neueDatenbank({ schema = true } = {}) {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create role anon; create role authenticated; create role service_role; create role supabase_auth_admin;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    create schema auth;
    grant usage on schema auth to anon, authenticated, supabase_auth_admin;
    create table auth.users (
      id uuid primary key default gen_random_uuid(),
      email text unique not null,
      raw_user_meta_data jsonb not null default '{}'
    );
    grant select, insert on auth.users to supabase_auth_admin;
    create function auth.uid() returns uuid language sql stable as $$
      select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
    $$;
    -- Auf Supabase liegt pgcrypto im Schema "extensions".
    create schema extensions;
    grant usage on schema extensions to anon, authenticated;
  `);
  if (schema) {
    await db.exec(SCHEMA);
    await db.exec(SCHEMA); // erneutes Ausführen muss unschädlich sein
  }
  return db;
}

// Führt SQL als Rolle aus, wie PostgREST es mit einem JWT tut.
export async function als(db, rolle, nutzer, sql, params = []) {
  await db.exec(`set role ${rolle}`);
  await db.query("select set_config('request.jwt.claims', $1, false)",
    [nutzer ? JSON.stringify({ sub: nutzer, role: rolle }) : '']);
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claims', '', false)");
  }
}

// Ruft eine Funktion als angemeldeter Nutzer auf; die Abfrage liefert ihr Ergebnis als Spalte "r".
export async function json(db, userId, sql, params = []) {
  return (await als(db, 'authenticated', userId, sql, params))[0].r;
}

// Fixiert mhd.heute() für Tests (Datum "YYYY-MM-DD"); null hebt die Fixierung auf.
export async function heuteSetzen(db, datum) {
  await db.query("select set_config('mhd.heute', $1, false)", [datum ?? '']);
}

// Fixiert mhd.jetzt() für Tests (ISO-Zeitpunkt); null hebt die Fixierung auf.
export async function jetztSetzen(db, isoText) {
  await db.query("select set_config('mhd.jetzt', $1, false)", [isoText ?? '']);
}

// Legt ein Markt-Konto in auth.users an und einen Markt mit Leitung über mhd.markt_anlegen.
export async function markt(db, { name = 'Testmarkt', email = 'markt@example.com', leitung = 'Chef', pin = '4711' } = {}) {
  const u = await db.query('insert into auth.users (email) values ($1) returning id', [email]);
  const userId = u.rows[0].id;
  const m = await db.query('select mhd.markt_anlegen($1, $2, $3, $4) as id', [name, email, leitung, pin]);
  const marktId = Number(m.rows[0].id);
  const l = await db.query("select id from mhd.mitarbeiter where markt_id = $1 and rolle = 'leitung'", [marktId]);
  return { marktId, userId, leitungId: Number(l.rows[0].id) };
}
