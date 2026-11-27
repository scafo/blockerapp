// Icone a linea (Lucide, licenza ISC, pacchetto lucide-static): per l'interfaccia, dove quelle generate con l'AI non reggono
// (Nico, 23 novembre 2026: "le icone rifatte o prese da qualche parte"). Diventano texture `li-<nome>` bianche, da tingere.
import Phaser from 'phaser';
import hammer from 'lucide-static/icons/hammer.svg?raw';
import flask from 'lucide-static/icons/flask-conical.svg?raw';
import truck from 'lucide-static/icons/truck.svg?raw';
import hourglass from 'lucide-static/icons/hourglass.svg?raw';
import user from 'lucide-static/icons/user-round.svg?raw';
import sparkles from 'lucide-static/icons/sparkles.svg?raw';
import back from 'lucide-static/icons/arrow-left.svg?raw';
import volume from 'lucide-static/icons/volume-2.svg?raw';
import mute from 'lucide-static/icons/volume-x.svg?raw';
import wheat from 'lucide-static/icons/wheat.svg?raw';
import cog from 'lucide-static/icons/cog.svg?raw';
import fuel from 'lucide-static/icons/fuel.svg?raw';
import map from 'lucide-static/icons/map.svg?raw';
import spline from 'lucide-static/icons/spline.svg?raw';
import arrow from 'lucide-static/icons/arrow-big-right.svg?raw';
import crosshair from 'lucide-static/icons/crosshair.svg?raw';
import pointer from 'lucide-static/icons/mouse-pointer-2.svg?raw';
import plus from 'lucide-static/icons/plus.svg?raw';
import pencil from 'lucide-static/icons/pencil.svg?raw';
import close from 'lucide-static/icons/x.svg?raw';
import stop from 'lucide-static/icons/octagon-x.svg?raw';
import radar from 'lucide-static/icons/radar.svg?raw';
import flag from 'lucide-static/icons/flag.svg?raw';
import mountain from 'lucide-static/icons/mountain.svg?raw';
import chart from 'lucide-static/icons/chart-column.svg?raw';
import clock from 'lucide-static/icons/clock.svg?raw';
import settings from 'lucide-static/icons/settings.svg?raw';
import coins from 'lucide-static/icons/coins.svg?raw';
import waypoints from 'lucide-static/icons/waypoints.svg?raw';
import exit from 'lucide-static/icons/log-out.svg?raw';
import list from 'lucide-static/icons/list.svg?raw';

const SVG: Record<string, string> = { hammer, flask, truck, hourglass, user, sparkles, back, volume, mute, wheat, cog, fuel, map, spline, arrow, crosshair, pointer, plus, pencil, close, stop, radar, flag, mountain, chart, clock, settings, coins, waypoints, exit, list };
export type LineIcon = keyof typeof SVG;

const dataUrl = (src: string, size: number) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(src.replace('currentColor', '#ffffff').replace('width="24"', `width="${size}"`).replace('height="24"', `height="${size}"`))}`;

/** Nel preload della prima scena: tutte le icone a linea, nitide fino a 96 pixel veri. */
export function preloadLineIcons(scene: Phaser.Scene) {
  for (const [k, src] of Object.entries(SVG)) if (!scene.textures.exists(`li-${k}`)) scene.load.image(`li-${k}`, dataUrl(src, 96));
}

/** Carica le icone che mancano (lato `size` pixel veri); risolve quando sono pronte. */
export function loadLineIcons(scene: Phaser.Scene, size: number): Promise<void> {
  const todo = Object.entries(SVG).filter(([k]) => !scene.textures.exists(`li-${k}`));
  return Promise.all(todo.map(([k, src]) => new Promise<void>((done) => {
    const img = new Image(size, size);
    img.onload = () => { if (!scene.textures.exists(`li-${k}`)) scene.textures.addImage(`li-${k}`, img); done(); };
    img.onerror = () => done();
    img.src = dataUrl(src, size);
  }))).then(() => undefined);
}

/** Icona a linea centrata in (x, y), lato `size` punti. */
export function lineIcon(scene: Phaser.Scene, name: LineIcon, x: number, y: number, size: number, color = 0xffffff) {
  return scene.add.image(x, y, `li-${name}`).setDisplaySize(size, size).setTint(color);
}
