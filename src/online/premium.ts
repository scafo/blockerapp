// Lume dal lato del gioco: accesso con email (codice di 6 cifre), saldo, acquisto dei pacchetti con Stripe, spese.
// Il gioco non decide mai quanto Lume ha né cosa riceve: chiede ad api/ e applica solo le consegne che il server gli dà.
// Spento se mancano le chiavi pubbliche di Supabase o se gira nell'app (Google Play vuole il suo sistema di pagamento).
import { Capacitor } from '@capacitor/core';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Grant, PackId, RushKind } from '../config/premium';
import { RESOURCES } from '../game/resources';
import type { Profile } from '../save/storage';

const URL_ = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Acquisti disponibili: solo sul web e con Supabase configurato. */
export const premiumOn = !!URL_ && !!KEY && !Capacitor.isNativePlatform();

let sb: SupabaseClient | null = null;
const client = () => (sb ??= createClient(URL_!, KEY!));

export interface Wallet {
  lume: number;
  grants: (Grant & { id: string })[];
  owned: string[];
}

/** Email dell'accesso in corso, o null. */
export async function signedEmail(): Promise<string | null> {
  if (!premiumOn) return null;
  const { data } = await client().auth.getSession();
  return data.session?.user.email ?? null;
}

/** Manda il codice di accesso all'email (crea l'account se non c'è). */
export async function sendCode(email: string): Promise<boolean> {
  const { error } = await client().auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  return !error;
}

export async function verifyCode(email: string, code: string): Promise<boolean> {
  const { error } = await client().auth.verifyOtp({ email, token: code, type: 'email' });
  return !error;
}

export async function signOut() {
  await client().auth.signOut();
}

async function call<T>(path: string, init: { method: 'GET' | 'POST'; body?: unknown }): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const { data } = await client().auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { ok: false, error: 'login' };
  try {
    const r = await fetch(`/api/${path}`, {
      method: init.method,
      headers: { authorization: `Bearer ${token}`, ...(init.body ? { 'content-type': 'application/json' } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    return r.ok ? { ok: true, data: j as T } : { ok: false, error: (j as { error?: string }).error ?? 'rete' };
  } catch {
    return { ok: false, error: 'rete' };
  }
}

export const fetchWallet = () => call<Wallet>('wallet', { method: 'GET' });

/** Apre la pagina di pagamento di Stripe (si torna al gioco con ?lume=ok o ?lume=annullato). */
export async function buyPack(pack: PackId): Promise<string | null> {
  const r = await call<{ url: string }>('checkout', { method: 'POST', body: { pack } });
  if (!r.ok) return r.error;
  location.href = r.data.url;
  return null;
}

export type SpendReq = { item: 'rush'; what: RushKind; minutes: number } | { item: 'resources' } | { item: 'cosmetic'; id: string };
export const spend = (req: SpendReq) => call<{ grant: Grant & { id: string }; lume: number }>('spend', { method: 'POST', body: req });

/** Applica una consegna al profilo (una volta sola per id). Ritorna false se era già applicata. */
export function applyGrant(p: Profile, g: Grant & { id: string }, now: number): boolean {
  const done = p.premiumClaimed ?? [];
  if (done.includes(g.id)) return false;
  if (g.kind === 'rush') {
    const job = g.what === 'expedition' ? p.expedition : p[g.what];
    if (job && job.until > now) job.until = now;
  } else if (g.kind === 'resources') {
    for (const r of RESOURCES) p.stash[r] += g.amount; // comprate: possono superare la capienza del Deposito (Nico)
  } else if (!(p.cosmetics ?? []).includes(g.item)) {
    p.cosmetics = [...(p.cosmetics ?? []), g.item];
  }
  p.premiumClaimed = [...done, g.id].slice(-200);
  return true;
}

/** Dopo aver salvato il profilo con le consegne applicate, le segna come ritirate sul server. */
export const confirmClaimed = (ids: string[]) => (ids.length ? call('wallet', { method: 'POST', body: { claim: ids } }) : Promise.resolve(null));
