// Saldo del Lume, consegne non ancora ritirate e oggetti posseduti. POST con { claim: [id] } segna le consegne come ritirate.
import { body, db, json, userFrom } from './_lib';

export async function GET(req: Request) {
  const user = await userFrom(req);
  if (!user) return json({ error: 'login' }, 401);
  const [w, g, o] = await Promise.all([
    db().from('wallets').select('lume').eq('user_id', user.id).maybeSingle(),
    db().from('grants').select('id, payload').eq('user_id', user.id).eq('claimed', false).order('created_at'),
    db().from('owned').select('item').eq('user_id', user.id),
  ]);
  if (w.error || g.error || o.error) return json({ error: 'db' }, 500);
  return json({
    lume: w.data?.lume ?? 0,
    grants: (g.data ?? []).map((r) => ({ id: r.id, ...(r.payload as object) })),
    owned: (o.data ?? []).map((r) => r.item),
  });
}

export async function POST(req: Request) {
  const user = await userFrom(req);
  if (!user) return json({ error: 'login' }, 401);
  const ids = (await body(req))?.claim;
  if (!Array.isArray(ids) || !ids.every((i) => typeof i === 'string') || ids.length > 50) return json({ error: 'claim' }, 400);
  const { error } = await db().from('grants').update({ claimed: true }).eq('user_id', user.id).in('id', ids);
  return error ? json({ error: 'db' }, 500) : json({ ok: true });
}
