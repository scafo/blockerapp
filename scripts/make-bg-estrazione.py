# Bakes the Extraction Squads backdrop: an original image in the mood of Nico's Figma frame (night, a helicopter seen through
# cold haze, two blurred rotor discs burning white-blue, dark ridge below). Output: src/assets/img/bg-estrazione.jpg
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter as blur

W, H = 1728, 1117
rng = np.random.default_rng(7)
Y, X = np.mgrid[0:H, 0:W].astype(np.float32)


def ring(cx, cy, rx, ry, width, tilt=0.0):
    """Elliptical ring, 1 on the rim."""
    c, s = np.cos(tilt), np.sin(tilt)
    u, v = (X - cx) * c + (Y - cy) * s, -(X - cx) * s + (Y - cy) * c
    d = np.sqrt((u / rx) ** 2 + (v / ry) ** 2)
    return np.exp(-(((d - 1) / width) ** 2))


def disc(cx, cy, rx, ry, tilt=0.0):
    c, s = np.cos(tilt), np.sin(tilt)
    u, v = (X - cx) * c + (Y - cy) * s, -(X - cx) * s + (Y - cy) * c
    return np.exp(-((u / rx) ** 2 + (v / ry) ** 2))


def fbm(sx, sy, seed):
    """Soft cloud noise, 0..1."""
    r = np.random.default_rng(seed)
    out = sum(blur(r.random((H, W)).astype(np.float32), (sy / 2**k, sx / 2**k)) * 4**k for k in range(3))
    return (out - out.min()) / (out.max() - out.min())


def rotor(cx, cy, rx, ry, width, seed, tilt):
    """Blade tips caught in the light: a ragged rim, thick on one side, thin and broken on the other."""
    c, s = np.cos(tilt), np.sin(tilt)
    u, v = (X - cx) * c + (Y - cy) * s, -(X - cx) * s + (Y - cy) * c
    d, th = np.sqrt((u / rx) ** 2 + (v / ry) ** 2), np.arctan2(v / ry, u / rx)
    r = np.random.default_rng(seed)
    tab = blur(r.random(1440).astype(np.float32), 34, mode='wrap')
    tab = (tab - tab.min()) / (tab.max() - tab.min())
    fine = blur(r.random(1440).astype(np.float32), 9, mode='wrap')
    fine = (fine - fine.min()) / (fine.max() - fine.min())
    i = ((th + np.pi) / (2 * np.pi) * 1439).astype(np.int32)
    w = width * (0.35 + 1.3 * tab[i]) * (0.72 + 0.56 * np.cos(th - 2.6))
    # outer edge frayed by the fine streaks, inner edge soft
    o = (d - 1 + 0.05 * fine[i]) / w
    return np.exp(-np.abs(o) ** 1.5) * (0.45 + 0.75 * tab[::-1][i]) * (0.72 + 0.28 * fine[i])


mist = fbm(260, 150, 3)
rim = 1.55 * rotor(440, 510, 385, 92, 0.15, 11, -0.03) + 1.5 * rotor(950, 650, 310, 58, 0.22, 14, -0.05)
rim = blur(rim, 9)
# light: cold haze behind everything, hot glow around the discs, long smear towards the right
light = (0.2 + 0.5 * mist) * disc(620, 520, 800, 500) + 0.42 * mist * disc(1050, 560, 330, 300)
light += rim + 0.75 * blur(rim, 26) + 0.55 * blur(rim, 90)
# rays rising from the mast
ang = np.arctan2(Y - 500, X - 450)
rays = blur(rng.random(720).astype(np.float32), 7, mode='wrap')
rays = (rays - rays.min()) / (rays.max() - rays.min())
up = np.clip((500 - Y) / 500, 0, 1) ** 0.7
dist = np.sqrt((X - 450) ** 2 + (Y - 500) ** 2)
light += 0.3 * rays[((ang + np.pi) / (2 * np.pi) * 719).astype(np.int32)] ** 2 * up * np.exp(-dist / 560)

# helicopter hull and ridge: dark, barely lit along the top edge
hull = np.clip(disc(600, 790, 330, 95) + disc(980, 815, 240, 42) + 0.9 * disc(450, 640, 34, 130) + disc(330, 830, 110, 80), 0, 1)
ridge = 930 + 34 * np.sin(X / 190) + 16 * np.sin(X / 51 + 1.3) - (X - 400) * 0.03
land = np.clip((Y - ridge) / 60, 0, 1) * np.clip(1.3 - X / 1450, 0, 1)
mask = np.clip(blur(hull, 26) * 1.5 + blur(land, 30), 0, 1)
light = blur(light * (1 - 0.9 * mask), 5)
# right side and edges sink into night, as in the frame
fall = np.clip((1400 - X) / 760, 0, 1) ** 1.2
light *= 0.08 + 0.92 * fall
light *= np.clip(1.25 - ((X - 650) / 1300) ** 2 - ((Y - 500) / 760) ** 2, 0.04, 1)

v = np.clip(light, 0, 1.6)[..., None]
night = np.array([8, 13, 21], np.float32)
blue = np.array([34, 96, 150], np.float32)
ice = np.array([225, 242, 250], np.float32)
img = night + blue * np.clip(v * 1.8, 0, 1) + (ice - blue) * np.clip((v - 0.52) * 1.5, 0, 1) ** 1.2

# teal lamp on the mast
teal = blur(0.7 * disc(450, 540, 24, 30) + 0.9 * disc(445, 620, 13, 15), 6)
img += teal[..., None] * np.array([10, 150, 130], np.float32)

img += rng.normal(0, 1.6, (H, W, 1))  # grain, so the gradients do not band
Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).save('src/assets/img/bg-estrazione.jpg', quality=84, optimize=True)
