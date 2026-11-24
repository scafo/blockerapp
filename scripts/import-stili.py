# Copies the chosen pictures from ../concept-art/stili (Draw Things, FLUX.2 klein 4B) into the game (Nico, 23 November 2026):
# resource objects cut out of their white background (top bar, market, costs, loot), the darker documentary scenes as front
# pictures, page backgrounds and loading screens, and the window portrait as the commander.
from collections import deque
from pathlib import Path
from PIL import Image, ImageFilter

root = Path(__file__).resolve().parent.parent
st = root.parent / 'concept-art' / 'stili'
img = root / 'src/assets/img'


def cutout(src: Path, dest: Path, side=160):
    """White studio background (and its soft grey shadow) to transparent: flood fill from the edges over light, unsaturated pixels."""
    im = Image.open(src).convert('RGB')
    w, h = im.size
    px = im.load()

    def bg(p):
        r, g, b = p
        hi, lo = max(p), min(p)
        return lo > 150 and (hi - lo) < 0.14 * hi

    mask = Image.new('L', (w, h), 255)
    m = mask.load()
    q = deque((x, y) for x in range(w) for y in (0, h - 1))
    q.extend((x, y) for y in range(h) for x in (0, w - 1))
    while q:
        x, y = q.popleft()
        if m[x, y] == 0 or not bg(px[x, y]):
            continue
        m[x, y] = 0
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and m[nx, ny]:
                q.append((nx, ny))
    mask = mask.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(1.2))
    im.putalpha(mask)
    im = im.crop(mask.getbbox())
    s = max(im.size)
    sq = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    sq.paste(im, ((s - im.width) // 2, (s - im.height) // 2))
    inner = round(side * 0.92)
    out = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    out.paste(sq.resize((inner, inner), Image.LANCZOS), ((side - inner) // 2, (side - inner) // 2))
    out.save(dest, optimize=True)


for res, name in [('cibo', 'cibo-sacco-a'), ('metallo', 'metallo-ingranaggio-a'), ('benzina', 'benzina-fusto-a')]:
    cutout(st / 'icone2' / f'{name}.png', img / 'res' / f'rp-{res}.png')
print('res 3')


def jpg(src: Path, dest: Path, size, q=80):
    dest.parent.mkdir(parents=True, exist_ok=True)
    im = Image.open(src).convert('RGB')
    s = max(size[0] / im.width, size[1] / im.height)
    im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    l, t = (im.width - size[0]) // 2, (im.height - size[1]) // 2
    im.crop((l, t, l + size[0], t + size[1])).save(dest, quality=q, optimize=True, progressive=True)


F5 = st / 'figma5'
# fronts I-VI: from the open plain to the city at the end of the world
for i, n in enumerate(['pianura-a', 'montagna-b', 'deserto-c', 'fabbrica-a', 'giungla-a', 'citta-c'], 1):
    jpg(F5 / f'{n}.png', img / 'fronts' / f'front-{i}.jpg', (1056, 576))
# page backgrounds and loading screens (generated at 896x512: shown full screen, a bit soft)
for key, n in [('page-mercato', 'tropici-a'), ('page-arsenale', 'fabbrica-a'), ('load-mediterraneo', 'mediterraneo-b'),
               ('load-tornado', 'pianura-a'), ('load-deserto', 'deserto-c'), ('load-citta', 'citta-c')]:
    jpg(F5 / f'{n}.png', img / 'pages' / f'{key}.jpg', (1792, 1024), 82)
# commander: the portrait by the window
jpg(st / 'ravvicinati' / 'g1-ritratto-finestra.png', img / 'people' / 'comandante.jpg', (480, 640), 82)
print('pictures ok')

# unit cards v2 (concept-art/stili/reparti.py): one clear subject per unit, the variant picked by eye
# v3 (ritratti.py, Nico 24 November 2026): one raw soldier portrait per unit looking right, face darkened by ombra.py; every
# Arsenal upgrade shows the same man (same seed and variant) with better gear (t-<tech>)
import sys, tempfile
sys.path.insert(0, str(st))
from ombra import shade
UNIT_PICK = {'fanteria': 'a', 'ricognitori': 'b', 'artiglieria': 'b', 'corazzati': 'a', 'genio': 'b', 'cannoniera': 'a',
             'legionari': 'a', 'guardia': 'b', 'prototipo': 'b', 'infiltrati': 'a'}
UPGRADES = {'fanteria': ['vita', 'danni', 'costo'], 'ricognitori': ['vita', 'danni'], 'artiglieria': ['vita', 'danni'],
            'corazzati': ['vita', 'danni'], 'genio': ['vita', 'danni'], 'cannoniera': ['vita', 'danni']}
with tempfile.TemporaryDirectory() as tmp:
    for unit, v in UNIT_PICK.items():
        for key, dest in [(unit, img / 'units' / f'u-{unit}.jpg')] + [(f'{unit}_{u}', img / 'tech' / f't-{unit}_{u}.jpg') for u in UPGRADES.get(unit, [])]:
            dark = Path(tmp) / f'{key}.png'
            shade(str(st / 'ritratti' / f'{key}-{v}.png'), str(dark))
            jpg(dark, dest, (576, 384) if key == unit else (704, 400))
print('units ok')

# supply bundles (pacchi.py, Nico liked them): cut out of the white studio background, used big in the Market
for res, v in [('cibo', 'a'), ('metallo', 'a'), ('benzina', 'a'), ('misto', 'a')]:
    cutout(st / 'pacchi' / f'{res}-{v}.png', img / 'res' / f'pk-{res}.png', 320)
print('bundles ok')

# research pictures v2 (ricerche.py): scenes instead of dark object piles; cards crop the centre, the detail shows them wide
for tech, v in [('addestramento', 'a'), ('elite', 'a'), ('strade', 'a'), ('rifornimenti', 'b'), ('estrazione', 'a'), ('industria', 'a'),
                ('trincee', 'a'), ('radar', 'a'), ('segnale', 'a'), ('frammenti', 'a'), ('prototipo', 'a'), ('caduta', 'b'), ('assalto', 'b'),
                ('ferrovie', 'b'), ('pianificazione', 'a'), ('fortezze', 'a'), ('munizioni', 'a'), ('corazze', 'a')]:
    jpg(st / 'ricerche' / f'{tech}-{v}.png', img / 'tech' / f't-{tech}.jpg', (704, 400))
print('research ok')

# rooms, powers and events v2 (stanze.py): same documentary look; rooms keep the subject on the left, the page sits on the right
ROOMS = [('room-comando', 'a'), ('room-radar', 'a'), ('room-laboratorio', 'a'), ('room-arsenale', 'b'), ('room-mercato', 'b')]
for key, v in ROOMS:
    jpg(st / 'stanze' / f'{key}-{v}.png', img / 'rooms' / f'{key}.jpg', (1408, 768), 82)
jpg(st / 'stanze' / 'bg-estrazione-b.png', img / 'bg-estrazione.jpg', (1408, 768), 82)
for civ, v in [('republica', 'a'), ('imperium', 'a'), ('aristocrazia', 'a'), ('cabal', 'a')]:
    jpg(st / 'stanze' / f'civ-{civ}-{v}.png', img / 'civs' / f'civ-{civ}.jpg', (1408, 768), 82)
print('rooms and powers ok')
for ev, v in [('mercato', 'b'), ('disertori', 'a'), ('trasmettitore', 'a'), ('convoglio', 'b'), ('razioni', 'a'), ('nebbia', 'a'),
              ('ingegnere', 'b'), ('frequenza', 'b'), ('archivio', 'a'), ('cartografo', 'a')]:
    jpg(st / 'stanze' / f'ev-{ev}-{v}.png', img / 'events' / f'ev-{ev}.jpg', (672, 384))
print('events ok')
