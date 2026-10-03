// Build in un'unica pagina HTML con il gioco inline (niente file JS separati).
// Serve per gli artifact (la CSP blocca gli script non inline) e per hosting "carica un file e via".
// Uso: npm run build:single  →  dist-single/index.html (pagina completa) + dist-single/artifact.html (frammento)
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';

const res = await build({
  entryPoints: ['src/main.ts'], bundle: true, format: 'iife', minify: true, write: false, target: 'es2019',
  define: { 'process.env.NODE_ENV': '"production"' },
});
const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');

const page = `<title>Ashen Atlas</title>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
<style>
  :root { --bg: #07090C; --fg: #C9D6DF; --accent: #4FE3C1; color-scheme: dark; }
  html, body { height: 100%; margin: 0; background: var(--bg); overflow: hidden; touch-action: none; }
  #game { position: relative; width: 100%; height: 100%; }
  #msg { position: absolute; inset: 0; display: grid; place-content: center; text-align: center; gap: 8px; padding: 24px;
    color: var(--fg); font: bold 16px "Courier New", Courier, monospace; }
  #msg b { color: var(--accent); font-size: 28px; }
  #rotate { display: none; position: fixed; inset: 0; z-index: 10; background: #07090C; color: #C9D6DF; place-content: center;
    text-align: center; gap: 10px; font: bold 15px "Courier New", Courier, monospace; }
  #rotate b { color: #4FE3C1; font-size: 34px; }
  #rotate button { margin-top: 14px; background: none; color: #4FE3C1; border: 1px solid #4FE3C1; padding: 10px 18px; font: bold 13px "Courier New", Courier, monospace; }
  @media (orientation: portrait) and (pointer: coarse) { #rotate:not(.off) { display: grid; } }
</style>
<div id="rotate"><b>⟳</b>RUOTA IL TELEFONO<br>gioco pensato in orizzontale<button onclick="this.parentNode.classList.add('off')">GIOCA COMUNQUE</button></div>
<div id="game"><div id="msg"><b>ASHEN ATLAS</b>caricamento…</div></div>
<script>
  window.addEventListener('error', function (e) {
    var m = document.getElementById('msg') || document.body.appendChild(Object.assign(document.createElement('div'), { id: 'msg' }));
    m.style.display = 'grid';
    m.textContent = 'Errore: ' + (e.message || e);
  });
</script>
<script>${js}</script>
`;

mkdirSync('dist-single', { recursive: true });
writeFileSync('dist-single/artifact.html', page);
writeFileSync('dist-single/index.html', `<!doctype html>
<html lang="it"><head><meta charset="UTF-8" />
<meta name="theme-color" content="#07090C" />
</head><body>
${page}</body></html>
`);
console.log(`dist-single pronto (${(page.length / 1024 / 1024).toFixed(2)} MB)`);
