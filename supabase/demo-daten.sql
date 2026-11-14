-- Demo-Daten: erfundener Demo-Markt mit Testartikeln. Nur für Demo und lokalen Test laden,
-- nie in eine Datenbank mit echten Daten. Die Datei ist beliebig oft ladbar.
--
-- Voraussetzung: supabase/schema.sql ist geladen und das Konto (E-Mail) existiert in Supabase Auth.
--   select mhd.demo_einrichten('demo@example.com', '<Leitungs-PIN>');   -- beim ersten Mal mit PIN
--   select mhd.demo_einrichten('demo@example.com');                     -- Zurücksetzen (z. B. täglich)
-- Das Zurücksetzen löscht Artikel und Protokoll des Demo-Markts (und nur dieses) und legt sie neu an;
-- Auch die Warengruppen stehen danach wieder auf den Startwerten. Sperren werden aufgehoben, die PIN von Anna und Ben ist danach wieder 1234. Die Leitungs-PIN ändert
-- sich nur, wenn p_leitung_pin gesetzt ist. Alle Daten sind relativ zu mhd.heute().
-- Produktnamen und Mengen sind die öffentlichen Angaben aus Open Food Facts.

begin;

create or replace function mhd.demo_einrichten(p_email text, p_leitung_pin text default null)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_heute  date := mhd.heute();
  v_markt  bigint;
  v_anna   bigint;
begin
  select m.id into v_markt
    from mhd.maerkte m
    join mhd.markt_konten k on k.markt_id = m.id
    join auth.users u on u.id = k.user_id
   where m.name = 'Demo-Markt' and lower(u.email) = lower(btrim(p_email));

  -- Beim ersten Mal: Markt mit Leitung "Chef" und den Standard-Warengruppen (PIN ist dann Pflicht).
  if v_markt is null then
    v_markt := mhd.markt_anlegen('Demo-Markt', p_email, 'Chef', p_leitung_pin);
  end if;

  insert into mhd.mitarbeiter (markt_id, name, rolle, pin_hash)
  values (v_markt, 'Anna', 'mitarbeiter', mhd.pin_hash('1234')),
         (v_markt, 'Ben',  'mitarbeiter', mhd.pin_hash('1234'))
  on conflict (markt_id, name) do update
    set rolle = 'mitarbeiter', aktiv = true, pin_hash = excluded.pin_hash;

  update mhd.mitarbeiter set fehlversuche = 0, gesperrt_bis = null where markt_id = v_markt;
  if p_leitung_pin is not null then
    update mhd.mitarbeiter set pin_hash = mhd.pin_hash(p_leitung_pin)
     where markt_id = v_markt and name = 'Chef';
  end if;

  -- Das Protokoll ist unveränderlich; nur dieses Zurücksetzen darf es leeren (gilt nur in dieser Transaktion).
  perform set_config('mhd.demo_reset', '1', true);
  delete from mhd.protokoll where markt_id = v_markt;
  delete from mhd.artikel where markt_id = v_markt;
  perform set_config('mhd.demo_reset', '', true);

  -- Warengruppen auf die Startwerte: fehlende anlegen, vorhandene zurücksetzen, selbst angelegte
  -- löschen (sie haben keine Artikel mehr, die Artikel des Demo-Markts sind oben gelöscht).
  insert into mhd.warengruppen (markt_id, name, pruef_vorlauf_tage, reduzier_vorlauf_tage, max_intervall_tage)
  select v_markt, s.name, s.pruef, s.reduzier, s.hoechst from mhd.standard_warengruppen() as s
  on conflict (markt_id, name) do update
    set pruef_vorlauf_tage = excluded.pruef_vorlauf_tage,
        reduzier_vorlauf_tage = excluded.reduzier_vorlauf_tage,
        max_intervall_tage = excluded.max_intervall_tage;
  delete from mhd.warengruppen w
   where w.markt_id = v_markt and w.name not in (select s.name from mhd.standard_warengruppen() as s);

  select id into v_anna from mhd.mitarbeiter where markt_id = v_markt and name = 'Anna';

  -- Zustände mit den Regeln Molkerei 3/2/30, Fleisch und Wurst 2/1/14, Trockensortiment 14/7/30,
  -- Getränke 30/14/60. Die Artikel unter "übrige" sind nirgends fällig:
  -- ihr nächster Termin liegt in der Zukunft.
  insert into mhd.artikel (markt_id, ean, name, menge, platz, warengruppe_id, quelle,
                           mhd, bestand, letzte_aktion_am, ohne_bestand_seit)
  select v_markt, a.ean, a.name, a.menge, a.platz, w.id, case when a.ean is null then 'hand' else 'off' end,
         v_heute + a.mhd_tage, a.mhd_tage is not null, v_heute + a.aktion_tage,
         case when a.mhd_tage is null then v_heute + a.aktion_tage end
    from (values
      -- Abschnitt "abgelaufen" (abgelaufen)
      ('4311501646854', 'Kefir',                                '500 g',  'Kühlregal 1', 'Molkerei',          -1,   -4),
      -- "abgelaufen" (Prüfen versäumt)
      ('4311501679715', 'Skyr Natur',                           '500g',   'Kühlregal 1', 'Molkerei',           2,  -10),
      -- "läuft heute ab"
      ('4311501464489', 'Deutsche Markenbutter - mildgesäuert', '250g',   'Kühlregal 2', 'Molkerei',           0,   -2),
      -- "prüfen"
      ('4311501798027', 'SPEISEQUARK MAGERSTUFE',               '500g',   'Kühlregal 2', 'Molkerei',           3,  -20),
      -- "reduzieren"
      ('4311501657751', 'Skyr',                                 '500g',   'Kühlregal 1', 'Molkerei',           2,   -1),
      -- "prüfen" (Trockensortiment)
      ('4311501492277', 'Haferflocken Kernig',                  '500g',   'Gang 3',      'Trockensortiment',  14,  -5),
      -- "reduzieren" (Fleisch, ohne Strichcode)
      (null,            'Hackfleisch gemischt',                 null,     'Kühltheke',   'Fleisch und Wurst',  1,  -1),
      -- "ohne Bestand" (Getränke: Höchstabstand 60 Tage)
      ('4311596435968', 'Mineralwasser medium',                 '1.5l',   'Gang 5',      'Getränke',          null, -61),
      -- übrige: nichts fällig
      ('4311501365359', 'Katenschinken',                        '75g',    'Kühltheke',   'Fleisch und Wurst',  25,  -3),
      ('4311501711453', 'Delikatess Hähnchenbrust Filetroulade','150g',   'Kühltheke',   'Fleisch und Wurst',  18,  -3),
      ('4311596410644', 'Spaghetti Nudeln',                     '500g',   'Gang 3',      'Trockensortiment',  200,  -3),
      ('4311596421947', 'Mehl',                                 '1000g',  'Gang 3',      'Trockensortiment',  150,  -3),
      ('4311596447893', 'Cola Zero',                            '1,5 L',  'Gang 5',      'Getränke',           90,  -3),
      ('4311501761199', 'Müsliriegel Haselnuss',                '200 g',  'Gang 4',      'Süßwaren',          100,  -3),
      ('4311501688762', 'Choco Chips',                          '750g',   'Gang 4',      'Süßwaren',          180,  -3)
    ) as a (ean, name, menge, platz, gruppe, mhd_tage, aktion_tage)
    left join mhd.warengruppen w on w.markt_id = v_markt and w.name = a.gruppe;

  -- Je Artikel eine Zeile im Protokoll: die letzte Aktion, durch Anna.
  insert into mhd.protokoll (markt_id, artikel_id, mitarbeiter_id, zeitpunkt, art, mhd_alt, mhd_neu)
  select v_markt, a.id, v_anna, (a.letzte_aktion_am + time '10:00') at time zone 'Europe/Berlin',
         case when a.bestand then 'geprueft' else 'ohne_bestand' end, a.mhd, a.mhd
    from mhd.artikel a
   where a.markt_id = v_markt;
end;
$$;

-- Nur der Datenbank-Eigentümer (SQL-Editor, Zeitplan) darf zurücksetzen, nie ein Browser-Konto.
revoke all on function mhd.demo_einrichten(text, text) from public, anon, authenticated;

commit;
