// Spesa di Lume: il server calcola il costo e cosa si riceve; il gioco manda solo cosa vuole comprare.
import { PREMIUM, rushLume, type Grant, type RushKind } from '../src/config/premium';
import { body, db, json, userFrom } from './_lib';

const RUSH: RushKind[] = ['construction', 'research', 'expedition'];

export async function POST(req: Request) {
  const user = await userFrom(req);
  if (!user) return json({ error: 'login' }, 401);
  const b = await body(req);
  const item = b?.item;
  let cost: number, grant: Grant, own: string | null = null;
  if (item === 'rush' && RUSH.includes(b?.what as RushKind)) {
    const minutes = Number(b?.minutes);
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > PREMIUM.rushMaxMinutes) return json({ error: 'minutes' }, 400);
    cost = rushLume(minutes);
    grant = { kind: 'rush', what: b!.what as RushKind };
  } else if (item === 'resources') {
    // una volta al giorno (giorno UTC): il pacchetto non deve saltare la progressione
    const day = new Date();
    day.setUTCHours(0, 0, 0, 0);
    const { count, error: e } = await db().from('grants').select('id', { count: 'exact', head: true })
      .eq('user_id', user.id).eq('item', 'resources').gte('created_at', day.toISOString());
    if (e) return json({ error: 'db' }, 500);
    if ((count ?? 0) >= PREMIUM.resources.perDay) return json({ error: 'daily' }, 429);
    cost = PREMIUM.resources.cost;
    grant = { kind: 'resources', amount: PREMIUM.resources.amount };
  } else if (item === 'cosmetic' && typeof b?.id === 'string' && Object.hasOwn(PREMIUM.cosmetics, b.id)) {
    cost = PREMIUM.cosmetics[b.id];
    grant = { kind: 'cosmetic', item: b.id };
    own = b.id;
  } else {
    return json({ error: 'item' }, 400);
  }
  const { data, error } = await db().rpc('spend_lume', { p_user: user.id, p_item: grant.kind, p_cost: cost, p_payload: grant, p_own: own });
  if (error) {
    const msg = error.message ?? '';
    if (msg.includes('insufficient_lume')) return json({ error: 'lume' }, 402);
    if (msg.includes('duplicate key')) return json({ error: 'owned' }, 409);
    return json({ error: 'db' }, 500);
  }
  const row = (data as { grant_id: string; lume: number }[])[0];
  return json({ grant: { id: row.grant_id, ...grant }, lume: row.lume });
}
