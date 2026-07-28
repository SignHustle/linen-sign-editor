"""Build recolourable flat-lay mockup assets from Kate's PSD.

Outputs to <editor>/public/demo/mockup/:
  openenv-<slug>.jpg   blank open envelope, recoloured        (20)
  envfront-<slug>.jpg  envelope front, recoloured             (20)
  envback-<slug>.jpg   envelope back, recoloured              (20)
  card-a5.jpg / card-a6l.jpg / card-a6p.jpg  cream card textures
  linermask.png        alpha mask of the liner diamond within the openenv crop
  geometry.json        paper rects (fractions of each crop) for design overlays
"""
import json, os, re
import numpy as np
from PIL import Image
from psd_tools import PSDImage

SCRATCH = os.path.dirname(os.path.abspath(__file__))
OUT = "/Users/katepalmer/linen-sign-editor/public/demo/mockup"
os.makedirs(OUT, exist_ok=True)

COLOURS = {  # name -> cmyk, matching the demo's ENVELOPE_COLOURS
 "Harvest":[34,67,95,29], "Merlot":[47,66,46,23], "Black":[60,40,40,100],
 "Marsala":[55,90,90,0], "Emerald":[73,47,48,28], "Rouge":[31,87,74,0],
 "Burnt Orange":[0,66,80,10], "Matcha":[19,10,30,7], "Pumpkin":[0,55,84,0],
 "Kiwi":[24,24,81,0], "Midnight Blue":[92,70,35,25], "Buttermilk":[2,14,31,3],
 "Indigo":[88,66,7,7], "Blush":[0,17,15,0], "Rosa":[0,23,10,0],
 "Duck Egg Blue":[20,0,4,15], "Light Sky":[15,0,1,2], "Fuschia":[7,80,1,0],
 "Almond":[3,5,8,2], "Mauve":[28,38,5,1],
}
def cmyk_rgb(c,m,y,k):
    return np.array([255*(1-c/100)*(1-k/100), 255*(1-m/100)*(1-k/100), 255*(1-y/100)*(1-k/100)])
slug = lambda n: re.sub(r'[^a-z0-9]+','-', n.lower()).strip('-')

_rgba = Image.open(f"{SCRATCH}/psd_full.png").convert("RGBA")
_white = Image.new("RGBA", _rgba.size, (255,255,255,255))
full = np.asarray(Image.alpha_composite(_white, _rgba).convert("RGB")).astype(np.float32)

from scipy import ndimage
def sat_mask(arr, largest=False):
    mx = arr.max(2); mn = arr.min(2)
    sat = (mx - mn) / np.maximum(mx, 1)
    blue = arr[:,:,2] >= arr[:,:,0]          # envelope is blue-ish, excludes cream cards
    m = np.clip((sat - 0.02) / 0.05, 0, 1) * blue
    if largest:
        lab, n = ndimage.label(m > 0.5)
        if n > 1:
            sizes = ndimage.sum(m > 0.5, lab, range(1, n+1))
            keep = 1 + int(np.argmax(sizes))
            comp = ndimage.binary_dilation(lab == keep, iterations=12)
            m = m * comp
    return m.astype(np.float32)

def tight_bbox(mask, thresh=0.5):
    ys, xs = np.where(mask > thresh)
    return xs.min(), ys.min(), xs.max(), ys.max()

def recolour(arr, mask, target):
    lum = arr @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    ys, xs = np.where(mask > 0.6)
    paper = np.median(lum[ys, xs])
    detail = np.clip(lum - paper, -80, 80)[..., None]     # additive shading detail, clamped
    flat = np.clip(target[None, None, :] + detail * 0.9, 0, 255)
    m = mask[..., None]
    return arr * (1 - m) + flat * m

def save(arr, path, w, q=88):
    im = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
    im.save(path, quality=q)

geometry = {}

# ── Envelope front & back: crop tight around the envelope + margin ──────────
for key, region in {"envfront": (0, 3310, 3600, 6330), "envback": (2600, 3310, 6621, 6330)}.items():
    x0, y0, x1, y1 = region
    crop = full[y0:y1, x0:x1]
    m = sat_mask(crop, largest=True)
    bx0, by0, bx1, by1 = tight_bbox(m)
    pad = 90
    cx0, cy0 = max(bx0-pad,0), max(by0-pad,0)
    cx1, cy1 = min(bx1+pad, crop.shape[1]), min(by1+pad, crop.shape[0])
    piece = crop[cy0:cy1, cx0:cx1]; pm = m[cy0:cy1, cx0:cx1]
    W, H = piece.shape[1], piece.shape[0]
    geometry[key] = {"paper": [round((bx0-cx0)/W,4), round((by0-cy0)/H,4),
                              round((bx1-bx0)/W,4), round((by1-by0)/H,4)],
                     "aspect": round(W/H, 4)}
    for name, cmyk in COLOURS.items():
        save(recolour(piece, pm, cmyk_rgb(*cmyk)), f"{OUT}/{key}-{slug(name)}.jpg", 900)

# ── Open envelope (blank layer) + liner mask ────────────────────────────────
openenv = Image.open(f"{SCRATCH}/openenv_layer.png")   # RGBA, bbox (2059,154,4600,3303)
LX, LY = 2059, 154
canvas = Image.new("RGB", (2541+2*90, 3149+2*90), (255,255,255))
canvas.paste(openenv, (90, 90), openenv)
oe = np.asarray(canvas).astype(np.float32)
om = sat_mask(oe)
W, H = oe.shape[1], oe.shape[0]
geometry["openenv"] = {"aspect": round(W/H, 4)}
for name, cmyk in COLOURS.items():
    save(recolour(oe, om, cmyk_rgb(*cmyk)), f"{OUT}/openenv-{slug(name)}.jpg", 900)

# liner mask: Layer 9 alpha, positioned in the openenv crop's coordinate space
psd = PSDImage.open("/Users/katepalmer/Documents/Sprinky Studio/Samples/Website mockups/Sky Blue Envelope_cream card.psd")
l9 = next(l for l in psd if l.name == "Layer 9")
la = l9.composite()                                     # RGBA at its bbox
alpha = np.zeros((H, W), dtype=np.uint8)
ax, ay = l9.bbox[0]-LX+90, l9.bbox[1]-LY+90
a = np.asarray(la)[:,:,3]
alpha[ay:ay+a.shape[0], ax:ax+a.shape[1]] = a
mimg = Image.fromarray(alpha)
mimg = mimg.resize((900, round(H*900/W)), Image.LANCZOS)
mimg.save(f"{OUT}/linermask.png")
ys, xs = np.where(alpha > 128)
geometry["linermask"] = {"bbox": [round(xs.min()/W,4), round(ys.min()/H,4),
                                  round((xs.max()-xs.min())/W,4), round((ys.max()-ys.min())/H,4)]}

# ── Card textures (cream, no recolour) ──────────────────────────────────────
cards = {"card-a5": (552,5749,2153,8019), "card-a6l": (4397,6311,6010,7448)}
for key,(x0,y0,x1,y1) in cards.items():
    pad = 70
    piece = full[y0-pad:y1+pad, x0-pad:x1+pad]
    W2, H2 = piece.shape[1], piece.shape[0]
    geometry[key] = {"paper": [round(pad/W2,4), round(pad/H2,4),
                               round((x1-x0)/W2,4), round((y1-y0)/H2,4)],
                     "aspect": round(W2/H2,4)}
    save(piece, f"{OUT}/{key}.jpg", 700 if key=="card-a5" else 800)
a6p = Image.open(f"{OUT}/card-a6l.jpg").rotate(90, expand=True)
a6p.save(f"{OUT}/card-a6p.jpg", quality=82)
g = geometry["card-a6l"]["paper"]
geometry["card-a6p"] = {"paper": [g[1], g[0], g[3], g[2]], "aspect": round(1/geometry["card-a6l"]["aspect"],4)}

with open(f"{OUT}/geometry.json","w") as f: json.dump(geometry, f, indent=1)
print(json.dumps(geometry, indent=1))
print("assets:", len(os.listdir(OUT)))
