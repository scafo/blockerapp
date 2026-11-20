// Pezzi comuni delle funzioni Vercel (i file con _ davanti non diventano indirizzi).
// Chiavi segrete solo da variabili d'ambiente (Vercel → Settings → Environment Variables), mai nel codice.
import Stripe from 'stripe';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`missing env ${k}`);
  return v;
};

let admin: SupabaseClient | null = null;
/** Client col service role: scavalca le regole di riga, quindi si usa solo qui sul server. */
export const db = () => (admin ??= createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } }));

let stripeClient: Stripe | null = null;
export const stripe = () => (stripeClient ??= new Stripe(env('STRIPE_SECRET_KEY')));

export const siteUrl = () => env('SITE_URL').replace(/\/$/, '');

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

/** Utente dal token di Supabase nell'intestazione Authorization (verificato da Supabase, non decodificato a mano). */
export async function userFrom(req: Request): Promise<User | null> {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data, error } = await db().auth.getUser(token);
  return error ? null : data.user;
}

/** Corpo JSON della richiesta, o null se non è un oggetto. */
export async function body(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const b = await req.json();
    return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
