# Copies the art generated locally with Draw Things (FLUX.2 klein 4B, Apache 2.0; prompts in ../concept-art/manifest.py) into the game.
# Icons: white glyphs on black become white-on-transparent PNGs (alpha = brightness), cropped and centered in 128x128, tintable in Phaser.
# Pictures: JPEG at the size they are shown, in src/assets/img/<folder>.
from pathlib import Path
from PIL import Image, ImageOps

root = Path(__file__).resolve().parent.parent
art = root.parent / 'concept-art'
img = root / 'src/assets/img'

icons = root / 'src/assets/icons'
icons.mkdir(parents=True, exist_ok=True)
for src in sorted((art / 'icons').glob('*.png')):
    g = ImageOps.grayscale(Image.open(src))
    a = g.point(lambda v: 0 if v < 40 else min(255, int((v - 40) * 255 / 170)))  # black background → transparent, soft edges kept
    box = a.getbbox()
    if box:
        a = a.crop(box)
    side = max(a.size)
    sq = Image.new('L', (side, side), 0)
    sq.paste(a, ((side - a.width) // 2, (side - a.height) // 2))
    sq = sq.resize((112, 112), Image.LANCZOS)
    out = Image.new('LA', (128, 128), (255, 0))
    out.paste(Image.merge('LA', (Image.new('L', (112, 112), 255), sq)), (8, 8))
    out.save(icons / src.name, optimize=True)
print('icons', len(list((art / 'icons').glob('*.png'))))

for folder, dest, size, q in [('rooms', 'rooms', (1408, 768), 80), ('portraits', 'people', (480, 640), 82), ('units', 'units', (576, 384), 80),
                             ('events', 'events', (672, 384), 80), ('tech', 'tech', (256, 256), 82),
                             ('fronts', 'fronts', (1056, 576), 80), ('civs', 'civs', (1408, 768), 82)]:
    (img / dest).mkdir(parents=True, exist_ok=True)
    n = 0
    for src in sorted((art / folder).glob('*.png')):
        name = ('room-' + src.stem) if folder == 'rooms' else src.stem
        Image.open(src).convert('RGB').resize(size, Image.LANCZOS).save(img / dest / (name + '.jpg'), quality=q, optimize=True, progressive=True)
        n += 1
    print(dest, n)

# title screen background
Image.open(art / 'title/title.png').convert('RGB').save(img / 'title-bg.jpg', quality=82, optimize=True, progressive=True)
print('title-bg')
