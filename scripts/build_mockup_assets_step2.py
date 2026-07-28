"""v2: envelope front/back + cards from layer alpha cutouts (reliable masks)."""
import json, os, re
import numpy as np
from PIL import Image
from psd_tools import PSDImage

SCRATCH = os.path.dirname(os.path.abspath(__file__))
OUT = "/Users/katepalmer/linen-sign-editor/public/demo/mockup"

COLOURS = {
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

def recolour(arr, mask, target):
    lum = arr @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    ys, xs = np.where(mask > 0.9)
    paper = np.median(lum[ys, xs])
    detail = np.clip(lum - paper, -80, 80)[..., None]
    flat = np.clip(target[None, None, :] + detail * 0.9, 0, 255)
    m = mask[..., None]
    return arr * (1 - m) + flat * m

def save(arr, path, w, q=88):
    im = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
    im.save(path, quality=q)

geometry = json.load(open(f"{OUT}/geometry.json"))
psd = PSDImage.open('/Users/katepalmer/Documents/Sprinky Studio/Samples/Website mockups/Sky Blue Envelope_cream card.psd')
layers = {l.name: l for l in psd}

def piece_from_layer(layer, shadow_layer=None):
    """Alpha-paste layer (+optional shadow) onto white with padding.
    Returns rgb float array, colour mask (layer alpha), paper bbox in the canvas."""
    img = layer.composite()
    a = np.asarray(img).astype(np.float32)
    alpha = a[:,:,3] / 255.0
    ys, xs = np.where(alpha > 0.5)
    bx0, by0, bx1, by1 = xs.min(), ys.min(), xs.max(), ys.max()
    pad = 90
    W, H = (bx1-bx0) + 2*pad, (by1-by0) + 2*pad
    canvas = np.full((H, W, 3), 255.0, dtype=np.float32)
    mask = np.zeros((H, W), dtype=np.float32)
    def paste(src_rgba, ox, oy, into_mask):
        sa = src_rgba[:,:,3:4] / 255.0
        h, w = src_rgba.shape[:2]
        x0, y0 = ox, oy
        sx0, sy0 = max(0,-x0), max(0,-y0)
        x0, y0 = max(0,x0), max(0,y0)
        x1, y1 = min(W, x0 + (w-sx0)), min(H, y0 + (h-sy0))
        if x1<=x0 or y1<=y0: return
        s = src_rgba[sy0:sy0+(y1-y0), sx0:sx0+(x1-x0)]
        al = s[:,:,3:4]/255.0
        canvas[y0:y1, x0:x1] = canvas[y0:y1, x0:x1]*(1-al) + s[:,:,:3]*al
        if into_mask is not None:
            into_mask[y0:y1, x0:x1] = np.maximum(into_mask[y0:y1, x0:x1], al[:,:,0])
    if shadow_layer is not None:
        simg = np.asarray(shadow_layer.composite()).astype(np.float32)
        sx = shadow_layer.bbox[0] - (layer.bbox[0] + bx0) + pad
        sy = shadow_layer.bbox[1] - (layer.bbox[1] + by0) + pad
        paste(simg, sx, sy, None)
    paste(a[by0:by1+1, bx0:bx1+1], pad, pad, mask)
    paper = [pad/W, pad/H, (bx1-bx0)/W, (by1-by0)/H]
    return canvas, mask, [round(v,4) for v in paper], round(W/H,4)

# Envelope front (with its cast-shadow strip) and back
for key, lname, shadow in [("envfront","IMG_4265","Layer 10"), ("envback","IMG_4267",None)]:
    arr, mask, paper, aspect = piece_from_layer(layers[lname], layers[shadow] if shadow else None)
    geometry[key] = {"paper": paper, "aspect": aspect}
    for name, cmyk in COLOURS.items():
        save(recolour(arr, mask, cmyk_rgb(*cmyk)), f"{OUT}/{key}-{slug(name)}.jpg", 900)

# Cards (no recolour): portrait A5 texture + landscape A6 texture
for key, lname, w in [("card-a5","A5 Texture 1 cream_LIGHT",700), ("card-a6l","A5 Texture 1 cream_LIGHT copy 2",800)]:
    arr, mask, paper, aspect = piece_from_layer(layers[lname])
    geometry[key] = {"paper": paper, "aspect": aspect}
    save(arr, f"{OUT}/{key}.jpg", w)
a6p = Image.open(f"{OUT}/card-a6l.jpg").rotate(90, expand=True)
a6p.save(f"{OUT}/card-a6p.jpg", quality=88)
g = geometry["card-a6l"]["paper"]
geometry["card-a6p"] = {"paper": [g[1], g[0], g[3], g[2]], "aspect": round(1/geometry["card-a6l"]["aspect"],4)}

with open(f"{OUT}/geometry.json","w") as f: json.dump(geometry, f, indent=1)
print(json.dumps({k:geometry[k] for k in ["envfront","envback","card-a5","card-a6l"]}, indent=1))
