// Icone dell'interfaccia generate in locale con Draw Things (sagome bianche su trasparente, prompt in ../concept-art/manifest.py,
// copiate con scripts/import-art.py). Caricate come texture `ic-<nome>` (es. `ic-res-benzina`): si tingono col colore che serve.
import type Phaser from 'phaser';

const FILES = Object.fromEntries(Object.entries(import.meta.glob<string>('../assets/icons/*.png', { eager: true, import: 'default' }))
  .map(([path, url]) => [path.split('/').pop()!.replace('.png', ''), url]));

/** Nomi vecchi (set Lucide/Tabler) → icona nuova, così i bottoni che li usano cambiano da soli. */
const ALIAS: Record<string, string> = {
  'ico-truppe': 'u-fanteria', 'ico-mappa': 'ui-mappa', 'ico-costruisci': 'ui-costruisci', 'ico-logistica': 'ui-rifornimento',
  'ico-difesa': 'ui-difesa', 'ico-tempo': 'ui-tempo', 'ico-territorio': 'ui-province', 'ico-medaglia': 'ui-medaglia',
  'ico-audio': 'ui-audio', 'ico-muto': 'ui-muto', 'ico-a-bombardamento': 'a-bombardamento',
  'ico-u-fanteria': 'u-fanteria', 'ico-u-ricognitori': 'u-ricognitori', 'ico-u-artiglieria': 'u-artiglieria', 'ico-u-corazzati': 'u-corazzati',
  'ico-u-genio': 'u-genio', 'ico-u-cannoniera': 'u-cannoniera', 'ico-u-guardia': 'u-guardia', 'ico-u-legionari': 'u-legionari',
  'ico-u-prototipo': 'u-prototipo', 'ico-u-infiltrati': 'u-infiltrati',
};

/** Da chiamare nel preload della prima scena. */
export function preloadIcons(scene: Phaser.Scene) {
  for (const [name, url] of Object.entries(FILES)) if (!scene.textures.exists(`ic-${name}`)) scene.load.image(`ic-${name}`, url);
  for (const [old, name] of Object.entries(ALIAS)) if (FILES[name] && !scene.textures.exists(old)) scene.load.image(old, FILES[name]);
}

/** C'è un'icona con questo nome? */
export const hasIcon = (name: string) => name in FILES;
