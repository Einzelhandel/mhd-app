// Gemeinsame Testumgebung für die Tests der Liste „Heute“ und der Aktionen.
import assert from 'node:assert/strict';
import { neueDatenbank, json, heuteSetzen, markt, pin } from './helfer.mjs';

// Markt mit Leitung und einem gewöhnlichen Mitarbeiter; liefert Helfer für Tests.
export async function umgebung({ name = 'Markt A', email = 'a@example.com', db = null } = {}) {
  db ??= await neueDatenbank();
  await heuteSetzen(db, '2026-11-10');
  const m = await markt(db, { name, email, leitung: 'Chef', pin: '4711' });
  await db.query("insert into mhd.mitarbeiter (markt_id, name, rolle, pin_hash) values ($1, 'Berta', 'mitarbeiter', mhd.pin_hash('1234'))", [m.marktId]);
  const b = await db.query("select id from mhd.mitarbeiter where markt_id = $1 and name = 'Berta'", [m.marktId]);
  const sitzung = await pin(db, m.userId, Number(b.rows[0].id), '1234');
  const chef = await pin(db, m.userId, m.leitungId, '4711');
  const gruppen = await json(db, m.userId, 'select public.mhd_warengruppen($1) as r', [sitzung]);
  const gruppe = (n) => gruppen.find((g) => g.name === n).id;
  let zaehler = 0;
  const u = {
    db, m, sitzung, chef,
    tag: (d) => heuteSetzen(db, d),
    neu: async (name, { gruppeName = 'Molkerei', platz = '' } = {}) => {
      zaehler += 1;
      const ean = `40123456${String(zaehler).padStart(5, '0')}`;
      const a = await json(db, m.userId, 'select public.mhd_artikel_speichern($1, null, $2::jsonb) as r',
        [sitzung, JSON.stringify({ ean, name, platz, warengruppe_id: gruppe(gruppeName), quelle: 'hand' })]);
      return a.id;
    },
    aktion: (id, art, mhd = null, s = sitzung) =>
      json(db, m.userId, 'select public.mhd_aktion($1, $2, $3, $4::date) as r', [s, id, art, mhd]),
    liste: (s = sitzung) => json(db, m.userId, 'select public.mhd_liste($1) as r', [s]),
    zeile: async (id) => (await db.query('select * from mhd.artikel where id = $1', [id])).rows[0],
  };
  // Liefert [Schlüssel des Abschnitts in mhd_liste, versaeumt]; der Artikel steht in höchstens einem Abschnitt.
  u.wo = async (id) => {
    const l = await u.liste();
    const treffer = Object.entries(l.abschnitte).filter(([, arr]) => arr.some((x) => x.id === id));
    assert.ok(treffer.length <= 1, `Artikel ${id} steht in mehreren Abschnitten: ${treffer.map(([k]) => k)}`);
    if (treffer.length === 0) return [null, null];
    return [treffer[0][0], treffer[0][1].find((x) => x.id === id).versaeumt];
  };
  return u;
}
