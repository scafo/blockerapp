# Copies the base art generated locally with Draw Things (FLUX.2 klein 4B, Apache 2.0) into the game as JPEG:
# room photos and the mountain backdrop from ../concept-base, the Extraction helicopter from ../concept-estrazione.
# Prompts and seeds: ../concept-base/prefix.txt, rooms.tsv, gen.sh.
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parent.parent
out = root / 'src/assets/img/rooms'
out.mkdir(parents=True, exist_ok=True)
for src in sorted((root.parent / 'concept-base').glob('room-*.png')):
    Image.open(src).convert('RGB').save(out / (src.stem + '.jpg'), quality=80, optimize=True, progressive=True)
    print(src.stem)
ext = root.parent / 'concept-base/base-esterno.png'
if ext.exists():
    Image.open(ext).convert('RGB').save(out / 'base-esterno.jpg', quality=80, optimize=True, progressive=True)
    print('base-esterno')
heli = root.parent / 'concept-estrazione/estrazione-01.png'
Image.open(heli).convert('RGB').save(root / 'src/assets/img/bg-estrazione.jpg', quality=82, optimize=True, progressive=True)
print('bg-estrazione')
