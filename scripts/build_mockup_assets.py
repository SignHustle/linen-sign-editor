"""Build the flat-lay mockup assets from Kate's PSD (v3).

Run with a venv holding: numpy, pillow, psd-tools, scipy.
Needs beside this script (generate once from the PSD):
  psd_full.png      -- psd.composite() of the whole document (RGBA)
  openenv_layer.png -- composite of the 'ChatGPT Image' layer (blank open envelope)

Outputs to public/demo/mockup/ as alpha WebPs so the page can cast real
silhouette drop shadows:
  envfront-<slug>.webp, envback-<slug>.webp, openenv-<slug>.webp  (21 colours)
  card-a5-<slug>.webp, card-a6l-<slug>.webp, card-a6p-<slug>.webp (white/cream/20)
  linermask.png (RGBA), geometry.json

Colour targets are sampled from the photographed envelope range
(IMG_4323), white-balanced against the white board -- not CMYK guesses.
"""
import json, os, re
import numpy as np
from PIL import Image
from psd_tools import PSDImage

SCRATCH = "/private/tmp/claude-501/-Users-katepalmer-signhustle-theme/76310f3a-297f-4120-ba9b-f8305f205913/scratchpad"
PSD = "/Users/katepalmer/Documents/Sprinky Studio/Samples/Website mockups/Sky Blue Envelope_cream card.psd"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "demo", "mockup")
OUT = os.path.abspath(OUT)
os.makedirs(OUT, exist_ok=True)

# Photo-sampled envelope colours (white-balanced), incl. White stock.
PALETTE = {
 "White":"#FAFAF7","Black":"#2C2A2D","Emerald":"#485B57","Matcha":"#D5CEA0",
 "Kiwi":"#CAB644","Midnight Blue":"#313447","Indigo":"#2D477F","Duck Egg Blue":"#C0CEC8",
 "Light Sky":"#EAEFEC","Almond":"#D6C1A6","Mauve":"#B49BAC","Harvest":"#764627",
 "Merlot":"#683C3A","Marsala":"#8C2425","Rouge":"#B24419","Burnt Orange":"#BF4C1F",
 "Pumpkin":"#E26E22","Buttermilk":"#E3C38E","Blush":"#F8CFB2","Rosa":"#EBC0AC",
 "Fuschia":"#A43663",
}
hex_rgb = lambda h: np.array([int(h[i:i+2],16) for i in (1,3,5)], dtype=np.float32)
slug = lambda n: re.sub(r'[^a-z0-9]+','-', n.lower()).strip('-')

def recolour_rgba(rgba, target):
    """Tint the paper to target, keeping shading detail. rgba float 0-255.
    RGB is replaced everywhere -- the alpha channel alone carries the
    silhouette. Blending RGB by alpha leaves a fringe of the original
    paper colour on the anti-aliased edge, so don't. Detail fades with
    alpha so semi-transparent edge pixels are the flat target colour."""
    rgb, alpha = rgba[:,:,:3], rgba[:,:,3]/255.0
    lum = rgb @ np.array([0.299,0.587,0.114], dtype=np.float32)
    ys, xs = np.where(alpha > 0.95)
    paper = np.median(lum[ys, xs])
    detail = (np.clip(lum - paper, -80, 80) * alpha)[..., None]
    out = rgba.copy()
    out[:,:,:3] = np.clip(target[None,None,:] + detail*0.9, 0, 255)
    return out

def save_webp(rgba, path, w, q=85):
    im = Image.fromarray(np.clip(rgba,0,255).astype(np.uint8), "RGBA")
    im = im.resize((w, round(im.height*w/im.width)), Image.LANCZOS)
    im.save(path, "WEBP", quality=q)

def layer_rgba(layer):
    """Layer composite cropped tight to alpha, padded transparent."""
    a = np.asarray(layer.composite()).astype(np.float32)
    alpha = a[:,:,3]
    ys, xs = np.where(alpha > 25)
    bx0,by0,bx1,by1 = xs.min(), ys.min(), xs.max(), ys.max()
    pad = 90
    H, W = (by1-by0)+2*pad, (bx1-bx0)+2*pad
    canvas = np.zeros((H, W, 4), dtype=np.float32)
    canvas[pad:pad+(by1-by0)+1, pad:pad+(bx1-bx0)+1] = a[by0:by1+1, bx0:bx1+1]
    paper = [round(pad/W,4), round(pad/H,4), round((bx1-bx0)/W,4), round((by1-by0)/H,4)]
    return canvas, paper, round(W/H,4), (bx0,by0)

geometry = {}
psd = PSDImage.open(PSD)
layers = {l.name: l for l in psd}

# ── Envelope front / back: every colour ─────────────────────────────────────
for key, lname in [("envfront","IMG_4265"), ("envback","IMG_4267")]:
    rgba, paper, aspect, _ = layer_rgba(layers[lname])
    geometry[key] = {"paper": paper, "aspect": aspect}
    for name, hx in PALETTE.items():
        save_webp(recolour_rgba(rgba, hex_rgb(hx)), f"{OUT}/{key}-{slug(name)}.webp", 900)

# ── Open envelope (blank) + RGBA liner mask ─────────────────────────────────
oe_img = Image.open(f"{SCRATCH}/openenv_layer.png")     # RGBA at bbox (2059,154,...)
oe = np.asarray(oe_img).astype(np.float32)
alpha = oe[:,:,3]
ys, xs = np.where(alpha > 25)
bx0,by0,bx1,by1 = xs.min(), ys.min(), xs.max(), ys.max()
pad = 90
H, W = (by1-by0)+2*pad, (bx1-bx0)+2*pad
canvas = np.zeros((H, W, 4), dtype=np.float32)
canvas[pad:pad+(by1-by0)+1, pad:pad+(bx1-bx0)+1] = oe[by0:by1+1, bx0:bx1+1]
geometry["openenv"] = {"aspect": round(W/H,4)}
for name, hx in PALETTE.items():
    save_webp(recolour_rgba(canvas, hex_rgb(hx)), f"{OUT}/openenv-{slug(name)}.webp", 900)

l9 = layers["Layer 9"]
la = np.asarray(l9.composite())[:,:,3]
LX, LY = 2059, 154                                       # openenv layer bbox origin
mask = np.zeros((H, W), dtype=np.uint8)
ax = l9.bbox[0]-LX - bx0 + pad
ay = l9.bbox[1]-LY - by0 + pad
mask[ay:ay+la.shape[0], ax:ax+la.shape[1]] = la
rgba_mask = np.zeros((H, W, 4), dtype=np.uint8)
rgba_mask[:,:,:3] = 255
rgba_mask[:,:,3] = mask
mi = Image.fromarray(rgba_mask, "RGBA").resize((900, round(H*900/W)), Image.LANCZOS)
mi.save(f"{OUT}/linermask.png")

# ── Cards: white / cream / all colours, three shapes ────────────────────────
CARD_TARGETS = dict(PALETTE)
CARD_TARGETS.pop("White", None)
for key, lname, w in [("card-a5","A5 Texture 1 cream_LIGHT",700),
                      ("card-a6l","A5 Texture 1 cream_LIGHT copy 2",800)]:
    rgba, paper, aspect, _ = layer_rgba(layers[lname])
    geometry[key] = {"paper": paper, "aspect": aspect}
    save_webp(rgba, f"{OUT}/{key}-cream.webp", w)
    save_webp(recolour_rgba(rgba, hex_rgb("#FCFCFA")), f"{OUT}/{key}-white.webp", w)
    for name, hx in CARD_TARGETS.items():
        save_webp(recolour_rgba(rgba, hex_rgb(hx)), f"{OUT}/{key}-{slug(name)}.webp", w)
# portrait A6 = rotated landscape
for f in os.listdir(OUT):
    if f.startswith("card-a6l-") and f.endswith(".webp"):
        im = Image.open(f"{OUT}/{f}").rotate(90, expand=True)
        im.save(f"{OUT}/{f.replace('card-a6l-','card-a6p-')}", "WEBP", quality=85)
g = geometry["card-a6l"]["paper"]
geometry["card-a6p"] = {"paper":[g[1],g[0],g[3],g[2]], "aspect": round(1/geometry["card-a6l"]["aspect"],4)}

with open(f"{OUT}/geometry.json","w") as f: json.dump(geometry, f, indent=1)
print(json.dumps(geometry, indent=1))
print("assets:", len([f for f in os.listdir(OUT) if f.endswith('.webp')]))
