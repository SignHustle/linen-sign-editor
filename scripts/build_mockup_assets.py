"""Build the flat-lay mockup assets from Kate's PSD (v4).

Source: ~/Documents/Sprinky Studio/Samples/Website mockups/card and envelope mockups.psd
Kate's labelled mockup sheet: C5 + 150-square envelopes in Euro Flap and
iFlap, two open envelopes (one per flap) with separate liner layers, and
four card textures (Matte white / Rough White / Linen White / Matte cream).

Outputs alpha WebPs to public/demo/mockup/ so the page casts silhouette
drop shadows, recoloured to the photo-sampled paper palette:
  envfront-c5-<slug>, envback-c5-euro-<slug>, envback-c5-iflap-<slug>,
  envfront-sq-<slug>, envback-sq-euro-<slug>, envback-sq-iflap-<slug>,
  openenv-euro-<slug>, openenv-iflap-<slug>          (21 colours each)
  card-a5-{matte,textured,cream}, card-a5-<colour>   (23)
  card-a6r-* (rotated a5, for landscape A6 pieces)   (23)
  linermask-euro.png, linermask-iflap.png (RGBA), geometry.json

Run with a venv holding numpy, pillow, psd-tools, scipy.
"""
import json, os, re
import numpy as np
from PIL import Image
from psd_tools import PSDImage

PSD = "/Users/katepalmer/Documents/Sprinky Studio/Samples/Website mockups/card and envelope mockups.psd"
OUT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "demo", "mockup"))
os.makedirs(OUT, exist_ok=True)

PALETTE = {
 "White":"#FAFAF7","Black":"#2C2A2D","Emerald":"#485B57","Matcha":"#D5CEA0",
 "Kiwi":"#CAB644","Midnight Blue":"#313447","Indigo":"#2D477F","Duck Egg Blue":"#C0CEC8",
 "Light Sky":"#EAEFEC","Almond":"#EDE2D1","Mauve":"#B49BAC","Harvest":"#764627",
 "Merlot":"#683C3A","Marsala":"#8C2425","Rouge":"#B24419","Burnt Orange":"#BF4C1F",
 "Pumpkin":"#E26E22","Buttermilk":"#E3C38E","Blush":"#F8CFB2","Rosa":"#EBC0AC",
 "Fuschia":"#A43663",
}
hex_rgb = lambda h: np.array([int(h[i:i+2],16) for i in (1,3,5)], dtype=np.float32)
slug = lambda n: re.sub(r'[^a-z0-9]+','-', n.lower()).strip('-')

def recolour_rgba(rgba, target):
    """RGB replaced everywhere (alpha alone is the silhouette — blending by
    alpha fringes the edge). Highlights compressed hard so the photo's lit
    paper edge doesn't become a white rim; shadows keep depth."""
    rgb, alpha = rgba[:,:,:3], rgba[:,:,3]/255.0
    lum = rgb @ np.array([0.299,0.587,0.114], dtype=np.float32)
    ys, xs = np.where(alpha > 0.95)
    paper = np.median(lum[ys, xs])
    d = lum - paper
    pos = np.minimum(np.clip(d, 0, None) * 0.35, 28)
    neg = np.clip(d, -80, 0) * 0.9
    detail = ((pos + neg) * alpha)[..., None]
    out = rgba.copy()
    out[:,:,:3] = np.clip(target[None,None,:] + detail, 0, 255)
    return out

def save_webp(rgba, path, w, q=85):
    im = Image.fromarray(np.clip(rgba,0,255).astype(np.uint8), "RGBA")
    im = im.resize((w, round(im.height*w/im.width)), Image.LANCZOS)
    im.save(path, "WEBP", quality=q)

def padded(layer):
    """Layer composite, cropped tight to alpha, padded transparent."""
    a = np.asarray(layer.composite()).astype(np.float32)
    alpha = a[:,:,3]
    ys, xs = np.where(alpha > 25)
    bx0,by0,bx1,by1 = xs.min(), ys.min(), xs.max(), ys.max()
    pad = 90
    H, W = (by1-by0)+2*pad, (bx1-bx0)+2*pad
    canvas = np.zeros((H, W, 4), dtype=np.float32)
    canvas[pad:pad+(by1-by0)+1, pad:pad+(bx1-bx0)+1] = a[by0:by1+1, bx0:bx1+1]
    paper = [round(pad/W,4), round(pad/H,4), round((bx1-bx0)/W,4), round((by1-by0)/H,4)]
    return canvas, paper, round(W/H,4), (layer.bbox[0]+bx0, layer.bbox[1]+by0)

psd = PSDImage.open(PSD)
def layer_at(name, x_near):
    """Disambiguate same-named layers by left-edge position."""
    cands = [l for l in psd if l.name == name]
    return min(cands, key=lambda l: abs(l.bbox[0]-x_near))

geometry = {}

# ── Envelope pieces (recoloured to every stock) ─────────────────────────────
ENV_PIECES = {
  "envfront-c5":     layer_at("IMG_4265", 12890),
  "envback-c5-euro": layer_at("IMG_4267", 15946),
  "envback-c5-iflap":layer_at("Layer 14", 5605),
  "envfront-sq":     layer_at("IMG_4265", 8654),
  "envback-sq-euro": layer_at("IMG_4267", 10570),
  "envback-sq-iflap":layer_at("Layer 15", 3444),
  # Open envelopes per size AND flap. The Euro pair are the ChatGPT layers;
  # Kate added the iFlap pair as named "-exact" layers (the iFlap stock is
  # 130x190-proportioned for A5/5x7, 150x150 for square).
  "openenv-c5-euro":  layer_at("ChatGPT Image Jul 28, 2026 at 09_47_45 PM", 14443),
  "openenv-sq-euro":  layer_at("ChatGPT Image Jul 28, 2026 at 09_47_45 PM", 10509),
  "openenv-c5-iflap": layer_at("envelope-open-130x190-exact", 5617),
  "openenv-sq-iflap": layer_at("envelope-open-150x150-exact", 3444),
}
origins = {}
for key, layer in ENV_PIECES.items():
    rgba, paper, aspect, origin = padded(layer)
    origins[key] = (origin, rgba.shape[1], rgba.shape[0])
    geometry[key] = {"paper": paper, "aspect": aspect}
    for name, hx in PALETTE.items():
        save_webp(recolour_rgba(rgba, hex_rgb(hx)), f"{OUT}/{key}-{slug(name)}.webp", 900)

# ── Liner masks: liner layers' alpha, in each openenv's frame ───────────────
# scale > 1 grows the mask about its centroid (Kate: the C5 liner read small).
for mkey, lname, lx, okey, scale in [("linermask-c5-euro","Layer 9",14609,"openenv-c5-euro",1.06),
                                     ("linermask-sq-euro","Layer 13",10623,"openenv-sq-euro",1.0),
                                     ("linermask-c5-iflap","Layer 17",5790,"openenv-c5-iflap",1.0),
                                     ("linermask-sq-iflap","Layer 16",3641,"openenv-sq-iflap",1.0)]:
    l = layer_at(lname, lx)
    la = np.asarray(l.composite())[:,:,3]
    (ox, oy), W, H = origins[okey]
    mask = np.zeros((H, W), dtype=np.uint8)
    ax, ay = l.bbox[0]-ox+90, l.bbox[1]-oy+90
    mask[ay:ay+la.shape[0], ax:ax+la.shape[1]] = la
    if scale != 1.0:
        ys, xs = np.where(mask > 8)
        cy, cx = ys.mean(), xs.mean()
        mi = Image.fromarray(mask)
        big = mi.resize((round(W*scale), round(H*scale)), Image.LANCZOS)
        canvas = Image.new("L", (W, H), 0)
        canvas.paste(big, (round(cx - cx*scale), round(cy - cy*scale)))
        mask = np.asarray(canvas)
    rgba_mask = np.zeros((H, W, 4), dtype=np.uint8)
    rgba_mask[:,:,:3] = 255
    rgba_mask[:,:,3] = mask
    Image.fromarray(rgba_mask, "RGBA").resize((900, round(H*900/W)), Image.LANCZOS).save(f"{OUT}/{mkey}.png")

# ── Cards: real textures per stock + colours from the matte base ────────────
CARD_LAYERS = {
  "matte":    layer_at("A5 Texture 1 cream_LIGHT copy 3", 11157),  # Matte white
  "textured": layer_at("A5 Texture 1 White copy", 9378),           # Rough White
  "cream":    layer_at("A5 Texture 1 cream_LIGHT", 12936),         # Matte cream
}
def save_card(rgba, base):
    save_webp(rgba, f"{OUT}/card-a5-{base}.webp", 700)
    rot = np.rot90(rgba, k=1)                                       # landscape A6 uses rotated stock
    save_webp(rot, f"{OUT}/card-a6r-{base}.webp", 800)
for stock, layer in CARD_LAYERS.items():
    rgba, paper, aspect, _ = padded(layer)
    if stock == "matte":
        geometry["card-a5"] = {"paper": paper, "aspect": aspect}
        geometry["card-a6r"] = {"paper": [paper[1],paper[0],paper[3],paper[2]], "aspect": round(1/aspect,4)}
        matte_rgba = rgba
    save_card(rgba, stock)
# Coloured cards: the colour is MULTIPLIED over the matte-white texture, so
# the white stock's grain shows through the tint (Kate: underlay matte white).
def tint_card(rgba, target):
    out = rgba.copy()
    out[:,:,:3] = rgba[:,:,:3] * (target[None,None,:] / 255.0)
    return out
for name, hx in PALETTE.items():
    if name == "White": continue
    save_card(tint_card(matte_rgba, hex_rgb(hx)), slug(name))

with open(f"{OUT}/geometry.json","w") as f: json.dump(geometry, f, indent=1)
print(json.dumps(geometry, indent=1))
print("assets:", len([f for f in os.listdir(OUT) if f.endswith(('.webp','.png'))]))
