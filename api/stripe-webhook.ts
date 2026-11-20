// Stripe chiama qui quando un pagamento è concluso. Unico punto che accredita Lume: firma verificata, importo controllato
// contro il catalogo, accredito una volta sola per sessione (credit_lume in supabase/schema.sql).
import type Stripe from 'stripe';
import { LUME_PACKS, PREMIUM, type PackId } from '../src/config/premium';
import { db, json, stripe } from './_lib';

export async function POST(req: Request) {
  const sig = req.headers.get('stripe-signature');
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!sig || !secret) return json({ error: 'signature' }, 400);
  let event: Stripe.Event;
  try {
    event = await stripe().webhooks.constructEventAsync(await req.text(), sig, secret);
  } catch {
    return json({ error: 'signature' }, 400);
  }
  if (event.type !== 'checkout.session.completed' && event.type !== 'checkout.session.async_payment_succeeded') return json({ ok: true });
  const s = event.data.object as Stripe.Checkout.Session;
  if (s.payment_status !== 'paid') return json({ ok: true }); // pagamenti differiti: arriva async_payment_succeeded
  const user = s.metadata?.user_id, pack = s.metadata?.pack;
  if (!user || !pack || !Object.hasOwn(LUME_PACKS, pack)) return json({ error: 'metadata' }, 400);
  const P = LUME_PACKS[pack as PackId];
  if (s.amount_total !== P.cents || s.currency !== PREMIUM.currency) return json({ error: 'amount' }, 400);
  const { error } = await db().rpc('credit_lume', {
    p_session: s.id, p_user: user, p_pack: pack, p_lume: P.lume, p_amount: s.amount_total, p_currency: s.currency,
  });
  // errore del database = 500: Stripe riprova da solo più tardi
  if (error) return json({ error: 'db' }, 500);
  return json({ ok: true });
}
