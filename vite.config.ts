import { existsSync } from 'node:fs';
import { defineConfig, loadEnv, type Plugin } from 'vite';

/** Solo in sviluppo: serve le funzioni di api/ come farebbe Vercel (chiavi da .env.local, mai nel pacchetto del gioco). */
function devApi(): Plugin {
  return {
    name: 'dev-api',
    apply: 'serve',
    configureServer(server) {
      Object.assign(process.env, loadEnv(server.config.mode, server.config.root, ''));
      server.middlewares.use(async (req, res, next) => {
        const m = req.url?.match(/^\/api\/([a-z-]+)(?:\?|$)/);
        if (!m) return next();
        if (!existsSync(`${server.config.root}/api/${m[1]}.ts`)) { res.statusCode = 404; return res.end(); }
        try {
          const mod = await server.ssrLoadModule(`/api/${m[1]}.ts`);
          const handler = mod[req.method ?? 'GET'];
          if (typeof handler !== 'function') { res.statusCode = 405; return res.end(); }
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c as Buffer);
          const headers = new Headers();
          for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
          const r: Response = await handler(new Request(`http://localhost${req.url}`, {
            method: req.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined,
          }));
          res.statusCode = r.status;
          r.headers.forEach((v, k) => res.setHeader(k, v));
          res.end(Buffer.from(await r.arrayBuffer()));
        } catch (e) {
          console.error('[api]', e);
          res.statusCode = 500;
          res.end('{"error":"server"}');
        }
      });
    },
  };
}

export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 2000 },
  plugins: [devApi()],
});
