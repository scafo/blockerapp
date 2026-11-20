// Apre una pagina di pagamento Stripe per un pacchetto di Lume. Prezzo e quantità li decide il server (LUME_PACKS).
import { LUME_PACKS, PREMIUM, type PackId } from '../src/config/premium';
import { body, json, siteUrl, stripe, userFrom } from './_lib';

export async function POST(req: Request) {
  const user = await userFrom(req);
  if (!user) return json({ error: 'login' }, 401);
  const pack = (await body(req))?.pack;
  if (typeof pack !== 'string' || !Object.hasOwn(LUME_PACKS, pack)) return json({ error: 'pack' }, 400);
  const P = LUME_PACKS[pack as PackId];
  const session = await stripe().checkout.sessions.create({
    mode: 'payment',
    line_items: [{
      quantity: 1,
      price_data: { currency: PREMIUM.currency, unit_amount: P.cents, product_data: { name: `${P.lume} Lume` } },
    }],
    client_reference_id: user.id,
    customer_email: user.email,
    metadata: { user_id: user.id, pack },
    payment_intent_data: { metadata: { user_id: user.id, pack } },
    custom_text: {
      submit: { message: 'Il Lume arriva subito nel gioco: confermando chiedi la consegna immediata e rinunci al recesso di 14 giorni.' },
    },
    success_url: `${siteUrl()}/?lume=ok`,
    cancel_url: `${siteUrl()}/?lume=annullato`,
  });
  return json({ url: session.url });
}
