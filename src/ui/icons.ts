// Icone dell'interfaccia (Nico: "trovare delle icone migliori"): set Lucide (licenza ISC), tutte allo stesso tratto, in bianco.
// Caricate come texture: si tingono col colore che serve (setTint).
import type Phaser from 'phaser';
import users from 'lucide-static/icons/users.svg?raw';
import map from 'lucide-static/icons/map.svg?raw';
import hammer from 'lucide-static/icons/hammer.svg?raw';
import truck from 'lucide-static/icons/truck.svg?raw';
import shield from 'lucide-static/icons/shield.svg?raw';
import clock from 'lucide-static/icons/clock.svg?raw';
import flag from 'lucide-static/icons/flag.svg?raw';
import medal from 'lucide-static/icons/medal.svg?raw';
import volume from 'lucide-static/icons/volume-2.svg?raw';
import volumeX from 'lucide-static/icons/volume-x.svg?raw';

// reparti (Nico: "solo le icone, icone decenti"): set Tabler (licenza MIT), stesso tratto delle altre
import helmet from '@tabler/icons/outline/helmet.svg?raw';
import binoculars from '@tabler/icons/outline/binoculars.svg?raw';
import target from '@tabler/icons/outline/target.svg?raw';
import tank from '@tabler/icons/outline/tank.svg?raw';
import shovel from '@tabler/icons/outline/shovel.svg?raw';
import ship from '@tabler/icons/outline/ship.svg?raw';
import shieldStar from '@tabler/icons/outline/shield-star.svg?raw';
import sword from '@tabler/icons/outline/sword.svg?raw';
import robot from '@tabler/icons/outline/robot.svg?raw';
import spy from '@tabler/icons/outline/spy.svg?raw';
import bomb from '@tabler/icons/outline/bomb.svg?raw';

const RAW: Record<string, string> = {
  'ico-u-fanteria': helmet, 'ico-u-ricognitori': binoculars, 'ico-u-artiglieria': target, 'ico-u-corazzati': tank,
  'ico-u-genio': shovel, 'ico-u-cannoniera': ship, 'ico-u-guardia': shieldStar, 'ico-u-legionari': sword,
  'ico-u-prototipo': robot, 'ico-u-infiltrati': spy, 'ico-a-bombardamento': bomb,
  'ico-truppe': users, 'ico-mappa': map, 'ico-costruisci': hammer, 'ico-logistica': truck, 'ico-difesa': shield,
  'ico-tempo': clock, 'ico-territorio': flag, 'ico-medaglia': medal, 'ico-audio': volume, 'ico-muto': volumeX,
};

/** Da chiamare nel preload della prima scena. */
export function preloadIcons(scene: Phaser.Scene) {
  for (const [k, svg] of Object.entries(RAW)) {
    if (scene.textures.exists(k)) continue;
    const white = svg.replace(/<!--.*?-->/s, '').replace(/currentColor/g, '#ffffff');
    scene.load.svg(k, `data:image/svg+xml;base64,${btoa(white)}`, { width: 48, height: 48 });
  }
}
