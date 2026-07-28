import { useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";

// ─── Google Fonts ─────────────────────────────────────────────────────────────
const FONTS = [
  { id:"cormorant",   label:"Cormorant",        family:"'Cormorant Garamond', serif", url:"Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,400" },
  { id:"playfair",    label:"Playfair Display",  family:"'Playfair Display', serif",   url:"Playfair+Display:ital,wght@0,400;0,700;1,400" },
  { id:"dancing",     label:"Dancing Script",    family:"'Dancing Script', cursive",   url:"Dancing+Script:wght@400;600;700" },
  { id:"lora",        label:"Lora",              family:"'Lora', serif",               url:"Lora:ital,wght@0,400;0,600;1,400" },
  { id:"pinyon",      label:"Pinyon Script",     family:"'Pinyon Script', cursive",    url:"Pinyon+Script" },
  { id:"eb-garamond", label:"EB Garamond",       family:"'EB Garamond', serif",        url:"EB+Garamond:ital,wght@0,400;0,500;1,400" },
  { id:"great-vibes", label:"Great Vibes",       family:"'Great Vibes', cursive",      url:"Great+Vibes" },
  { id:"jost",        label:"Jost (Sans)",       family:"'Jost', sans-serif",          url:"Jost:wght@200;300;400" },
];

// Runtime custom font registry — updated when user uploads a font
let _runtimeFonts = [];

const BRAND_FONTS = [
  { id:"mozart",       label:"Mozart Script",       family:"MozartScript",      file:"/MozartScript-Black.otf" },
  { id:"mozart-light", label:"Mozart Script Light", family:"MozartScriptLight", file:"/MozartScript-Regular.otf" },
  { id:"dubiel",  label:"Dubiel",         family:"Dubiel",        file:"/DUBIEL.TTF" },
  { id:"madison", label:"Madison Script", family:"Madison",       file:"/Madison-Regular.ttf" },
  { id:"whimsy",  label:"Whimsy",         family:"Whimsy",        file:"/Whimsy.otf" },
];
// ─── OpenType feature detection ──────────────────────────────────────────────
const ALL_OT_FEATURES = [
  { tag:"init", tip:"Initial Swash"  },
  { tag:"fina", tip:"Final Swash"    },
  { tag:"salt", tip:"Stylistic Alt"  },
  { tag:"swsh", tip:"Swash"          },
  { tag:"ss01", tip:"Style Set 1"    },
  { tag:"ss02", tip:"Style Set 2"    },
  { tag:"ss03", tip:"Style Set 3"    },
  { tag:"ss04", tip:"Style Set 4"    },
  { tag:"ss05", tip:"Style Set 5"    },
  { tag:"ss06", tip:"Style Set 6"    },
  { tag:"ss07", tip:"Style Set 7"    },
  { tag:"ss08", tip:"Style Set 8"    },
  { tag:"ss09", tip:"Style Set 9"    },
  { tag:"ss10", tip:"Style Set 10"   },
  { tag:"ss11", tip:"Style Set 11"   },
  { tag:"ss12", tip:"Style Set 12"   },
  { tag:"ss13", tip:"Style Set 13"   },
  { tag:"ss14", tip:"Style Set 14"   },
  { tag:"ss15", tip:"Style Set 15"   },
  { tag:"ss16", tip:"Style Set 16"   },
  { tag:"ss17", tip:"Style Set 17"   },
  { tag:"ss18", tip:"Style Set 18"   },
  { tag:"ss19", tip:"Style Set 19"   },
  { tag:"ss20", tip:"Style Set 20"   },
  { tag:"aalt", tip:"Alternate"      }, // expanded to indexed variants in the picker
  { tag:"dlig", tip:"Ligature"       },
  { tag:"calt", tip:"Contextual"     },
];
const _ALL_OT_TAG_SET = new Set(ALL_OT_FEATURES.map(f => f.tag));

// fontId → string[] of supported feature tags; undefined = not yet probed
const _fontFeatureCache = {};

function _parseGSUBTags(buf) {
  try {
    const v = new DataView(buf);
    const numTables = v.getUint16(4);
    let gsubOff = -1;
    for (let i = 0; i < numTables; i++) {
      const b = 12 + i * 16;
      const tag = String.fromCharCode(v.getUint8(b), v.getUint8(b+1), v.getUint8(b+2), v.getUint8(b+3));
      if (tag === "GSUB") { gsubOff = v.getUint32(b + 8); break; }
    }
    if (gsubOff < 0) return [];
    // GSUB header: majorVersion(2) minorVersion(2) scriptListOffset(2) featureListOffset(2) …
    // featureListOffset is at +6, NOT +4 (that's scriptListOffset)
    const featListOff = gsubOff + v.getUint16(gsubOff + 6);
    const featCount   = v.getUint16(featListOff);
    const tags = new Set();
    for (let i = 0; i < featCount; i++) {
      const b = featListOff + 2 + i * 6;
      const tag = String.fromCharCode(v.getUint8(b), v.getUint8(b+1), v.getUint8(b+2), v.getUint8(b+3))
                    .replace(/\0/g, "").trim();
      if (_ALL_OT_TAG_SET.has(tag)) tags.add(tag);
    }
    return [...tags];
  } catch { return []; }
}

function _probeFontFromBuffer(fontId, buf) {
  _fontFeatureCache[fontId] = _parseGSUBTags(buf);
}

async function _probeFontFromUrl(fontId, url) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return;
    _fontFeatureCache[fontId] = _parseGSUBTags(await resp.arrayBuffer());
  } catch { _fontFeatureCache[fontId] = []; }
}

// Exact per-character alternates map, generated from the font binaries by
// gen_font_alternates.py (same GSUB data Illustrator's Glyphs panel shows):
// { "MozartScript-Regular.otf": { "s": ['"init" 1', '"aalt" 3', …], … }, … }
let _fontAltMap = null;

let _brandFontsLoaded = false;
function loadBrandFonts() {
  if (_brandFontsLoaded) return;
  _brandFontsLoaded = true;
  fetch("/font-alternates.json")
    .then(r => (r.ok ? r.json() : null))
    .then(j => { _fontAltMap = j; })
    .catch(() => {});
  BRAND_FONTS.forEach(f => {
    const face = new FontFace(f.family, "url(" + f.file + ")");
    face.load().then(loaded => document.fonts.add(loaded)).catch(()=>{});
    const s = document.createElement("style");
    s.textContent = "@font-face{font-family:'" + f.family + "';src:url('" + f.file + "');}";
    document.head.appendChild(s);
    // Probe the font binary for GSUB features
    _probeFontFromUrl(f.id, f.file);
  });
}

function getAllFonts() { return [...FONTS, ...BRAND_FONTS, ..._runtimeFonts]; }

// ─── Sizes ────────────────────────────────────────────────────────────────────
const SIZES = {
  "450x1000":  { label:"450mm × 1m",   w:450,  h:1000 },
  "700x1400":  { label:"700mm × 1.4m", w:700,  h:1400 },
  "700x2000":  { label:"700mm × 2m",   w:700,  h:2000 },
  "700x3000":  { label:"700mm × 3m",   w:700,  h:3000 },
  "1400x2000": { label:"1.4m × 2m",    w:1400, h:2000 },
  "1400x3000": { label:"1.4m × 3m",    w:1400, h:3000 },
  // Rigid-board signage sizes
  "a1":        { label:"A1 (594×841mm)",        w:594,  h:841  },
  "a2":        { label:"A2 (420×594mm)",        w:420,  h:594  },
  "a3":        { label:"A3 (297×420mm)",        w:297,  h:420  },
  "a4":        { label:"A4 (210×297mm)",        w:210,  h:297  },
  // Small signage / cards
  "140x297":   { label:"140×297mm",             w:140,  h:297  },
  // Stationery sizes
  "120x180":   { label:"120×180mm (5×7\")",     w:120,  h:180  },
  "a5":        { label:"A5 (148×210mm)",        w:148,  h:210  },
  "120x120":   { label:"120×120mm",             w:120,  h:120  },
  "a6":        { label:"A6 (105×148mm)",        w:105,  h:148  },
  "dl":        { label:"DL (99×210mm)",         w:99,   h:210  },
  "90x50":     { label:"90×50mm",               w:90,   h:50   },
  "90x100":    { label:"90×100mm",              w:90,   h:100  },
  // Envelopes
  "130x190":   { label:"130×190mm Envelope",    w:130,  h:190  },
  "c5":        { label:"C5 Envelope (162×229mm)", w:162, h:229 },
  "130x130":   { label:"130×130mm Envelope",    w:130,  h:130  },
  "190x130":   { label:"130×190mm Envelope (Landscape)", w:190, h:130 },
  "229x162":   { label:"C5 Envelope (Landscape)", w:229, h:162 },
  // Landscape cards & liners
  "148x105":   { label:"A6 Landscape (148×105mm)", w:148, h:105 },
  "liner-c5":      { label:"C5 Envelope Liner",      w:250, h:340 },
  "liner-130x190": { label:"130×190mm Envelope Liner", w:250, h:340 },
  "liner-130x130": { label:"130×130mm Envelope Liner", w:250, h:340 },
};

const SIGN_TYPES = {
  "wedding-welcome":     { label:"Wedding Welcome Sign"  },
  "wedding-seating":     { label:"Wedding Seating Chart" },
  "bar-sign":            { label:"Bar Sign"              },
  "memorial":            { label:"Memorial Sign"         },
  "baby-shower":         { label:"Baby Shower Sign"      },
  "birthday":            { label:"Birthday Sign"         },
  "wishing-well":        { label:"Wishing Well Sign"     },
  "polaroid-guestbook":  { label:"Polaroid Guestbook Sign" },
  "table-number":        { label:"Table Numbers"          },
  "invite":              { label:"Wedding Invitation"    },
  "save-the-date":       { label:"Save the Date"         },
  "details-card":        { label:"Details Card"          },
  "rsvp-card":           { label:"RSVP Card"              },
  "envelope":            { label:"Envelope"               },
  "envelope-front":      { label:"Envelope"               },
  "envelope-back":       { label:"Envelope Back"          },
  "envelope-liner":      { label:"Envelope Liner"         },
  "menu":                { label:"Food Menu"              },
  "drinks-menu":         { label:"Drinks Menu"            },
  "seating-arrangement": { label:"Seating Arrangement Card" },
  "reserved-seating":    { label:"Reserved Seating Card"  },
  "place-card":          { label:"Place Card"             },
  "hardcover-menu":      { label:"Hardcover Menu"         },
  "vow-book":            { label:"Vow Book"               },
};

// ─── Design collections ───────────────────────────────────────────────────────
// `main: true` collections always appear in the collection step (greyed out
// while they have no designs for the selection). Others appear only when they
// have designs.
const COLLECTIONS = {
  "swan-lake":     { label:"Swan Lake",     main:true },
  "fleur":         { label:"Fleur",         main:true },
  "whimsy":        { label:"Whimsy",        main:true },
  "secret-garden": { label:"Secret Garden", main:true },
  "empire-state":  { label:"Empire State",  main:true },
};

// ─── Product groups (landing page organisation) ───────────────────────────────
// Each group pairs the sign types it offers with the sizes it's produced in.
// A type appears greyed-out ("coming soon") while no template in its category
// is available in any of the group's sizes.
const PRODUCT_GROUPS = {
  fabric: {
    label: "Fabric Signage",
    blurb: "Linen, Satin and Lace signs.",
    types: ["wedding-welcome","wedding-seating","bar-sign","table-number","memorial","baby-shower","birthday"],
    sizes: ["450x1000","700x1400","700x2000","700x3000","1400x2000","1400x3000"],
  },
  rigid: {
    label: "Rigid Board Signage",
    blurb: "Welcome signs, seating charts, bar menus and more.",
    types: ["wedding-welcome","wedding-seating","bar-sign","polaroid-guestbook","memorial","wishing-well","table-number","menu"],
    sizes: ["a5","a4","a3","a2","a1","140x297"],
    material: "rigid", // only templates tagged material:"rigid" appear here
  },
  stationery: {
    label: "On The Day Stationery",
    blurb: "Menus, place cards and more.",
    types: ["menu","drinks-menu","place-card","table-number","seating-arrangement","reserved-seating"],
    sizes: ["a4","a5","a6","120x180","dl","a3","90x50","90x100"],
  },
  invitations: {
    label: "Invitations",
    blurb: "Save the dates, invitations and envelopes to set the tone for your day.",
    types: ["save-the-date","invite","details-card","rsvp-card","envelope-front","envelope-back","envelope-liner"],
    sizes: ["a5","120x180","120x120","a6","148x105","c5","229x162","130x190","190x130","130x130","liner-c5","liner-130x190","liner-130x130"],
  },
  hardcovers: {
    label: "Linen Hardcovers",
    blurb: "Menus and vow books — beautiful keepsakes for your day and beyond.",
    types: ["hardcover-menu","vow-book"],
    sizes: ["a4","a5","a6"],
  },
};

// Templates in a category, restricted to sizes a group is produced in,
// optionally restricted to a design collection
function templatesForGroupType(groupKey, typeKey, collectionKey) {
  const group = PRODUCT_GROUPS[groupKey];
  if (!group) return [];
  return TEMPLATES.filter(t =>
    t.category === typeKey &&
    // material gate: rigid-board templates only under the rigid group and vice versa
    (group.material ? t.material === group.material : !t.material) &&
    (!collectionKey || t.collection === collectionKey) &&
    (!t.availableSizes || t.availableSizes.some(s => group.sizes.includes(s)))
  );
}

const INTERNAL_W = 400;
function canvasDims(sizeKey) {
  const s = SIZES[sizeKey] || SIZES["700x2000"];
  return { cw: INTERNAL_W, ch: Math.round(INTERNAL_W * s.h / s.w) };
}

// ─── URL param reader ─────────────────────────────────────────────────────────
function getUrlParams() {
  try {
    const p = new URLSearchParams(window.location.search);
    return {
      type:       p.get("type")       || null,
      size:       p.get("size")       || null,
      collection: p.get("collection") || null,
      variant:    p.get("variant")    || null,
      template:   p.get("template")   || null,
      group:      p.get("group")      || null,
      preview:    p.get("preview")    === "1",
      bg:         p.get("bg")         || null,
      lockbg:     p.get("lockbg")     === "1",
      dev:        p.get("dev")        === "true",
    };
  } catch { return { type: null, size: null, collection: null, variant: null, template: null, group: null }; }
}

// ─── Browse card image (photo / mock-up slot with grey placeholder) ───────────
// Drop images into public/browse/ with these filenames and they appear
// automatically — no code changes needed:
//   group-{key}.jpg       →  group-fabric.jpg, group-rigid.jpg, group-stationery.jpg,
//                            group-invitations.jpg, group-hardcovers.jpg
//   type-{key}.jpg        →  type-wedding-welcome.jpg, type-place-card.jpg, …
//   collection-{key}.jpg  →  collection-swan-lake.jpg, collection-fleur.jpg, …
//   size-{key}.jpg        →  size-a5.jpg, size-700x2000.jpg, …
function BrowseImage({ src, ratio = "4/3", fallback = null, radius = 6 }) {
  const [ok, setOk] = useState(!!src);
  if (!ok) {
    return fallback ?? (
      <div style={{width:"100%",aspectRatio:ratio,borderRadius:radius,
        background:"#E9E2D8",border:"1px solid rgba(180,165,150,0.35)",
        display:"flex",flexDirection:"column",gap:6,alignItems:"center",justifyContent:"center",color:"#B9AD9F"}}>
        <div style={{fontSize:20,lineHeight:1}}>✦</div>
        <div style={{fontSize:8,letterSpacing:2}}>PHOTO</div>
      </div>
    );
  }
  return (
    <div style={{width:"100%",aspectRatio:ratio,borderRadius:radius,overflow:"hidden",position:"relative",
      background:"#E9E2D8",border:"1px solid rgba(180,165,150,0.35)"}}>
      <img src={src} alt="" onError={() => setOk(false)}
        style={{position:"absolute",inset:0,width:"100%",height:"100%",objectFit:"cover"}}/>
    </div>
  );
}

// ─── Snap helpers ─────────────────────────────────────────────────────────────
const SNAP_THRESHOLD = 10;
// `kind` is "canvas" for canvas centre/edges, "element" for element-to-element.
// `draggingId` accepts a string, an array of ids, or a Set — any element whose
// id is in there is excluded from the snap-line candidates (used for group
// drags, where every selected element should be ignored).
function getSnapLines(elements, draggingId, cw, ch) {
  const ignore = draggingId instanceof Set
    ? draggingId
    : new Set(Array.isArray(draggingId) ? draggingId : [draggingId]);
  // Canvas snap lines: left/centre/right and top/middle/bottom of the page
  const xLines = [
    { v: 0,      kind: "canvas" },
    { v: cw / 2, kind: "canvas" },
    { v: cw,     kind: "canvas" },
  ];
  const yLines = [
    { v: 0,      kind: "canvas" },
    { v: ch / 2, kind: "canvas" },
    { v: ch,     kind: "canvas" },
  ];
  elements.forEach(el => {
    if (ignore.has(el.id) || el.type === "divider" || el.hidden) return;
    const w = el.width || 0, h = el.height || el.fontSize || 0;
    xLines.push({ v: el.x,         kind: "element" });
    xLines.push({ v: el.x + w / 2, kind: "element" });
    xLines.push({ v: el.x + w,     kind: "element" });
    yLines.push({ v: el.y,         kind: "element" });
    yLines.push({ v: el.y + h / 2, kind: "element" });
    yLines.push({ v: el.y + h,     kind: "element" });
  });
  return { xLines, yLines };
}
function snapVal(v, lines) {
  let best = null;
  for (const l of lines) {
    const d = Math.abs(v - l.v);
    if (d < SNAP_THRESHOLD && (!best || d < best.d)) best = { snapped: l.v, guide: l.v, kind: l.kind, d };
  }
  return best || { snapped: v, guide: null, kind: null };
}
function applySnap(x, y, w, h, xLines, yLines) {
  const cx = x + w / 2, rx = x + w, cy = y + h / 2, by = y + h;
  const xs = [snapVal(x, xLines), snapVal(cx, xLines), snapVal(rx, xLines)];
  const ys = [snapVal(y, yLines), snapVal(cy, yLines), snapVal(by, yLines)];
  const xOffsets = [0, -w / 2, -w], yOffsets = [0, -h / 2, -h];
  let bestX = null, bestY = null;
  xs.forEach((s, i) => {
    if (s.guide !== null) {
      const dist = Math.abs(s.snapped - [x, cx, rx][i]);
      if (!bestX || dist < bestX.dist) bestX = { val: s.snapped + xOffsets[i], guide: s.guide, kind: s.kind, dist };
    }
  });
  ys.forEach((s, i) => {
    if (s.guide !== null) {
      const dist = Math.abs(s.snapped - [y, cy, by][i]);
      if (!bestY || dist < bestY.dist) bestY = { val: s.snapped + yOffsets[i], guide: s.guide, kind: s.kind, dist };
    }
  });
  return {
    x: bestX ? bestX.val : x,
    y: bestY ? bestY.val : y,
    guideX:     bestX ? bestX.guide : null,
    guideY:     bestY ? bestY.guide : null,
    guideXKind: bestX ? bestX.kind  : null,
    guideYKind: bestY ? bestY.kind  : null,
  };
}

// ─── Undo/redo ────────────────────────────────────────────────────────────────
function useUndoRedo(initial) {
  // idx + history live in ONE state object so updates are atomic. Previously
  // they were two separate useState calls: two set() calls in the same tick
  // (e.g. text-edit blur firing onChange + onCommit together) advanced idx
  // twice while history grew by one — history[idx] became undefined and the
  // whole editor crashed on the next render.
  const [state, setState] = useState({ idx: 0, history: [initial] });
  const present = state.history[state.idx];
  const set = useCallback((next) => {
    setState(s => {
      const cur = s.history[s.idx];
      const val = typeof next === "function" ? next(cur) : next;
      return { idx: s.idx + 1, history: [...s.history.slice(0, s.idx + 1), val] };
    });
  }, []);
  const undo = useCallback(() => setState(s => ({ ...s, idx: Math.max(0, s.idx - 1) })), []);
  const redo = useCallback(() => setState(s => ({ ...s, idx: Math.min(s.history.length - 1, s.idx + 1) })), []);
  const reset = useCallback((val) => setState({ idx: 0, history: [val] }), []);
  return { present, set, undo, redo, canUndo: state.idx > 0, canRedo: state.idx < state.history.length - 1, reset };
}

// ─── Illustration library ─────────────────────────────────────────────────────
const ILLUSTRATION_LIBRARY = [
  { category: "Botanicals", items: [
    { id: "il-eucalyptus", label: "Eucalyptus",   svg: "eucalyptus" },
    { id: "il-olive",      label: "Olive Branch",  svg: "olive"      },
    { id: "il-fern",       label: "Fern",          svg: "fern"       },
    { id: "il-rose",       label: "Rose",          svg: "rose"       },
    { id: "il-peony",      label: "Peony",         svg: "peony"      },
    { id: "il-lavender",   label: "Lavender",      svg: "lavender"   }
  ]},
  { category: "Frames", items: [
    { id: "il-arch",    label: "Arch Frame",   svg: "arch"    },
    { id: "il-wreath",  label: "Wreath",       svg: "wreath"  },
    { id: "il-monogram",label: "Monogram Ring",svg: "monogram"},
    { id: "il-corner",  label: "Corner Sprig", svg: "corner"  }
  ]},
  { category: "Wedding", items: [
    { id: "il-rings",    label: "Wedding Rings", svg: "rings"    },
    { id: "il-champagne",label: "Champagne",     svg: "champagne"},
    { id: "il-bow",      label: "Ribbon Bow",    svg: "bow"      },
    { id: "il-heart",    label: "Heart",         svg: "heart"    },
    { id: "il-dove",     label: "Dove",          svg: "dove"     }
  ]},
];

function IllustrationThumb({ type, size = 60, color = "#9A8F85" }) {
  const c = color;
  const shapes = {
    eucalyptus: <g stroke={c} strokeWidth="1.2" fill="none"><path d="M30,55 Q20,40 25,25 Q30,10 30,5"/><ellipse cx="22" cy="30" rx="8" ry="5" transform="rotate(-30,22,30)" fill={c} opacity="0.3"/><ellipse cx="26" cy="20" rx="7" ry="4" transform="rotate(-20,26,20)" fill={c} opacity="0.3"/><ellipse cx="35" cy="22" rx="7" ry="4" transform="rotate(25,35,22)" fill={c} opacity="0.25"/></g>,
    olive: <g stroke={c} strokeWidth="1.2" fill="none"><path d="M30,58 Q18,45 22,30 Q26,15 30,8"/><ellipse cx="20" cy="35" rx="9" ry="5" transform="rotate(-40,20,35)" fill={c} opacity="0.3"/><ellipse cx="38" cy="28" rx="8" ry="4.5" transform="rotate(30,38,28)" fill={c} opacity="0.3"/><circle cx="19" cy="38" r="2.5" fill={c} opacity="0.5"/></g>,
    fern: <g stroke={c} strokeWidth="1" fill="none"><path d="M30,58 L30,10" strokeWidth="1.5"/>{[14,20,26,32,38,44,50].map((y,i) => <g key={i}><path d={`M30,${y} Q${20-i},${y-6} ${18-i},${y-12}`} fill={c} opacity="0.3"/><path d={`M30,${y} Q${40+i},${y-6} ${42+i},${y-12}`} fill={c} opacity="0.3"/></g>)}</g>,
    rose: <g fill={c} stroke={c} strokeWidth="0.8"><circle cx="30" cy="30" r="4" opacity="0.8"/><ellipse cx="30" cy="22" rx="5" ry="8" opacity="0.4"/><ellipse cx="38" cy="26" rx="8" ry="5" transform="rotate(45,38,26)" opacity="0.35"/><ellipse cx="22" cy="35" rx="8" ry="5" transform="rotate(30,22,35)" opacity="0.35"/></g>,
    peony: <g fill={c} stroke={c} strokeWidth="0.8"><circle cx="30" cy="28" r="5" opacity="0.7"/>{[0,45,90,135,180,225,270,315].map((a,i) => <ellipse key={i} cx={30+Math.cos(a*Math.PI/180)*11} cy={28+Math.sin(a*Math.PI/180)*11} rx="7" ry="4.5" transform={`rotate(${a},${30+Math.cos(a*Math.PI/180)*11},${28+Math.sin(a*Math.PI/180)*11})`} opacity="0.3"/>)}</g>,
    lavender: <g stroke={c} strokeWidth="1" fill={c}><path d="M30,58 L30,20" strokeWidth="1.5" fill="none"/>{[20,24,28,32,36].map((y,i) => <ellipse key={i} cx={30+(i%2===0?-3:3)} cy={y} rx="3" ry="4" opacity="0.5"/>)}</g>,
    arch: <g stroke={c} strokeWidth="1.5" fill="none"><path d="M15,55 L15,30 Q15,10 30,10 Q45,10 45,30 L45,55"/><path d="M18,55 L18,30 Q18,14 30,14 Q42,14 42,30 L42,55" strokeWidth="0.8" opacity="0.5"/></g>,
    wreath: <g stroke={c} strokeWidth="1" fill="none"><circle cx="30" cy="30" r="18" strokeDasharray="3,3" opacity="0.4"/>{[0,30,60,90,120,150,180,210,240,270,300,330].map((a,i) => <ellipse key={i} cx={30+Math.cos(a*Math.PI/180)*18} cy={30+Math.sin(a*Math.PI/180)*18} rx="4" ry="6" transform={`rotate(${a},${30+Math.cos(a*Math.PI/180)*18},${30+Math.sin(a*Math.PI/180)*18})`} fill={c} opacity="0.35"/>)}</g>,
    monogram: <g stroke={c} strokeWidth="1.2" fill="none"><circle cx="30" cy="30" r="20"/><text x="30" y="35" textAnchor="middle" fontSize="14" fill={c} fontFamily="Georgia,serif" stroke="none">A&amp;J</text></g>,
    corner: <g stroke={c} strokeWidth="1" fill="none"><path d="M5,5 Q20,5 20,20"/><ellipse cx="8" cy="14" rx="5" ry="3" transform="rotate(-45,8,14)" fill={c} opacity="0.4"/><ellipse cx="14" cy="8" rx="5" ry="3" transform="rotate(-45,14,8)" fill={c} opacity="0.4"/></g>,
    rings: <g stroke={c} strokeWidth="1.8" fill="none"><circle cx="24" cy="32" r="12"/><circle cx="36" cy="32" r="12"/></g>,
    champagne: <g stroke={c} strokeWidth="1.2" fill="none"><path d="M24,55 L24,38 Q24,28 30,20 Q36,28 36,38 L36,55"/><path d="M22,42 L38,42"/><path d="M30,20 L27,10 M30,20 L33,8"/><circle cx="27" cy="10" r="1.5" fill={c}/><circle cx="33" cy="8" r="1.5" fill={c}/></g>,
    bow: <g stroke={c} strokeWidth="1.2" fill="none"><path d="M30,30 Q20,20 10,25 Q15,30 30,30" fill={c} opacity="0.3"/><path d="M30,30 Q40,20 50,25 Q45,30 30,30" fill={c} opacity="0.3"/><path d="M30,30 Q20,40 10,35 Q15,30 30,30" fill={c} opacity="0.3"/><path d="M30,30 Q40,40 50,35 Q45,30 30,30" fill={c} opacity="0.3"/><circle cx="30" cy="30" r="3" fill={c}/></g>,
    heart: <g fill={c} opacity="0.6"><path d="M30,48 Q10,35 10,22 Q10,12 20,12 Q26,12 30,18 Q34,12 40,12 Q50,12 50,22 Q50,35 30,48Z"/></g>,
    dove: <g stroke={c} strokeWidth="1.2" fill="none"><path d="M30,35 Q18,30 15,22 Q20,18 28,22 Q26,16 32,14 Q38,16 36,22 Q44,18 46,24 Q42,30 30,35Z" fill={c} opacity="0.35"/><path d="M30,35 L28,48"/></g>,
  };
  return <svg viewBox="0 0 60 60" width={size} height={size}>{shapes[type] || <circle cx="30" cy="30" r="20" fill="none" stroke={c} strokeWidth="1.5"/>}</svg>;
}

// ─── Custom SVG illustration system ──────────────────────────────────────────
const _svgCache = {};

async function _fetchSvg(path) {
  if (_svgCache[path] !== undefined) return _svgCache[path];
  try {
    const res = await fetch(path);
    if (!res.ok) { _svgCache[path] = null; return null; }
    let t = await res.text();
    // Strip fixed width/height on root <svg> so it fills its container
    t = t.replace(/(<svg\b[^>]*?)\s+width="[^"]*"/i, "$1");
    t = t.replace(/(<svg\b[^>]*?)\s+height="[^"]*"/i, "$1");
    // Fit the container instead of defaulting to 100%-width (which lets tall
    // artwork overflow its box vertically and get clipped)
    t = t.replace(/<svg\b/i, '<svg style="width:100%;height:100%"');
    // Paths with no fill/stroke attributes default to black and ignore
    // recolouring — make them inherit currentColor from the root instead
    if (!/<svg\b[^>]*\bfill=/i.test(t)) t = t.replace(/<svg\b/i, '<svg fill="currentColor"');
    // Normalise explicit fill/stroke colours → currentColor (preserve none/transparent)
    t = t.replace(/\bfill="(?!none\b|transparent\b|currentColor\b)[^"]+"/g, 'fill="currentColor"');
    t = t.replace(/\bstroke="(?!none\b|transparent\b|currentColor\b)[^"]+"/g, 'stroke="currentColor"');
    t = t.replace(/\bfill\s*:\s*(?!none\b|transparent\b|currentColor\b)[^;}"]+/g, "fill:currentColor");
    t = t.replace(/\bstroke\s*:\s*(?!none\b|transparent\b|currentColor\b)[^;}"]+/g, "stroke:currentColor");
    _svgCache[path] = t;
    return t;
  } catch { _svgCache[path] = null; return null; }
}

const _svgBBoxFixed = {}; // srcs whose viewBox has been checked against real ink bounds

function CustomIllustration({ src, size = 60, width, height, color = "#9A8F85", stretch = false }) {
  const w = width ?? size, h = height ?? size;
  const hostRef = useRef(null);
  const [svg, setSvg] = useState(() => _svgCache[src] ?? undefined);
  useEffect(() => {
    if (_svgCache[src] !== undefined) { setSvg(_svgCache[src]); return; }
    _fetchSvg(src).then(setSvg);
  }, [src]);
  // Some exported SVGs declare a viewBox smaller than their artwork, clipping
  // the drawing. Measure the real ink bounds once per file and widen the
  // viewBox when the ink escapes it.
  useEffect(() => {
    if (!svg) return;
    const el = hostRef.current?.querySelector("svg");
    if (!el) return;
    try {
      if (!_svgBBoxFixed[src]) {
        const bb = el.getBBox();
        if (bb.width > 0 && bb.height > 0) {
          const vb = (el.getAttribute("viewBox") || "").split(/[\s,]+/).map(Number);
          const pad = Math.max(bb.width, bb.height) * 0.03 + 1;
          const nx = bb.x - pad, ny = bb.y - pad, nw = bb.width + 2*pad, nh = bb.height + 2*pad;
          const escapes = vb.length !== 4 ||
            nx < vb[0] - 1 || ny < vb[1] - 1 ||
            nx + nw > vb[0] + vb[2] + 1 || ny + nh > vb[1] + vb[3] + 1;
          if (escapes) {
            const fixed = _svgCache[src].replace(/<svg\b([^>]*?)\sviewBox="[^"]*"/i, "<svg$1")
              .replace(/<svg\b/i, `<svg viewBox="${nx.toFixed(2)} ${ny.toFixed(2)} ${nw.toFixed(2)} ${nh.toFixed(2)}"`);
            _svgCache[src] = fixed;
            _svgBBoxFixed[src] = true;
            setSvg(fixed);
            return;
          }
        }
        _svgBBoxFixed[src] = true;
      }
    } catch { /* getBBox can throw for detached/empty SVGs — leave as-is */ }
  }, [svg, src]);
  // stretch: fill the element's box exactly (used for frame borders sized to
  // non-native aspect ratios) instead of letterboxing to the SVG's own aspect
  const html = svg && stretch
    ? svg.replace(/<svg\b/i, '<svg preserveAspectRatio="none" style="width:100%;height:100%;display:block"')
    : svg;
  if (!svg) return (
    <div style={{width:w,height:h,borderRadius:4,display:"flex",alignItems:"center",justifyContent:"center",
      background:"rgba(138,123,108,0.08)"}}>
      <span style={{fontSize:9,color:"#C5B9AC"}}>…</span>
    </div>
  );
  return (
    <div ref={hostRef}
      style={{width:w,height:h,color,display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden",flexShrink:0}}
      className={stretch ? "ill-stretch" : undefined}
      dangerouslySetInnerHTML={{__html: html}}/>
  );
}

const CUSTOM_ILLUSTRATION_LIBRARY = [
  { category:"Baby Shower", items:[
    {id:"bs-blocks",   label:"Blocks",        file:"Baby Shower/Blocks.svg"       },
    {id:"bs-bottle",   label:"Bottle",        file:"Baby Shower/Bottle.svg"       },
    {id:"bs-bow",      label:"Bow",           file:"Baby Shower/Bow 5.svg"        },
    {id:"bs-bunny1",   label:"Bunny",         file:"Baby Shower/Bunny1.svg"       },
    {id:"bs-bunny2",   label:"Bunny 2",       file:"Baby Shower/Bunny2.svg"       },
    {id:"bs-bunny3",   label:"Bunny 3",       file:"Baby Shower/Bunny3.svg"       },
    {id:"bs-doves",    label:"Doves & Bow",   file:"Baby Shower/doves and bow.svg"},
    {id:"bs-hbird",    label:"Hummingbird",   file:"Baby Shower/Hummingbird.svg"  },
    {id:"bs-hbird2",   label:"Hummingbird 2", file:"Baby Shower/Hummingbird2.svg" },
    {id:"bs-onsie",    label:"Onesie",        file:"Baby Shower/Onsie.svg"        },
    {id:"bs-stork",    label:"Stork",         file:"Baby Shower/Stork.svg"        },
    {id:"bs-teddy",    label:"Teddy",         file:"Baby Shower/Teddy.svg"        }
  ]},
  { category:"Bottoms Up", items:[
    {id:"bu-beer",     label:"Beer",          file:"Bottoms Up/beer schooner.svg"        },
    {id:"bu-bmary",    label:"Bloody Mary",   file:"Bottoms Up/bloody mary.svg"          },
    {id:"bu-btmsup",   label:"Bottoms Up",    file:"Bottoms Up/Bottoms Up.svg"           },
    {id:"bu-chtower",  label:"Champagne Tower",file:"Bottoms Up/Champagne Tower.svg"     },
    {id:"bu-champ",    label:"Champagne",     file:"Bottoms Up/Champagne.svg"            },
    {id:"bu-martini",  label:"Martini",       file:"Bottoms Up/Martini.svg"              },
    {id:"bu-wbottle",  label:"Wine Bottle",   file:"Bottoms Up/Wine bottle and glass.svg"},
    {id:"bu-wgl2",     label:"Wine Glasses 2",file:"Bottoms Up/Wine glasses 2.svg"       },
    {id:"bu-wgl",      label:"Wine Glasses",  file:"Bottoms Up/wine glasses.svg"         },
    {id:"bu-wbow",     label:"Wine & Bow",    file:"Bottoms Up/Wine with bow.svg"        }
  ]},
  { category:"Bows", items:[
    {id:"bw-1",   label:"Bow 1",       file:"Bows/Bow 1.svg"         },
    {id:"bw-2",   label:"Bow 2",       file:"Bows/Bow 2.svg"         },
    {id:"bw-3",   label:"Bow 3",       file:"Bows/Bow 3.svg"         },
    {id:"bw-4",   label:"Bow 4",       file:"Bows/Bow 4.svg"         },
    {id:"bw-5",   label:"Bow 5",       file:"Bows/Bow 5.svg"         },
    {id:"bw-6",   label:"Bow 6",       file:"Bows/Bow 6.svg"         },
    {id:"bw-7",   label:"Bow 7",       file:"Bows/Bow 7.svg"         },
    {id:"bw-8",   label:"Bow 8",       file:"Bows/Bow 8.svg"         },
    {id:"bw-9",   label:"Bow 9",       file:"Bows/Bow 9.svg"         },
    {id:"bw-tie", label:"Bow Tie",     file:"Bows/Bow Tie.svg"       },
    {id:"bw-dvs", label:"Doves & Bow", file:"Bows/Doves and bow.svg" },
    {id:"bw-wine",label:"Wine & Bow",  file:"Bows/Wine with bow.svg" }
  ]},
  { category:"Coachella", items:[
    {id:"co-logo",    label:"Coachella",      file:"Coachella/Coachella_Coachella.svg"             },
    {id:"co-ferris",  label:"Ferris Wheel",   file:"Coachella/Coachella_Ferris Wheel.svg"          },
    {id:"co-flset",   label:"Flower Set",     file:"Coachella/Coachella_Flower set of 3.svg"       },
    {id:"co-fl",      label:"Flower",         file:"Coachella/Coachella_Flower single.svg"         },
    {id:"co-sunni",   label:"Heart Sunnies",  file:"Coachella/Coachella_Love Heart Sunnies.svg"    },
    {id:"co-heart",   label:"Love Heart",     file:"Coachella/Coachella_Love heart.svg"            },
    {id:"co-hearts",  label:"Love Hearts",    file:"Coachella/Coachella_Love hearts set of 3.svg"  },
    {id:"co-palm1",   label:"Palm Tree",      file:"Coachella/Coachella_Palm Tree 1.svg"           },
    {id:"co-palm2",   label:"Palm Tree 2",    file:"Coachella/Coachella_Palm Tree 2.svg"           },
    {id:"co-palms",   label:"Palm Trees",     file:"Coachella/Coachella_Palmer Tree Set of 4.svg"  },
    {id:"co-peace",   label:"Peace Sign",     file:"Coachella/Coachella_Peace Sign.svg"            },
    {id:"co-star1",   label:"Star 1",         file:"Coachella/Coachella_Star 1.svg"                },
    {id:"co-star2",   label:"Star 2",         file:"Coachella/Coachella_Star 2.svg"                },
    {id:"co-star3",   label:"Star 3",         file:"Coachella/Coachella_Star 3.svg"                },
    {id:"co-starset", label:"Stars",          file:"Coachella/Coachella_Star set of 3.svg"         },
    {id:"co-twk1",    label:"Twinkle Star 1", file:"Coachella/Coachella_Twinkling Star 1.svg"      },
    {id:"co-twk2",    label:"Twinkle Star 2", file:"Coachella/Coachella_Twinkling Star 2.svg"      },
    {id:"co-twk3",    label:"Twinkle Star 3", file:"Coachella/Coachella_Twinkling Star 3.svg"      },
    {id:"co-twkset",  label:"Twinkle Stars",  file:"Coachella/Coachella_Twinkling Star set of 3.svg"}
  ]},
  { category:"Feast", items:[
    {id:"fe-bag",    label:"Baguette",    file:"Feast/Baguette.svg"    },
    {id:"fe-cake",   label:"Cake Slice",  file:"Feast/Cake Slice.svg"  },
    {id:"fe-fish",   label:"Fish",        file:"Feast/Fish.svg"        },
    {id:"fe-feast",  label:"Let's Feast", file:"Feast/Lets Feast.svg"  },
    {id:"fe-olive",  label:"Olives",      file:"Feast/Olives.svg"      },
    {id:"fe-oyster", label:"Oyster",      file:"Feast/Oyster.svg"      },
    {id:"fe-radish", label:"Radish",      file:"Feast/radish.svg"      },
    {id:"fe-tomato", label:"Tomato",      file:"Feast/tomato.svg"      }
  ]},
  { category:"La Dolce Vita", items:[
    {id:"ldv-car",      label:"Car",          file:"La Dolce Vita/Car.svg"                  },
    {id:"ldv-border",   label:"Checkered",    file:"La Dolce Vita/Checkerd Border.svg"      },
    {id:"ldv-ciao",     label:"Ciao",         file:"La Dolce Vita/Ciao.svg"                 },
    {id:"ldv-farfalle",label:"Pasta",         file:"La Dolce Vita/Farfalle_Bowtie pasta.svg"},
    {id:"ldv-glasses",  label:"Glasses",      file:"La Dolce Vita/Glasses.svg"              },
    {id:"ldv-ldv",      label:"La Dolce Vita",file:"La Dolce Vita/La Dolce Vita.svg"        },
    {id:"ldv-lem1",     label:"Lemon 1",      file:"La Dolce Vita/Lemon 1.svg"              },
    {id:"ldv-lem2",     label:"Lemon 2",      file:"La Dolce Vita/Lemon 2.svg"              },
    {id:"ldv-lem3",     label:"Lemon 3",      file:"La Dolce Vita/Lemon 3.svg"              },
    {id:"ldv-lem4",     label:"Lemon 4",      file:"La Dolce Vita/Lemon 4.svg"              },
    {id:"ldv-mangia",   label:"Mangia",       file:"La Dolce Vita/Mangia.svg"               },
    {id:"ldv-mutti",    label:"Mutti Can",    file:"La Dolce Vita/Mutti Can.svg"            },
    {id:"ldv-saluti",   label:"Saluti",       file:"La Dolce Vita/Saluti.svg"               },
    {id:"ldv-spritz",   label:"Spritz",       file:"La Dolce Vita/Spritz.svg"               },
    {id:"ldv-tomato",   label:"Tomato",       file:"La Dolce Vita/Tomato.svg"               },
    {id:"ldv-tomatoes", label:"Tomatoes",     file:"La Dolce Vita/Tomatoes.svg"             },
    {id:"ldv-umbrella", label:"Umbrella",     file:"La Dolce Vita/Umbrella.svg"             },
    {id:"ldv-vespa",    label:"Vespa",        file:"La Dolce Vita/Vespa.svg"                },
    {id:"ldv-vino",     label:"Vino",         file:"La Dolce Vita/Vino.svg"                 }
  ]},
  { category:"Western", items:[
    {id:"we-cactus",   label:"Cactus",      file:"Western/cactus.svg"      },
    {id:"we-cboot",    label:"Cowboy Boot", file:"Western/cowboy boot.svg" },
    {id:"we-chat",     label:"Cowboy Hat",  file:"Western/cowboy hat.svg"  },
    {id:"we-horse",    label:"Horse",       file:"Western/horse.svg"       },
    {id:"we-hshoe",    label:"Horse Shoe",  file:"Western/horse shoe.svg"  },
    {id:"we-star",     label:"Star",        file:"Western/star.svg"        },
    {id:"we-ww",       label:"Wild West",   file:"Western/wild west.svg"   }
  ]},
  { category:"Swan Lake", items:[
    {id:"sw-swan",   label:"Swan",         file:"Swan Lake/Swan.svg"         },
    {id:"sw-frame",  label:"Frame Border", file:"Swan Lake/Frame Border.svg" },
    {id:"sw-ashford-short", label:"Ashford Border (Short)", file:"Swan Lake/Ashford Border Short.svg" },
    {id:"sw-ashford-swan",  label:"Ashford Border (Swan)",  file:"Swan Lake/Ashford Border Swan.svg"  }
  ]},
];

// ─── Templates ────────────────────────────────────────────────────────────────
const TEMPLATES = [
  { id:"swan-lake", collection:"swan-lake", name:"Option 1", category:"wedding-welcome", availableSizes:["a1","700x1400","700x2000","700x3000","1400x2000"], sizeKey:"700x2000", background:"#FFFFFF", elements:[
    {id:"el-1777083452047",type:"text",content:"M",x:35.03141276041666,y:311.3136882129278,fontSize:67,fontId:"mozart",italic:false,align:"center",color:"#1A1610",width:162,lineHeight:1.1,rotation:0},
    {id:"el-1777083452048",type:"text",content:"ONIQUE",x:197.03141276041669,y:333.3136882129278,fontSize:45,fontId:"dubiel",italic:false,align:"left",color:"#3A3028",width:311,letterSpacing:3,lineHeight:1.5,rotation:0},
    {id:"sl5",type:"text",content:"J",x:93.10131412152317,y:448.7243346007604,fontSize:67,fontId:"mozart",italic:false,align:"center",color:"#1A1610",width:162,lineHeight:1.1,rotation:0},
    {id:"el-1777083472651",type:"text",content:"&",x:35.03141276041666,y:401.7243346007604,fontSize:47,fontId:"mozart",italic:false,align:"center",color:"#1A1610",width:149,lineHeight:1.1,rotation:0},
    {id:"el-1777083405654",type:"text",content:"AMES",x:216.17377788963915,y:482.2243346007604,fontSize:45,fontId:"dubiel",italic:false,align:"left",color:"#3A3028",width:311,letterSpacing:3,lineHeight:1.5,rotation:0},
    {id:"sl7",type:"text",content:"29 NOVEMBER 2025",x:-11.5,y:617.1029371245936,fontSize:12,fontId:"dubiel",italic:false,align:"center",color:"#3A3028",width:423,letterSpacing:3,lineHeight:1.5,rotation:0}
  ]},
  { id:"fleur", collection:"fleur", name:"Option 1", category:"wedding-welcome", availableSizes:["700x1400","700x2000","700x3000","1400x2000"], sizeKey:"700x2000", background:"#FFFFFF", elements:[
    {id:"fl1",type:"text",content:"WELCOME TO \nTHE WEDDING OF",x:-32,y:183.9855072463768,fontSize:12,fontId:"jost",italic:false,align:"center",color:"#3A3028",width:464,letterSpacing:3,lineHeight:1.5,rotation:0},
    {id:"fl2",type:"text",content:"&nbsp; Emm<span style=\"font-feature-settings: &quot;ss03&quot;;\"><span style=\"font-feature-settings: &quot;ss04&quot;;\">a</span></span><br>&amp;<br>Adria<span style=\"font-feature-settings: &quot;ss04&quot;;\">n</span>",x:-142.5,y:307.37681159420293,fontSize:145,fontId:"madison",italic:false,align:"center",color:"#1A1610",width:685,lineHeight:0.6,rotation:0},
    {id:"fl6",type:"text",content:"12 JUNE 2025",x:-20.5,y:656.4492753623189,fontSize:13,fontId:"jost",italic:false,align:"center",color:"#3A3028",width:441,letterSpacing:3,lineHeight:1.5,rotation:0}
  ]},
  { id:"whimsy-wedding", collection:"whimsy", name:"Option 1", category:"wedding-welcome", availableSizes:["700x1400","700x2000","700x3000","1400x2000"], sizeKey:"700x2000", background:"#FFFFFF", elements:[
    {id:"el-1779850478431",type:"text",content:"Jessica<br>&amp;<br>Daniel",x:-216.068,y:276.106,fontSize:149,fontId:"whimsy",italic:false,align:"center",color:"#741717",width:809,lineHeight:0.7,rotation:0},
    {id:"ill-1780644112184",type:"illustration",illustrationId:null,illustrationSrc:"/illustrations/Bows/Doves and bow.svg",label:"Doves & Bow",x:95.868,y:32.293,width:192.537,height:192.537,color:"#741717",rotation:0,hidden:true},
    {id:"ill-1780644183736",type:"illustration",illustrationId:null,illustrationSrc:"/illustrations/Bows/Bow 7.svg",label:"Bow 7",x:218.406,y:618.413,width:140,height:140,color:"#741717",rotation:0},
    {id:"ill-1780644200157",type:"illustration",illustrationId:null,illustrationSrc:"/illustrations/Bottoms Up/Wine with bow.svg",label:"Wine & Bow",x:43.033,y:661.995,width:52.836,height:52.836,color:"#741717",rotation:0},
    {id:"ill-1780644223269",type:"illustration",illustrationId:null,illustrationSrc:"/illustrations/Bottoms Up/Champagne Tower.svg",label:"Champagne Tower",x:130,y:793.731,width:140,height:140,color:"#741717",rotation:0},
    {id:"ill-1780644272842",type:"illustration",illustrationId:null,illustrationSrc:"/illustrations/Baby Shower/doves and bow.svg",label:"Doves & Bow",x:106.119,y:42.687,width:187.761,height:187.761,color:"#741717",rotation:0}
  ]},
  { id:"secret-garden", collection:"secret-garden", name:"Option 1", category:"wedding-welcome", availableSizes:["700x1400","700x2000","700x3000","1400x2000"], sizeKey:"700x2000", background:"#FFFFFF", elements:[
    {id:"sg1",type:"text",content:"JOIN US IN THE GARDEN OF",x:0,y:185,fontSize:10,fontId:"jost",italic:false,align:"center",color:"#687A56",width:400,letterSpacing:3,lineHeight:1.5,rotation:0},
    {id:"sg2",type:"text",content:"Jaime",x:0,y:238,fontSize:145,fontId:"madison",italic:false,align:"center",color:"#2E3D20",width:400,lineHeight:1.1,rotation:0},
    {id:"sg3",type:"text",content:"&",x:0,y:390,fontSize:95,fontId:"pinyon",italic:false,align:"center",color:"#687A56",width:400,lineHeight:1.0,rotation:0},
    {id:"sg4",type:"text",content:"Brandon",x:0,y:482,fontSize:130,fontId:"madison",italic:false,align:"center",color:"#2E3D20",width:400,lineHeight:1.1,rotation:0},
    {id:"sg5",type:"text",content:"14 JUNE 2025",x:0,y:660,fontSize:12,fontId:"jost",italic:false,align:"center",color:"#8A9C78",width:400,letterSpacing:3,lineHeight:1.5,rotation:0}
  ]},

  // ─── Swan Lake suite — generated batch (see Template Batch Creator project) ───
  // ── Swan Lake stationery collection (generated_v3) ──
  // ⟦generated-collection:swan-lake START⟧ — auto-managed by splice_templates.py, do not hand-edit
  { id:"sw00", collection:"swan-lake", name:"Front Option 1", category:"save-the-date", availableSizes:["a5"], sizeKey:"a5", background:"#FFFFFF", elements:[
      {"id": "sw00-border", "type": "illustration", "illustrationId": "border-sw00", "illustrationSrc": "/borders/sw00-border.svg?v=1783853115", "label": "Border", "x": 23.5, "y": 23.5, "width": 353.1, "height": 520.6, "color": "#030505", "rotation": 0, "stretch": true, "locked": true},
      {"id": "sw00-t0", "type": "text", "content": "&", "x": 134.4, "y": 375.1, "fontSize": 21, "fontId": "mozart-light", "italic": false, "align": "left", "color": "#000000", "width": 26.6, "lineHeight": 1.2, "rotation": 0},
      {"id": "sw00-t1", "type": "text", "content": "<span style=\"font-feature-settings: &quot;ss02&quot;;\">s</span>", "x": 247.6, "y": 407.7, "fontSize": 21.6, "fontId": "mozart-light", "italic": false, "align": "left", "color": "#000000", "width": 18.9, "lineHeight": 1.2, "rotation": 0},
      {"id": "sw00-t2", "type": "text", "content": "AME", "x": 212.4, "y": 412.4, "fontSize": 15.7, "fontId": "dubiel", "italic": false, "align": "left", "color": "#000000", "width": 83.1, "lineHeight": 1.2, "rotation": 0},
      {"id": "sw00-t3", "type": "text", "content": "ONIQUE", "x": 194.3, "y": 355.4, "fontSize": 15.7, "fontId": "dubiel", "italic": false, "align": "left", "color": "#000000", "width": 83.1, "lineHeight": 1.2, "rotation": 0},
      {"id": "sw00-t4", "type": "text", "content": "J", "x": 170.4, "y": 384.1, "fontSize": 30.8, "fontId": "mozart-light", "italic": false, "align": "left", "color": "#000000", "width": 138.8, "lineHeight": 1.2, "rotation": 0},
      {"id": "sw00-t5", "type": "text", "content": "M", "x": 123.9, "y": 335.6, "fontSize": 30.8, "fontId": "mozart-light", "italic": false, "align": "left", "color": "#000000", "width": 138.8, "lineHeight": 1.2, "rotation": 0},
      {"id": "sw00-t6", "type": "text", "content": "D", "x": 212, "y": 208.8, "fontSize": 56.3, "fontId": "mozart-light", "italic": false, "align": "left", "color": "#000000", "width": 158.1, "lineHeight": 1.2, "rotation": 0},
      {"id": "sw00-t7", "type": "text", "content": "S", "x": 86.5, "y": 199, "fontSize": 56.3, "fontId": "mozart-light", "italic": false, "align": "left", "color": "#000000", "width": 158.1, "lineHeight": 1.2, "rotation": 0},
      {"id": "sw00-t8", "type": "text", "content": "AVE", "x": 158.1, "y": 222.1, "fontSize": 17.2, "fontId": "dubiel", "italic": false, "align": "center", "color": "#000000", "width": 43.9, "lineHeight": 1.2, "rotation": 0},
      {"id": "sw00-t9", "type": "text", "content": "THE", "x": 170.9, "y": 246.7, "fontSize": 17.2, "fontId": "dubiel", "italic": false, "align": "center", "color": "#000000", "width": 43.9, "lineHeight": 1.2, "rotation": 0},
      {"id": "sw00-t10", "type": "text", "content": "ATE", "x": 266.4, "y": 263, "fontSize": 17.2, "fontId": "dubiel", "italic": false, "align": "center", "color": "#000000", "width": 43.9, "lineHeight": 1.2, "rotation": 0},
      {"id": "sw00-t11", "type": "text", "content": "FOR THE WEDDING OF", "x": 0, "y": 297.9, "fontSize": 11.4, "fontId": "dubiel", "italic": false, "align": "center", "color": "#000000", "width": 400, "lineHeight": 1.2, "rotation": 0},
      {"id": "sw00-t12", "type": "text", "content": "12 October 2025", "x": 105.2, "y": 118.6, "fontSize": 14.3, "fontId": "mozart", "italic": false, "align": "center", "color": "#000000", "width": 184.3, "lineHeight": 1.2, "rotation": 0},
      {"id": "sw00-t13", "type": "text", "content": "FORMAL INVITATION\nTO FOLLOW", "x": 0, "y": 451.5, "fontSize": 11.4, "fontId": "dubiel", "italic": false, "align": "center", "color": "#000000", "width": 400, "lineHeight": 1.33, "rotation": 0}
    ]},
  { id:"sw01", collection:"swan-lake", name:"Back Option 1", category:"save-the-date", availableSizes:["a5"], sizeKey:"a5", background:"#FFFFFF", elements:[
      {id:"sw01-aw1",type:"image",src:"/artwork/Lake.png?v=1783853115",fit:"fill",x:0.0,y:0.0,width:400.0,height:567.6,rotation:0},
      {id:"sw01-aw0",type:"image",src:"/artwork/Double Swan copy.png?v=1783853115",fit:"fill",x:80.2,y:358.5,width:239.6,height:155.4,rotation:0},
      {id:"sw01-t0",type:"text",content:"&",x:164.9,y:174.3,fontSize:25.7,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:38.6,lineHeight:1.2,rotation:0},
      {id:"sw01-t1",type:"text",content:"J",x:169.2,y:188.8,fontSize:39.1,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:67.2,lineHeight:1.2,rotation:0},
      {id:"sw01-t2",type:"text",content:"M",x:156.6,y:139.3,fontSize:37.2,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:90.3,lineHeight:1.2,rotation:0}
    ]},
  { id:"sw02", collection:"swan-lake", name:"Front Option 2", category:"save-the-date", availableSizes:["a5"], sizeKey:"a5", background:"#FFFFFF", elements:[
      {id:"sw02-aw0",type:"image",src:"/artwork/Double Swan copy.png?v=1783853115",fit:"fill",x:83.8,y:363.0,width:239.4,height:164.3,rotation:0},
      {id:"sw02-t0",type:"text",content:"FORMAL INVITATION TO FOLLOW",x:0.4,y:337.9,fontSize:9.4,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:399.6,lineHeight:1.2,rotation:0},
      {id:"sw02-t1",type:"text",content:"SAVE THE DATE FOR THE WEDDING OF",x:0.4,y:56.7,fontSize:9.4,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:399.6,lineHeight:1.2,rotation:0},
      {id:"sw02-t2",type:"text",content:"Monique Wells\nand\nJames Graham",x:0.4,y:109.8,fontSize:31.7,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:399.6,lineHeight:1.44,rotation:0},
      {id:"sw02-t3",type:"text",content:"12 October 2025",x:0.4,y:282.5,fontSize:17.6,fontId:"mozart",italic:false,align:"center",color:"#000000",width:399.6,lineHeight:1.2,rotation:0}
    ]},
  { id:"sw03", collection:"swan-lake", name:"Back Option 2", category:"save-the-date", availableSizes:["a5"], sizeKey:"a5", background:"#FFFFFF", elements:[
      {id:"sw03-r0",type:"image",src:"/raster/sw03-r0.png?v=1783853115",fit:"fill",x:0.0,y:0.0,width:400.0,height:567.6,rotation:0},
      {id:"sw03-t0",type:"text",content:"&",x:-34.7,y:239.4,fontSize:123.9,fontId:"mozart-light",italic:false,align:"right",color:"#000000",width:176.4,lineHeight:1.2,rotation:0},
      {id:"sw03-t1",type:"text",content:"J",x:-12.5,y:302.2,fontSize:183.1,fontId:"mozart-light",italic:false,align:"right",color:"#000000",width:368.2,lineHeight:1.2,rotation:0},
      {id:"sw03-t2",type:"text",content:"M",x:-72.2,y:72.1,fontSize:179.2,fontId:"mozart-light",italic:false,align:"right",color:"#000000",width:433.6,lineHeight:1.2,rotation:0}
    ]},
  { id:"sw04", collection:"swan-lake", name:"Front Option 1", category:"save-the-date", availableSizes:["120x180"], sizeKey:"120x180", background:"#FFFFFF", elements:[
      {id:"sw04-border",type:"illustration",illustrationId:"border-sw04",illustrationSrc:"/borders/sw04-border.svg?v=1783853115",label:"Border",x:25.5,y:25.5,width:348.9,height:549.5,color:"#030505",rotation:0,stretch:true},
      {id:"sw04-t0",type:"text",content:"&",x:132.3,y:401.2,fontSize:22.1,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:28.0,lineHeight:1.2,rotation:0},
      {id:"sw04-t1",type:"text",content:"<span style=\"font-feature-settings: &quot;ss02&quot;;\">s</span>",x:250.6,y:431.3,fontSize:22.8,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:19.9,lineHeight:1.2,rotation:0},
      {id:"sw04-t2",type:"text",content:"AME",x:214.5,y:440.4,fontSize:16.6,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:87.5,lineHeight:1.2,rotation:0},
      {id:"sw04-t3",type:"text",content:"ONIQUE",x:195.4,y:380.4,fontSize:16.6,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:87.5,lineHeight:1.2,rotation:0},
      {id:"sw04-t4",type:"text",content:"J",x:170.3,y:410.6,fontSize:32.5,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:146.2,lineHeight:1.2,rotation:0},
      {id:"sw04-t5",type:"text",content:"M",x:121.3,y:359.6,fontSize:32.5,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:146.2,lineHeight:1.2,rotation:0},
      {id:"sw04-t6",type:"text",content:"D",x:214.4,y:229.8,fontSize:58.5,fontId:"mozart",italic:false,align:"left",color:"#000000",width:164.3,lineHeight:1.2,rotation:0},
      {id:"sw04-t7",type:"text",content:"S",x:36.8,y:212.0,fontSize:58.5,fontId:"mozart",italic:false,align:"left",color:"#000000",width:164.3,lineHeight:1.2,rotation:0},
      {id:"sw04-t8",type:"text",content:"AVE",x:158.3,y:243.6,fontSize:17.8,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:45.6,lineHeight:1.2,rotation:0},
      {id:"sw04-t9",type:"text",content:"THE",x:171.7,y:269.2,fontSize:17.8,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:45.6,lineHeight:1.2,rotation:0},
      {id:"sw04-t10",type:"text",content:"ATE",x:270.9,y:286.2,fontSize:17.8,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:45.6,lineHeight:1.2,rotation:0},
      {id:"sw04-t11",type:"text",content:"FOR THE WEDDING OF",x:-8.3,y:321.8,fontSize:11.9,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:415.7,lineHeight:1.2,rotation:0},
      {id:"sw04-t12",type:"text",content:"Saturday12 \n12 October 2025",x:0.0,y:96.4,fontSize:17.6,fontId:"mozart",italic:false,align:"center",color:"#000000",width:400.0,lineHeight:2.0,rotation:0},
      {id:"sw04-t13",type:"text",content:"formal invitation\nto follow",x:0.0,y:491.4,fontSize:11.9,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:400.0,lineHeight:1.33,rotation:0}
    ]},
  { id:"sw05", collection:"swan-lake", name:"Back Option 1", category:"save-the-date", availableSizes:["120x180"], sizeKey:"120x180", background:"#FFFFFF", elements:[
      {id:"sw05-aw1",type:"image",src:"/artwork/Lake.png?v=1783853115",fit:"fill",x:0.0,y:0.0,width:400.0,height:600.0,rotation:0},
      {id:"sw05-aw0",type:"image",src:"/artwork/Double Swan copy.png?v=1783853115",fit:"fill",x:80.2,y:379.3,width:239.6,height:164.4,rotation:0},
      {id:"sw05-t0",type:"text",content:"&",x:154.5,y:196.4,fontSize:31.7,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:47.6,lineHeight:1.2,rotation:0},
      {id:"sw05-t1",type:"text",content:"J",x:159.8,y:214.4,fontSize:48.2,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:82.9,lineHeight:1.2,rotation:0},
      {id:"sw05-t2",type:"text",content:"M",x:144.3,y:153.3,fontSize:45.9,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:111.4,lineHeight:1.2,rotation:0}
    ]},
  { id:"sw06", collection:"swan-lake", name:"Front Option 2", category:"save-the-date", availableSizes:["120x180"], sizeKey:"120x180", background:"#FFFFFF", elements:[
      {id:"sw06-r0",type:"image",src:"/raster/sw06-r0.png?v=1783853115",fit:"fill",x:0.0,y:0.3,width:400.0,height:599.7,rotation:0},
      {id:"sw06-aw0",type:"image",src:"/artwork/Double Swan copy.png?v=1783853115",fit:"fill",x:83.5,y:379.5,width:239.6,height:164.4,rotation:0},
      {id:"sw06-t0",type:"text",content:"FORMAL INVITATION TO FOLLOW",x:0.0,y:354.4,fontSize:9.4,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:400.0,lineHeight:1.2,rotation:0},
      {id:"sw06-t1",type:"text",content:"SAVE THE DATE FOR THE WEDDING OF",x:0.0,y:72.9,fontSize:9.4,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:400.0,lineHeight:1.2,rotation:0},
      {id:"sw06-t2",type:"text",content:"Monique Wells\nand\nJames Graham",x:0.0,y:126.0,fontSize:31.7,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:400.0,lineHeight:1.44,rotation:0},
      {id:"sw06-t3",type:"text",content:"12 October 2025",x:0.0,y:298.9,fontSize:17.6,fontId:"mozart",italic:false,align:"center",color:"#000000",width:400.0,lineHeight:1.2,rotation:0}
    ]},
  { id:"sw07", collection:"swan-lake", name:"Back Option 2", category:"save-the-date", availableSizes:["120x180"], sizeKey:"120x180", background:"#FFFFFF", elements:[
      {id:"sw07-r0",type:"image",src:"/raster/sw07-r0.png?v=1783853115",fit:"fill",x:0.0,y:0.0,width:400.0,height:600.0,rotation:0},
      {id:"sw07-t0",type:"text",content:"&",x:-35.1,y:253.0,fontSize:131.0,fontId:"mozart-light",italic:false,align:"right",color:"#000000",width:176.6,lineHeight:1.2,rotation:0},
      {id:"sw07-t1",type:"text",content:"J",x:-12.9,y:319.4,fontSize:193.5,fontId:"mozart-light",italic:false,align:"right",color:"#000000",width:368.6,lineHeight:1.2,rotation:0},
      {id:"sw07-t2",type:"text",content:"M",x:-72.7,y:76.2,fontSize:189.4,fontId:"mozart-light",italic:false,align:"right",color:"#000000",width:434.1,lineHeight:1.2,rotation:0}
    ]},
  { id:"sw08", collection:"swan-lake", name:"Front Option 1", category:"save-the-date", availableSizes:["120x120"], sizeKey:"120x120", background:"#FFFFFF", elements:[
      {id:"sw08-art3",type:"image",src:"/raster/sw08-art3.png?v=1783853115",fit:"fill",x:52.3,y:42.8,width:139.0,height:126.5,rotation:0},
      {id:"sw08-art4",type:"image",src:"/raster/sw08-art4.png?v=1783853115",fit:"fill",x:52.3,y:42.8,width:139.0,height:126.5,rotation:0},
      {id:"sw08-art5",type:"image",src:"/raster/sw08-art5.png?v=1783853115",fit:"fill",x:52.3,y:42.8,width:139.0,height:126.5,rotation:0},
      {id:"sw08-art0",type:"image",src:"/raster/sw08-art0.png?v=1783853115",fit:"fill",x:187.2,y:66.9,width:152.4,height:103.4,rotation:0},
      {id:"sw08-art1",type:"image",src:"/raster/sw08-art1.png?v=1783853115",fit:"fill",x:187.2,y:66.9,width:152.4,height:103.4,rotation:0},
      {id:"sw08-art2",type:"image",src:"/raster/sw08-art2.png?v=1783853115",fit:"fill",x:187.2,y:66.9,width:152.4,height:103.4,rotation:0},
      {id:"sw08-art6",type:"image",src:"/raster/sw08-art6.png?v=1783853115",fit:"fill",x:158.3,y:107.4,width:38.2,height:12.9,rotation:0},
      {id:"sw08-art7",type:"image",src:"/raster/sw08-art7.png?v=1783853115",fit:"fill",x:169.8,y:135.2,width:37.4,height:12.8,rotation:0},
      {id:"sw08-t0",type:"text",content:"&",x:187.1,y:242.6,fontSize:21.4,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:27.1,lineHeight:1.2,rotation:0},
      {id:"sw08-t1",type:"text",content:"<span style=\"font-feature-settings: &quot;ss02&quot;;\">s</span>",x:312.7,y:246.2,fontSize:22.1,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:19.3,lineHeight:1.2,rotation:0},
      {id:"sw08-t2",type:"text",content:"AME",x:277.8,y:255.0,fontSize:16.1,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:84.8,lineHeight:1.2,rotation:0},
      {id:"sw08-t3",type:"text",content:"ONIQUE",x:123.1,y:255.0,fontSize:16.1,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:84.8,lineHeight:1.2,rotation:0},
      {id:"sw08-t4",type:"text",content:"J",x:226.6,y:234.8,fontSize:31.5,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:141.7,lineHeight:1.2,rotation:0},
      {id:"sw08-t5",type:"text",content:"M",x:51.3,y:234.8,fontSize:31.5,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:141.7,lineHeight:1.2,rotation:0},
      {id:"sw08-t6",type:"text",content:"FOR THE WEDDING OF",x:0.0,y:195.7,fontSize:11.9,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:400.0,lineHeight:1.2,rotation:0},
      {id:"sw08-t7",type:"text",content:"12 October 2025",x:0.0,y:302.7,fontSize:17.6,fontId:"mozart",italic:false,align:"center",color:"#000000",width:400.0,lineHeight:1.2,rotation:0},
      {id:"sw08-t8",type:"text",content:"FORMAL INVITATION TO FOLLOW",x:0.0,y:344.4,fontSize:11.9,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:400.0,lineHeight:1.2,rotation:0}
    ]},
  { id:"sw09", collection:"swan-lake", name:"Back Option 1", category:"save-the-date", availableSizes:["120x120"], sizeKey:"120x120", background:"#FFFFFF", elements:[
      {id:"sw09-aw0",type:"image",src:"/artwork/Lake.png?v=1783853115",fit:"fill",x:-0.1,y:0.0,width:400.1,height:400.0,rotation:0},
      {id:"sw09-r0",type:"image",src:"/raster/sw09-r0.png?v=1783853115",fit:"fill",x:0.0,y:195.1,width:323.4,height:204.9,rotation:0},
      {id:"sw09-art0",type:"image",src:"/raster/sw09-art0.png?v=1783853115",fit:"fill",x:168.3,y:0.0,width:231.7,height:151.9,rotation:0},
      {id:"sw09-art1",type:"image",src:"/raster/sw09-art1.png?v=1783853115",fit:"fill",x:215.8,y:136.2,width:184.2,height:167.1,rotation:0},
      {id:"sw09-art2",type:"image",src:"/raster/sw09-art2.png?v=1783853115",fit:"fill",x:215.8,y:136.2,width:184.2,height:167.1,rotation:0},
      {id:"sw09-art3",type:"image",src:"/raster/sw09-art3.png?v=1783853115",fit:"fill",x:173.3,y:95.9,width:131.0,height:122.0,rotation:0},
      {id:"sw09-art4",type:"image",src:"/raster/sw09-art4.png?v=1783853115",fit:"fill",x:173.3,y:95.9,width:131.0,height:122.0,rotation:0}
    ]},
  { id:"sw10", collection:"swan-lake", name:"Front Option 2", category:"save-the-date", availableSizes:["120x120"], sizeKey:"120x120", background:"#FFFFFF", elements:[
      {id:"sw10-t0",type:"text",content:"FORMAL INVITATION TO FOLLOW",x:0.0,y:334.3,fontSize:9.4,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:400.0,lineHeight:1.2,rotation:0},
      {id:"sw10-t1",type:"text",content:"SAVE THE DATE FOR THE WEDDING OF",x:0.0,y:52.8,fontSize:9.4,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:400.0,lineHeight:1.2,rotation:0},
      {id:"sw10-t2",type:"text",content:"Monique Wells\nand\nJames Graham",x:0.0,y:105.9,fontSize:31.7,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:400.0,lineHeight:1.44,rotation:0},
      {id:"sw10-t3",type:"text",content:"12 October 2025",x:0.0,y:278.8,fontSize:17.6,fontId:"mozart",italic:false,align:"center",color:"#000000",width:400.0,lineHeight:1.2,rotation:0}
    ]},
  { id:"sw11", collection:"swan-lake", name:"Back Option 2", category:"save-the-date", availableSizes:["120x120"], sizeKey:"120x120", background:"#FFFFFF", elements:[
      {id:"sw11-r0",type:"image",src:"/raster/sw11-r0.png?v=1783853115",fit:"fill",x:0.0,y:0.0,width:400.0,height:400.0,rotation:0},
      {id:"sw11-t0",type:"text",content:"&",x:128.5,y:194.6,fontSize:37.6,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:47.6,lineHeight:1.2,rotation:0},
      {id:"sw11-t1",type:"text",content:"J",x:145.7,y:214.5,fontSize:55.3,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:248.8,lineHeight:1.2,rotation:0},
      {id:"sw11-t2",type:"text",content:"M",x:122.0,y:143.7,fontSize:55.3,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:248.8,lineHeight:1.2,rotation:0}
    ]},
  { id:"sw12", collection:"swan-lake", name:"Front Option 1", category:"invite", availableSizes:["a5"], sizeKey:"a5", background:"#FFFFFF", elements:[
      {id:"sw12-border",type:"illustration",illustrationId:"border-sw12",illustrationSrc:"/borders/sw12-border.svg?v=1783853115",label:"Border",x:23.9,y:20.3,width:355.1,height:521.8,color:"#030505",rotation:0,stretch:true},
      {id:"sw12-t0",type:"text",content:"PLEASE JOIN US \nTO CELEBRATE THE MARRIAGE OF",x:0.0,y:90.8,fontSize:8.6,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:400.0,lineHeight:2.0,rotation:0},
      {id:"sw12-t1",type:"text",content:"&",x:102.9,y:235.3,fontSize:30.5,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:38.6,lineHeight:1.2,rotation:0},
      {id:"sw12-t2",type:"text",content:"<span style=\"font-feature-settings: &quot;ss02&quot;;\">s</span>",x:266.1,y:276.9,fontSize:31.5,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:27.4,lineHeight:1.2,rotation:0},
      {id:"sw12-t3",type:"text",content:"AME",x:216.4,y:289.5,fontSize:22.9,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:120.8,lineHeight:1.2,rotation:0},
      {id:"sw12-t4",type:"text",content:"ONIQUE",x:190.0,y:206.6,fontSize:22.9,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:79.2,lineHeight:1.2,rotation:0},
      {id:"sw12-t5",type:"text",content:"J",x:155.4,y:248.3,fontSize:44.8,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:81.4,lineHeight:1.2,rotation:0},
      {id:"sw12-t6",type:"text",content:"M",x:87.7,y:177.9,fontSize:44.8,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:105.5,lineHeight:1.2,rotation:0},
      {id:"sw12-t7",type:"text",content:"12 October 2025",x:105.2,y:376.4,fontSize:14.3,fontId:"mozart",italic:false,align:"center",color:"#000000",width:184.3,lineHeight:1.2,rotation:0},
      {id:"sw12-t8",type:"text",content:"REDLEAF WOLLOMBI\nCEREMONY COMMENCES AT 4PM\nRSVP BY 12 AUGUST 2026\nBLACK TIE",x:0.0,y:422.8,fontSize:8.6,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:400.0,lineHeight:1.78,rotation:0}
    ]},
  { id:"sw13", collection:"swan-lake", name:"Back Option 1", category:"invite", availableSizes:["a5"], sizeKey:"a5", background:"#FFFFFF", elements:[
      {id:"sw13-aw1",type:"image",src:"/artwork/Lake.png?v=1783853115",fit:"fill",x:0.0,y:0.0,width:400.0,height:567.6,rotation:0},
      {id:"sw13-aw0",type:"image",src:"/artwork/Double Swan copy.png?v=1783853115",fit:"fill",x:35.1,y:130.3,width:308.9,height:212.0,rotation:0},
      {id:"sw13-art0",type:"image",src:"/raster/sw13-art0.png?v=1783853115",fit:"fill",x:100.2,y:371.3,width:210.6,height:132.8,rotation:0},
      {id:"sw13-t0",type:"text",content:"TO BE WED",x:0.6,y:72.6,fontSize:8.6,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:400.0,lineHeight:1.2,rotation:0}
    ]},
  { id:"sw14", collection:"swan-lake", name:"Front Option 2", category:"invite", availableSizes:["a5"], sizeKey:"a5", background:"#FFFFFF", elements:[
      {id:"sw14-t0",type:"text",content:"FOR MORE DETAILS & TO RSVP PLEASE VISIT\nMONIQUEANDJAMES.COM.AU",x:205.9,y:458.6,fontSize:8.6,fontId:"dubiel",italic:false,align:"right",color:"#000000",width:143.7,lineHeight:1.78,rotation:0},
      {id:"sw14-t1",type:"text",content:"PLEASE JOIN US \nTO CELEBRATE THE MARRIAGE OF",x:0.0,y:59.1,fontSize:8.6,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:400.0,lineHeight:2.0,rotation:0},
      {id:"sw14-t2",type:"text",content:"&",x:250.9,y:213.3,fontSize:30.5,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:38.6,lineHeight:1.2,rotation:0},
      {id:"sw14-t3",type:"text",content:"James",x:0.0,y:257.7,fontSize:44.8,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:400.0,lineHeight:1.2,rotation:0},
      {id:"sw14-t4",type:"text",content:"Monique",x:0.0,y:151.9,fontSize:44.8,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:400.0,lineHeight:1.2,rotation:0},
      {id:"sw14-t5",type:"text",content:"12 October 2025",x:105.2,y:383.3,fontSize:14.3,fontId:"mozart",italic:false,align:"center",color:"#000000",width:184.3,lineHeight:1.2,rotation:0},
      {id:"sw14-t6",type:"text",content:"REDLEAF WOLLOMBI\nCEREMONY COMMENCES 4PM\nRSVP BY 12 AUGUST 2026\nBLACK TIE",x:53.7,y:447.7,fontSize:8.6,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:143.7,lineHeight:1.78,rotation:0}
    ]},
  { id:"sw15", collection:"swan-lake", name:"Back Option 2", category:"invite", availableSizes:["a5"], sizeKey:"a5", background:"#FFFFFF", elements:[
      {id:"sw15-r0",type:"image",src:"/raster/sw15-r0.png?v=1783853115",fit:"fill",x:0.0,y:0.0,width:400.0,height:567.6,rotation:0},
      {id:"sw15-t0",type:"text",content:"&",x:151.6,y:267.8,fontSize:30.5,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:38.6,lineHeight:1.2,rotation:0},
      {id:"sw15-t1",type:"text",content:"J",x:165.6,y:284.0,fontSize:44.8,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:201.7,lineHeight:1.2,rotation:0},
      {id:"sw15-t2",type:"text",content:"M",x:146.4,y:226.6,fontSize:44.8,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:201.7,lineHeight:1.2,rotation:0}
    ]},
  { id:"sw16", collection:"swan-lake", name:"Front Option 1", category:"invite", availableSizes:["120x180"], sizeKey:"120x180", background:"#FFFFFF", elements:[
      {id:"sw16-border",type:"illustration",illustrationId:"border-sw16",illustrationSrc:"/borders/sw16-border.svg?v=1783853115",label:"Border",x:27.2,y:27.4,width:345.6,height:545.4,color:"#030505",rotation:0,stretch:true},
      {id:"sw16-t0",type:"text",content:"PLEASE JOIN US \nTO CELEBRATE THE MARRIAGE OF",x:0.0,y:95.6,fontSize:8.6,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:400.0,lineHeight:2.0,rotation:0},
      {id:"sw16-t1",type:"text",content:"&",x:102.9,y:249.5,fontSize:30.5,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:38.6,lineHeight:1.2,rotation:0},
      {id:"sw16-t2",type:"text",content:"<span style=\"font-feature-settings: &quot;ss02&quot;;\">s</span>",x:266.1,y:291.1,fontSize:31.5,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:27.4,lineHeight:1.2,rotation:0},
      {id:"sw16-t3",type:"text",content:"AME",x:216.4,y:303.7,fontSize:22.9,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:120.8,lineHeight:1.2,rotation:0},
      {id:"sw16-t4",type:"text",content:"ONIQUE",x:190.0,y:220.8,fontSize:22.9,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:120.8,lineHeight:1.2,rotation:0},
      {id:"sw16-t5",type:"text",content:"J",x:155.4,y:262.5,fontSize:44.8,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:201.7,lineHeight:1.2,rotation:0},
      {id:"sw16-t6",type:"text",content:"M",x:87.7,y:192.1,fontSize:44.8,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:201.7,lineHeight:1.2,rotation:0},
      {id:"sw16-t7",type:"text",content:"12 October 2025",x:105.2,y:407.2,fontSize:14.3,fontId:"mozart",italic:false,align:"center",color:"#000000",width:184.3,lineHeight:1.2,rotation:0},
      {id:"sw16-t8",type:"text",content:"REDLEAF WOLLOMBI\nCEREMONY COMMENCES AT 4PM\nRSVP BY 12 AUGUST 2026\nBLACK TIE",x:0.0,y:452.3,fontSize:8.6,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:400.0,lineHeight:1.78,rotation:0}
    ]},
  { id:"sw17", collection:"swan-lake", name:"Back Option 1", category:"invite", availableSizes:["120x180"], sizeKey:"120x180", background:"#FFFFFF", elements:[
      {id:"sw17-aw1",type:"image",src:"/artwork/Lake.png?v=1783853115",fit:"fill",x:0.0,y:0.0,width:400.0,height:600.0,rotation:0},
      {id:"sw17-aw0",type:"image",src:"/artwork/Double Swan copy.png?v=1783853115",fit:"fill",x:9.5,y:123.4,width:381.0,height:261.5,rotation:0},
      {id:"sw17-art0",type:"image",src:"/raster/sw17-art0.png?v=1783853115",fit:"fill",x:100.0,y:407.4,width:198.3,height:125.1,rotation:0},
      {id:"sw17-t0",type:"text",content:"TO BE WED",x:0.8,y:80.7,fontSize:10.6,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:399.2,lineHeight:1.2,rotation:0}
    ]},
  { id:"sw18", collection:"swan-lake", name:"Front Option 2", category:"invite", availableSizes:["120x180"], sizeKey:"120x180", background:"#FFFFFF", elements:[
      {id:"sw18-t0",type:"text",content:"PLEASE JOIN US \nTO CELEBRATE THE MARRIAGE OF",x:0.0,y:83.1,fontSize:10.6,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:400.0,lineHeight:2.0,rotation:0},
      {id:"sw18-t1",type:"text",content:"&",x:253.9,y:235.4,fontSize:37.6,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:43.4,lineHeight:1.2,rotation:0},
      {id:"sw18-t2",type:"text",content:"James",x:0.0,y:285.4,fontSize:55.3,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:400.0,lineHeight:1.2,rotation:0},
      {id:"sw18-t3",type:"text",content:"Monique",x:0.0,y:166.3,fontSize:55.3,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:400.0,lineHeight:1.2,rotation:0},
      {id:"sw18-t4",type:"text",content:"12 October 2025",x:0.0,y:404.4,fontSize:17.6,fontId:"mozart",italic:false,align:"center",color:"#000000",width:400.0,lineHeight:1.2,rotation:0},
      {id:"sw18-t5",type:"text",content:"REDLEAF WOLLOMBI\nCEREMONY COMMENCES AT 4PM\nRSVP BY 12 AUGUST 2026\nBLACK TIE",x:0.0,y:456.6,fontSize:10.6,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:400.0,lineHeight:1.78,rotation:0}
    ]},
  { id:"sw19", collection:"swan-lake", name:"Back Option 2", category:"invite", availableSizes:["120x180"], sizeKey:"120x180", background:"#FFFFFF", elements:[
      {id:"sw19-r0",type:"image",src:"/raster/sw19-r0.png?v=1783853115",fit:"fill",x:0.0,y:0.2,width:400.0,height:599.8,rotation:0},
      {id:"sw19-t0",type:"text",content:"&",x:133.9,y:254.7,fontSize:37.6,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:47.6,lineHeight:1.2,rotation:0},
      {id:"sw19-t1",type:"text",content:"J",x:151.2,y:274.6,fontSize:55.3,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:248.8,lineHeight:1.2,rotation:0},
      {id:"sw19-t2",type:"text",content:"M",x:127.5,y:203.8,fontSize:55.3,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:248.8,lineHeight:1.2,rotation:0}
    ]},
  { id:"sw20", collection:"swan-lake", name:"Front Option 1", category:"invite", availableSizes:["120x120"], sizeKey:"120x120", background:"#FFFFFF", elements:[
      {id:"sw20-border",type:"illustration",illustrationId:"border-sw20",illustrationSrc:"/borders/sw20-border.svg?v=1783853115",label:"Border",x:21.6,y:20.6,width:357.9,height:359.0,color:"#030505",rotation:0,stretch:true},
      {id:"sw20-t0",type:"text",content:"&",x:112.7,y:171.6,fontSize:27.8,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:35.2,lineHeight:1.2,rotation:0},
      {id:"sw20-t1",type:"text",content:"<span style=\"font-feature-settings: &quot;ss02&quot;;\">s</span>",x:261.6,y:209.5,fontSize:28.7,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:25.0,lineHeight:1.2,rotation:0},
      {id:"sw20-t2",type:"text",content:"AME",x:216.2,y:221.0,fontSize:20.9,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:110.1,lineHeight:1.2,rotation:0},
      {id:"sw20-t3",type:"text",content:"ONIQUE",x:192.1,y:145.4,fontSize:20.9,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:72.2,lineHeight:1.2,rotation:0},
      {id:"sw20-t4",type:"text",content:"J",x:160.6,y:183.5,fontSize:40.9,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:74.2,lineHeight:1.2,rotation:0},
      {id:"sw20-t5",type:"text",content:"M",x:98.9,y:119.2,fontSize:40.9,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:96.2,lineHeight:1.2,rotation:0},
      {id:"sw20-t6",type:"text",content:"PLEASE JOIN US \nTO CELEBRATE THE MARRIAGE OF",x:0.0,y:60.1,fontSize:8.2,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:400.0,lineHeight:1.43,rotation:0},
      {id:"sw20-t7",type:"text",content:"12 October 2025",x:108.4,y:280.4,fontSize:12.9,fontId:"mozart",italic:false,align:"center",color:"#000000",width:184.3,lineHeight:1.2,rotation:0},
      {id:"sw20-t8s0",type:"text",content:"REDLEAF WOLLOMBI",x:87.3,y:317.3,fontSize:8.2,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:93.3,lineHeight:1.2,rotation:0},
      {id:"sw20-t8s1",type:"text",content:"|",x:176.9,y:316.4,fontSize:8.2,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:16.5,lineHeight:1.2,rotation:0},
      {id:"sw20-t8s2",type:"text",content:"CEREMONY COMMENCES AT 4PM",x:182.5,y:317.3,fontSize:8.2,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:136.0,lineHeight:1.2,rotation:0},
      {id:"sw20-t8s3",type:"text",content:"RSVP BY 12 AUGUST 2026",x:121.9,y:332.5,fontSize:8.2,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:110.9,lineHeight:1.2,rotation:0},
      {id:"sw20-t8s4",type:"text",content:"|",x:229.1,y:331.7,fontSize:8.2,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:16.5,lineHeight:1.2,rotation:0},
      {id:"sw20-t8s5",type:"text",content:"BLACK TIE",x:234.7,y:332.5,fontSize:8.2,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:49.2,lineHeight:1.2,rotation:0}
    ]},
  { id:"sw21", collection:"swan-lake", name:"Back Option 1", category:"invite", availableSizes:["120x120"], sizeKey:"120x120", background:"#FFFFFF", elements:[
      {id:"sw21-aw1",type:"image",src:"/artwork/Lake.png?v=1783853115",fit:"fill",x:0.0,y:0.0,width:400.1,height:400.0,rotation:0},
      {id:"sw21-aw0",type:"image",src:"/artwork/Double Swan copy.png?v=1783853115",fit:"fill",x:91.7,y:73.6,width:228.0,height:156.5,rotation:0},
      {id:"sw21-t0",type:"text",content:"&",x:135.3,y:293.7,fontSize:22.5,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:28.5,lineHeight:1.2,rotation:0},
      {id:"sw21-t1",type:"text",content:"<span style=\"font-feature-settings: &quot;ss02&quot;;\">s</span>",x:255.6,y:324.4,fontSize:23.2,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:20.2,lineHeight:1.2,rotation:0},
      {id:"sw21-t2",type:"text",content:"AME",x:218.9,y:333.6,fontSize:16.9,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:89.1,lineHeight:1.2,rotation:0},
      {id:"sw21-t3",type:"text",content:"ONIQUE",x:199.5,y:272.5,fontSize:16.9,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:58.4,lineHeight:1.2,rotation:0},
      {id:"sw21-t4",type:"text",content:"J",x:173.9,y:303.3,fontSize:33.0,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:60.0,lineHeight:1.2,rotation:0},
      {id:"sw21-t5",type:"text",content:"M",x:124.0,y:251.4,fontSize:33.0,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:77.8,lineHeight:1.2,rotation:0},
      {id:"sw21-t6",type:"text",content:"TO BE WED",x:0.6,y:44.5,fontSize:8.6,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:400.1,lineHeight:1.2,rotation:0}
    ]},
  { id:"sw22", collection:"swan-lake", name:"Front Option 2", category:"invite", availableSizes:["120x120"], sizeKey:"120x120", background:"#FFFFFF", elements:[
      {id:"sw22-t0s0",type:"text",content:"REDLEAF WOLLOMBI",x:70.6,y:317.1,fontSize:9.4,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:106.0,lineHeight:1.2,rotation:0},
      {id:"sw22-t0s1",type:"text",content:"|",x:173.0,y:316.1,fontSize:9.4,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:16.5,lineHeight:1.2,rotation:0},
      {id:"sw22-t0s2",type:"text",content:"CEREMONY COMMENCES AT 4PM",x:179.4,y:317.1,fontSize:9.4,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:154.8,lineHeight:1.2,rotation:0},
      {id:"sw22-t0s3",type:"text",content:"RSVP BY 12 AUGUST 2026",x:110.1,y:332.4,fontSize:9.4,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:126.1,lineHeight:1.2,rotation:0},
      {id:"sw22-t0s4",type:"text",content:"|",x:232.6,y:331.4,fontSize:9.4,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:16.5,lineHeight:1.2,rotation:0},
      {id:"sw22-t0s5",type:"text",content:"BLACK TIE",x:239.0,y:332.4,fontSize:9.4,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:55.6,lineHeight:1.2,rotation:0},
      {id:"sw22-t1",type:"text",content:"PLEASE JOIN US TO CELEBRATE THE MARRIAGE OF",x:0.0,y:58.6,fontSize:9.4,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:400.0,lineHeight:1.2,rotation:0},
      {id:"sw22-t2",type:"text",content:"Monique Wells\nand\nJames Graham",x:0.0,y:101.7,fontSize:31.7,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:400.0,lineHeight:1.44,rotation:0},
      {id:"sw22-t3",type:"text",content:"12 October 2025",x:0.0,y:274.6,fontSize:17.6,fontId:"mozart",italic:false,align:"center",color:"#000000",width:400.0,lineHeight:1.2,rotation:0}
    ]},
  { id:"sw23", collection:"swan-lake", name:"Back Option 2", category:"invite", availableSizes:["120x120"], sizeKey:"120x120", background:"#FFFFFF", elements:[
      {id:"sw23-r0",type:"image",src:"/raster/sw23-r0.png?v=1783853115",fit:"fill",x:0.0,y:0.0,width:400.0,height:400.0,rotation:0},
      {id:"sw23-t0",type:"text",content:"&",x:137.0,y:179.1,fontSize:37.6,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:47.6,lineHeight:1.2,rotation:0},
      {id:"sw23-t1",type:"text",content:"J",x:154.3,y:199.0,fontSize:55.3,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:107.4,lineHeight:1.2,rotation:0},
      {id:"sw23-t2",type:"text",content:"M",x:130.6,y:128.2,fontSize:55.3,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:137.1,lineHeight:1.2,rotation:0}
    ]},
  { id:"sw24", collection:"swan-lake", name:"Front Option 1", category:"details-card", availableSizes:["148x105"], sizeKey:"148x105", background:"#FFFFFF", elements:[
      {id:"sw24-aw1",type:"image",src:"/artwork/Lake.png?v=1783853115",fit:"fill",x:0.0,y:0.0,width:400.0,height:283.8,rotation:0},
      {id:"sw24-aw0",type:"image",src:"/artwork/Double Swan copy.png?v=1783853115",fit:"fill",x:0.0,y:159.2,width:184.8,height:126.9,rotation:0},
      {id:"sw24-t0",type:"text",content:"&",x:129.0,y:132.6,fontSize:24.7,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:31.3,lineHeight:1.2,rotation:0},
      {id:"sw24-t1",type:"text",content:"<span style=\"font-feature-settings: &quot;ss02&quot;;\">s</span>",x:261.3,y:166.3,fontSize:25.5,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:22.2,lineHeight:1.2,rotation:0},
      {id:"sw24-t2",type:"text",content:"AME",x:221.0,y:176.5,fontSize:18.6,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:97.9,lineHeight:1.2,rotation:0},
      {id:"sw24-t3",type:"text",content:"ONIQUE",x:199.6,y:109.3,fontSize:18.6,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:97.9,lineHeight:1.2,rotation:0},
      {id:"sw24-t4",type:"text",content:"J",x:171.6,y:143.1,fontSize:36.3,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:163.6,lineHeight:1.2,rotation:0},
      {id:"sw24-t5",type:"text",content:"M",x:116.7,y:86.0,fontSize:36.3,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:163.6,lineHeight:1.2,rotation:0}
    ]},
  { id:"sw25", collection:"swan-lake", name:"Back Option 1", category:"details-card", availableSizes:["148x105"], sizeKey:"148x105", background:"#FFFFFF", elements:[
      {id:"sw25-t0s0",type:"text",content:"Dress Code",x:262.1,y:34.0,fontSize:9.5,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:60.7,lineHeight:1.2,rotation:0},
      {id:"sw25-t0s1",type:"text",content:"Black Tie",x:276.3,y:53.1,fontSize:6.7,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:32.4,lineHeight:1.2,rotation:0},
      {id:"sw25-t0s2",type:"text",content:"Gifts",x:278.5,y:85.5,fontSize:9.5,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:28.0,lineHeight:1.2,rotation:0},
      {id:"sw25-t0s3",type:"text",content:"The greatest gift of all is celebrating with you, but",x:210.1,y:103.7,fontSize:6.7,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:167.2,lineHeight:1.2,rotation:0},
      {id:"sw25-t0s4",type:"text",content:"if you would like to give a gift, a contribution to",x:213.4,y:111.3,fontSize:6.7,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:160.7,lineHeight:1.2,rotation:0},
      {id:"sw25-t0s5",type:"text",content:"our wishing well would be warmly appreciated.",x:217.3,y:118.9,fontSize:6.7,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:150.5,lineHeight:1.2,rotation:0},
      {id:"sw25-t0s6",type:"text",content:"Transport",x:265.6,y:151.3,fontSize:9.5,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:53.8,lineHeight:1.2,rotation:0},
      {id:"sw25-t0s7",type:"text",content:"We've arranged guest transport for the day to make",x:210.5,y:169.4,fontSize:6.7,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:166.4,lineHeight:1.2,rotation:0},
      {id:"sw25-t0s8",type:"text",content:"things easy. We will have buses picking up and",x:216.8,y:177.1,fontSize:6.7,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:153.9,lineHeight:1.2,rotation:0},
      {id:"sw25-t0s9",type:"text",content:"dropping off from the reccomended accomodation",x:214.6,y:184.7,fontSize:6.7,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:158.3,lineHeight:1.2,rotation:0},
      {id:"sw25-t0s10",type:"text",content:"list.",x:284.7,y:192.3,fontSize:6.7,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:15.6,lineHeight:1.2,rotation:0},
      {id:"sw25-t0s11",type:"text",content:"RSVP",x:257.3,y:221.8,fontSize:9.5,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:70.4,lineHeight:1.2,rotation:0},
      {id:"sw25-t0s12",type:"text",content:"We kindly request you RSVP via our wedding",x:219.5,y:240.0,fontSize:6.7,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:148.6,lineHeight:1.2,rotation:0},
      {id:"sw25-t0s13",type:"text",content:"website by the 17th of May.",x:248.5,y:247.6,fontSize:6.7,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:88.0,lineHeight:1.2,rotation:0},
      {id:"sw25-t1",type:"text",content:"<span style=\"font-feature-settings: &quot;ss02&quot;;\">s</span>",x:143.6,y:182.3,fontSize:21.5,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:18.7,lineHeight:1.2,rotation:0},
      {id:"sw25-t2",type:"text",content:"ETAIL",x:97.6,y:190.9,fontSize:15.6,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:82.5,lineHeight:1.2,rotation:0},
      {id:"sw25-t3",type:"text",content:"INER",x:80.1,y:127.5,fontSize:15.6,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:82.5,lineHeight:1.2,rotation:0},
      {id:"sw25-t4",type:"text",content:"D",x:56.4,y:162.8,fontSize:30.6,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:137.7,lineHeight:1.2,rotation:0},
      {id:"sw25-t5",type:"text",content:"F",x:37.8,y:104.3,fontSize:30.6,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:137.7,lineHeight:1.2,rotation:0}
    ]},
  { id:"sw26", collection:"swan-lake", name:"Front Option 2", category:"details-card", availableSizes:["a6"], sizeKey:"a6", background:"#FFFFFF", elements:[
      {id:"sw26-r0",type:"image",src:"/raster/sw26-r0.png?v=1783853115",fit:"fill",x:0.0,y:0.0,width:400.0,height:563.8,rotation:0},
      {id:"sw26-t0",type:"text",content:"&",x:148.0,y:275.8,fontSize:36.3,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:54.4,lineHeight:1.2,rotation:0},
      {id:"sw26-t1",type:"text",content:"J",x:154.1,y:296.4,fontSize:55.1,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:94.7,lineHeight:1.2,rotation:0},
      {id:"sw26-t2",type:"text",content:"M",x:136.4,y:226.6,fontSize:52.4,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:127.3,lineHeight:1.2,rotation:0}
    ]},
  { id:"sw27", collection:"swan-lake", name:"Back Option 2", category:"details-card", availableSizes:["a6"], sizeKey:"a6", background:"#FFFFFF", elements:[
      {id:"sw27-t0",type:"text",content:"<span style=\"font-feature-settings: &quot;ss02&quot;;\">s</span>",x:295.0,y:123.1,fontSize:30.3,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:26.4,lineHeight:1.2,rotation:0},
      {id:"sw27-t1",type:"text",content:"ETAIL",x:230.1,y:135.2,fontSize:22.0,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:116.2,lineHeight:1.2,rotation:0},
      {id:"sw27-t2",type:"text",content:"INER",x:114.2,y:103.6,fontSize:22.0,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:116.2,lineHeight:1.2,rotation:0},
      {id:"sw27-t3",type:"text",content:"D",x:172.0,y:95.6,fontSize:43.1,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:194.1,lineHeight:1.2,rotation:0},
      {id:"sw27-t4",type:"text",content:"F",x:54.6,y:70.9,fontSize:43.1,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:194.1,lineHeight:1.2,rotation:0},
      {id:"sw27-t5s0",type:"text",content:"Dress Code",x:160.0,y:204.2,fontSize:13.4,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:85.6,lineHeight:1.2,rotation:0},
      {id:"sw27-t5s1",type:"text",content:"Black Tie",x:180.0,y:231.2,fontSize:9.4,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:45.6,lineHeight:1.2,rotation:0},
      {id:"sw27-t5s2",type:"text",content:"Gifts",x:183.1,y:276.8,fontSize:13.4,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:39.4,lineHeight:1.2,rotation:0},
      {id:"sw27-t5s3",type:"text",content:"The greatest gift of all is celebrating with you, but if you would",x:57.3,y:302.4,fontSize:9.4,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:294.5,lineHeight:1.2,rotation:0},
      {id:"sw27-t5s4",type:"text",content:"like to give a gift, a contribution to our wishing well would be",x:60.9,y:313.1,fontSize:9.4,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:287.4,lineHeight:1.2,rotation:0},
      {id:"sw27-t5s5",type:"text",content:"warmly appreciated.",x:156.6,y:323.9,fontSize:9.4,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:92.4,lineHeight:1.2,rotation:0},
      {id:"sw27-t5s6",type:"text",content:"Transport",x:164.9,y:369.5,fontSize:13.4,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:75.8,lineHeight:1.2,rotation:0},
      {id:"sw27-t5s7",type:"text",content:"We've arranged guest transport for the day to make things easy.",x:59.2,y:395.1,fontSize:9.4,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:290.7,lineHeight:1.2,rotation:0},
      {id:"sw27-t5s8",type:"text",content:"We will have buses picking up and dropping off from the",x:73.9,y:405.9,fontSize:9.4,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:261.2,lineHeight:1.2,rotation:0},
      {id:"sw27-t5s9",type:"text",content:"reccomended accomodation list.",x:132.6,y:416.6,fontSize:9.4,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:140.4,lineHeight:1.2,rotation:0},
      {id:"sw27-t5s10",type:"text",content:"RSVP",x:153.2,y:458.2,fontSize:13.4,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:99.3,lineHeight:1.2,rotation:0},
      {id:"sw27-t5s11",type:"text",content:"We kindly request you RSVP via our wedding website by the",x:66.7,y:483.8,fontSize:9.4,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:275.7,lineHeight:1.2,rotation:0},
      {id:"sw27-t5s12",type:"text",content:"17th of May.",x:173.9,y:494.6,fontSize:9.4,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:57.8,lineHeight:1.2,rotation:0}
    ]},
  { id:"sw28", collection:"swan-lake", name:"Front Option 1", category:"rsvp-card", availableSizes:["148x105"], sizeKey:"148x105", background:"#FFFFFF", elements:[
      {"id": "sw28-art0", "type": "image", "src": "/raster/sw28-art0.png?v=1783853115", "x": -35.9, "y": 0, "width": 447.9, "height": 166.8, "rotation": 0},
      {"id": "sw28-t0", "type": "text", "content": "Please Deliver To", "x": 248.9, "y": 197.4, "fontSize": 10.5, "fontId": "mozart", "italic": false, "align": "right", "color": "#000000", "width": 127, "lineHeight": 1.2, "rotation": 0},
      {"id": "sw28-t1", "type": "text", "content": "Monique and James\n1 Example Street\nDouble Bay NSW 2010\n", "x": 248.8, "y": 218, "fontSize": 10.5, "fontId": "dubiel", "italic": false, "align": "right", "color": "#000000", "width": 127, "lineHeight": 1.2, "rotation": 0},
      {"id": "sw28-t2", "type": "text", "content": "Stamp \nHere", "x": 316.9, "y": 34.3, "fontSize": 11.4, "fontId": "dubiel", "italic": false, "align": "center", "color": "#808080", "width": 49.9, "lineHeight": 1.2, "rotation": 0},
      {"id": "sw28-t3", "type": "text", "content": "Kindly return this card by 10 Janauary 2027", "x": 195.8, "y": 134.4, "fontSize": 7.6, "fontId": "mozart", "italic": false, "align": "left", "color": "#000000", "width": 180, "lineHeight": 1.2, "rotation": 0},
      {"id": "sw28-t4", "type": "text", "content": "<br>Names  ..........................................................................................<br><br>Happily Accept  ....    Sorry to miss it  ....<br><br>Dietary Requirements  ..........................................................<br><br>I would like to utilise the Bus to the Ceremony  ....<br><br>I would like to utilise the Bus home from the Reception  ....", "x": 29.05, "y": 157.8, "fontSize": 9, "fontId": "dubiel", "italic": false, "align": "left", "color": "#000000", "width": 159, "lineHeight": 1.2, "rotation": 0}
    ]},
  { id:"sw29", collection:"swan-lake", name:"Back Option 1", category:"rsvp-card", availableSizes:["148x105"], sizeKey:"148x105", background:"#FFFFFF", elements:[
      {id:"sw29-aw1",type:"image",src:"/artwork/Lake.png?v=1783853115",fit:"fill",x:0.0,y:0.0,width:400.0,height:283.8,rotation:0},
      {id:"sw29-aw0",type:"image",src:"/artwork/Double Swan copy.png?v=1783853115",fit:"fill",x:0.0,y:159.2,width:184.8,height:126.9,rotation:0},
      {id:"sw29-t0",type:"text",content:"&",x:129.0,y:132.6,fontSize:24.7,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:31.3,lineHeight:1.2,rotation:0},
      {id:"sw29-t1",type:"text",content:"<span style=\"font-feature-settings: &quot;ss02&quot;;\">s</span>",x:261.3,y:166.3,fontSize:25.5,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:22.2,lineHeight:1.2,rotation:0},
      {id:"sw29-t2",type:"text",content:"AME",x:221.0,y:176.5,fontSize:18.6,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:97.9,lineHeight:1.2,rotation:0},
      {id:"sw29-t3",type:"text",content:"ONIQUE",x:199.6,y:109.3,fontSize:18.6,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:97.9,lineHeight:1.2,rotation:0},
      {id:"sw29-t4",type:"text",content:"J",x:171.6,y:143.1,fontSize:36.3,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:163.6,lineHeight:1.2,rotation:0},
      {id:"sw29-t5",type:"text",content:"M",x:116.7,y:86.0,fontSize:36.3,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:163.6,lineHeight:1.2,rotation:0}
    ]},
  { id:"sw30", collection:"swan-lake", name:"Front Option 2", category:"rsvp-card", availableSizes:["a6"], sizeKey:"a6", background:"#FFFFFF", elements:[
      {id:"sw30-t0",type:"text",content:"RSVP  ",x:19.1,y:117.4,fontSize:30.9,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:354.8,lineHeight:1.2,rotation:0},
      {id:"sw30-t1",type:"text",content:"Please Deliver To",x:174.5,y:451.2,fontSize:16.1,fontId:"mozart-light",italic:false,align:"right",color:"#000000",width:179.0,lineHeight:1.2,rotation:0},
      {id:"sw30-t2",type:"text",content:"Monique and James\n1 Example Street\nDouble Bay NSW 2010\n",x:174.5,y:480.2,fontSize:14.8,fontId:"dubiel",italic:false,align:"right",color:"#000000",width:179.0,lineHeight:1.18,rotation:0},
      {id:"sw30-t3",type:"text",content:"Stamp \nHere",x:294.0,y:44.3,fontSize:16.1,fontId:"dubiel",italic:false,align:"center",color:"#808080",width:70.4,lineHeight:1.25,rotation:0},
      {id:"sw30-t4",type:"text",content:"Kindly return this card by 10 Janauary 2027",x:65.1,y:167.9,fontSize:10.8,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:253.8,lineHeight:1.2,rotation:0},
      {id:"sw30-t5",type:"text",content:"\nNames  ..............................................................................................\n\n\n\nHappily Accept  ....    Sorry to miss it  ....\n\n\n\nDietary Requirements  ...............................................................\n\n\n\nI would like to utilise the Bus to the Ceremony  ....\n\n\n\nI would like to utilise the Bus home from the Reception  ....",x:62.6,y:220.8,fontSize:16.1,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:287.3,lineHeight:2.0,rotation:0}
    ]},
  { id:"sw31", collection:"swan-lake", name:"Back Option 2", category:"rsvp-card", availableSizes:["a6"], sizeKey:"a6", background:"#FFFFFF", elements:[
      {id:"sw31-r0",type:"image",src:"/raster/sw31-r0.png?v=1783853115",fit:"fill",x:0.0,y:0.0,width:400.0,height:563.8,rotation:0},
      {id:"sw31-t0",type:"text",content:"&",x:148.0,y:275.8,fontSize:36.3,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:54.4,lineHeight:1.2,rotation:0},
      {id:"sw31-t1",type:"text",content:"J",x:154.1,y:296.4,fontSize:55.1,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:94.7,lineHeight:1.2,rotation:0},
      {id:"sw31-t2",type:"text",content:"M",x:136.4,y:226.6,fontSize:52.4,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:127.3,lineHeight:1.2,rotation:0}
    ]},
  { id:"sw32", collection:"swan-lake", name:"Front Option 1", category:"envelope-front", availableSizes:["229x162"], sizeKey:"229x162", background:"#FFFFFF", elements:[
      {id:"sw32-t0",type:"text",content:"Please Deliver To",x:0.0,y:118.1,fontSize:8.5,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:400.0,lineHeight:1.2,rotation:0},
      {id:"sw32-t1",type:"text",content:"Monique and James\n1 Example Street\nDouble Bay NSW 2010\n",x:0.8,y:134.7,fontSize:8.5,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:399.0,lineHeight:1.18,rotation:0}
    ]},
  { id:"sw33", collection:"swan-lake", name:"Back Option 1 (Euro Flap)", category:"envelope-back", availableSizes:["229x162"], sizeKey:"229x162", background:"#FFFFFF", elements:[
      {id:"sw33-t0",type:"text",content:"&",x:176.1,y:126.8,fontSize:16.6,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:25.0,lineHeight:1.2,rotation:0},
      {id:"sw33-t1",type:"text",content:"J",x:178.9,y:136.3,fontSize:25.3,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:43.4,lineHeight:1.2,rotation:0},
      {id:"sw33-t2",type:"text",content:"M",x:170.8,y:104.3,fontSize:24.0,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:58.4,lineHeight:1.2,rotation:0}
    ]},
  { id:"sw34", collection:"swan-lake", name:"Front Option 2", category:"envelope-front", availableSizes:["229x162"], sizeKey:"229x162", background:"#FFFFFF", elements:[
      {id:"sw34-aw0",type:"image",src:"/artwork/Double Swan copy.png?v=1783853115",fit:"fill",x:115.2,y:85.0,width:151.7,height:104.1,rotation:0},
      {id:"sw34-t0",type:"text",content:"Special  Delivery \n   For",x:43.4,y:151.5,fontSize:13.6,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:138.5,lineHeight:1.95,rotation:0},
      {id:"sw34-t1",type:"text",content:"Monique Bright and James Graham\n1 Example Street\nDouble Bay NSW 2010\n",x:215.6,y:107.8,fontSize:9.2,fontId:"dubiel",italic:false,align:"right",color:"#000000",width:129.3,lineHeight:1.33,rotation:0}
    ]},
  { id:"sw35", collection:"swan-lake", name:"Back Option 2 (iFlap)", category:"envelope-back", availableSizes:["229x162"], sizeKey:"229x162", background:"#FFFFFF", elements:[
      {id:"sw35-t0",type:"text",content:"With love from",x:148.2,y:87.6,fontSize:11.7,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:102.6,lineHeight:1.2,rotation:0},
      {id:"sw35-t1",type:"text",content:"Monique and James\n1 Example Street\nDouble Bay NSW 2010\n",x:148.2,y:108.8,fontSize:8.5,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:102.6,lineHeight:1.18,rotation:0}
    ]},
  { id:"sw36", collection:"swan-lake", name:"Front Option 3", category:"invite", availableSizes:["a5"], sizeKey:"a5", background:"#FFFFFF", elements:[
      {id:"sw36-aw0",type:"image",src:"/artwork/Double Swan copy.png?v=1783853115",fit:"fill",x:93.6,y:377.5,width:219.4,height:150.6,rotation:0},
      {id:"sw36-t0",type:"text",content:"CEREMONY COMMENCES 4PM",x:41.6,y:386.8,fontSize:8.6,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:107.6,lineHeight:1.2,rotation:0},
      {id:"sw36-t1",type:"text",content:"RSVP BY \n12 AUGUST 2026",x:23.4,y:415.1,fontSize:8.6,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:72.1,lineHeight:1.11,rotation:0},
      {id:"sw36-t2",type:"text",content:"BLACK TIE",x:73.8,y:511.8,fontSize:8.6,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:100.1,lineHeight:1.2,rotation:0},
      {id:"sw36-t3",type:"text",content:"12 October 2025",x:0.1,y:309.1,fontSize:17.2,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:400.0,lineHeight:1.2,rotation:0},
      {id:"sw36-t4",type:"text",content:"FOR MORE DETAILS \nAND TO RSVP PLEASE VISIT\nMONIQUEANDJAMES.COM.AU",x:241.2,y:384.7,fontSize:8.6,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:143.7,lineHeight:1.78,rotation:0},
      {id:"sw36-t5",type:"text",content:"PLEASE JOIN US \nTO CELEBRATE THE MARRIAGE OF",x:0.1,y:45.4,fontSize:8.6,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:400.0,lineHeight:2.0,rotation:0},
      {id:"sw36-t6",type:"text",content:"&",x:250.9,y:174.8,fontSize:30.5,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:38.6,lineHeight:1.2,rotation:0},
      {id:"sw36-t7",type:"text",content:"James",x:0.0,y:219.2,fontSize:44.8,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:400.0,lineHeight:1.2,rotation:0},
      {id:"sw36-t8",type:"text",content:"Monique",x:0.0,y:113.4,fontSize:44.8,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:400.0,lineHeight:1.2,rotation:0},
      {id:"sw36-t9",type:"text",content:"REDLEAF WOLLOMBI",x:136.7,y:357.3,fontSize:8.6,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:101.9,lineHeight:1.2,rotation:0}
    ]},
  { id:"sw37", collection:"swan-lake", name:"Back Option 4", category:"invite", availableSizes:["a5"], sizeKey:"a5", background:"#FFFFFF", elements:[
      {id:"sw37-r0",type:"image",src:"/raster/sw37-r0.png?v=1783853115",fit:"fill",x:1.0,y:0.0,width:399.0,height:567.4,rotation:0},
      {id:"sw37-art4",type:"image",src:"/raster/sw37-art4.png?v=1783853115",fit:"fill",x:0.0,y:98.3,width:204.0,height:121.3,rotation:0},
      {id:"sw37-art5",type:"image",src:"/raster/sw37-art5.png?v=1783853115",fit:"fill",x:0.0,y:98.3,width:204.0,height:121.3,rotation:0},
      {id:"sw37-art7",type:"image",src:"/raster/sw37-art7.png?v=1783853115",fit:"fill",x:265.9,y:147.5,width:108.4,height:209.4,rotation:0},
      {id:"sw37-art2",type:"image",src:"/raster/sw37-art2.png?v=1783853115",fit:"fill",x:1.0,y:243.9,width:155.2,height:144.6,rotation:0},
      {id:"sw37-art3",type:"image",src:"/raster/sw37-art3.png?v=1783853115",fit:"fill",x:1.0,y:243.9,width:155.2,height:144.6,rotation:0},
      {id:"sw37-art0",type:"image",src:"/raster/sw37-art0.png?v=1783853115",fit:"fill",x:68.6,y:400.5,width:152.8,height:119.7,rotation:0},
      {id:"sw37-art6",type:"image",src:"/raster/sw37-art6.png?v=1783853115",fit:"fill",x:242.3,y:104.4,width:97.4,height:126.0,rotation:0},
      {id:"sw37-art1",type:"image",src:"/raster/sw37-art1.png?v=1783853115",fit:"fill",x:0.0,y:544.4,width:18.8,height:23.0,rotation:0}
    ]},
  { id:"sw38", collection:"swan-lake", name:"Front Option 3", category:"invite", availableSizes:["120x180"], sizeKey:"120x180", background:"#FFFFFF", elements:[
      {id:"sw38-aw0",type:"image",src:"/artwork/Double Swan copy.png?v=1783853115",fit:"fill",x:94.3,y:402.0,width:219.7,height:150.8,rotation:0},
      {id:"sw38-t0",type:"text",content:"CEREMONY COMMENCES 4PM",x:42.2,y:398.0,fontSize:8.6,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:107.8,lineHeight:1.2,rotation:0},
      {id:"sw38-t1",type:"text",content:"RSVP BY \n12 AUGUST 2026",x:23.9,y:426.3,fontSize:8.6,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:72.2,lineHeight:1.11,rotation:0},
      {id:"sw38-t2",type:"text",content:"BLACK TIE",x:74.4,y:543.2,fontSize:8.6,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:100.2,lineHeight:1.2,rotation:0},
      {id:"sw38-t3",type:"text",content:"12 October 2025",x:0.6,y:320.2,fontSize:17.2,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:400.6,lineHeight:1.2,rotation:0},
      {id:"sw38-t4",type:"text",content:"FOR MORE DETAILS \nAND TO RSVP PLEASE VISIT\nMONIQUEANDJAMES.COM.AU",x:242.1,y:395.9,fontSize:8.6,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:143.9,lineHeight:1.78,rotation:0},
      {id:"sw38-t5",type:"text",content:"PLEASE JOIN US \nTO CELEBRATE THE MARRIAGE OF",x:0.6,y:56.1,fontSize:8.6,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:400.6,lineHeight:2.0,rotation:0},
      {id:"sw38-t6",type:"text",content:"&",x:251.8,y:185.7,fontSize:30.6,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:38.7,lineHeight:1.2,rotation:0},
      {id:"sw38-t7",type:"text",content:"James",x:0.6,y:230.1,fontSize:44.9,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:400.6,lineHeight:1.2,rotation:0},
      {id:"sw38-t8",type:"text",content:"Monique",x:0.6,y:124.2,fontSize:44.9,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:400.6,lineHeight:1.2,rotation:0},
      {id:"sw38-t9",type:"text",content:"REDLEAF WOLLOMBI",x:137.5,y:368.4,fontSize:8.6,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:102.0,lineHeight:1.2,rotation:0}
    ]},
  { id:"sw39", collection:"swan-lake", name:"Back Option 4", category:"invite", availableSizes:["120x180"], sizeKey:"120x180", background:"#FFFFFF", elements:[
      {id:"sw39-r0",type:"image",src:"/raster/sw39-r0.png?v=1783853115",fit:"fill",x:0.0,y:0.0,width:400.0,height:600.0,rotation:0},
      {id:"sw39-art4",type:"image",src:"/raster/sw39-art4.png?v=1783853115",fit:"fill",x:0.0,y:104.0,width:204.0,height:128.2,rotation:0},
      {id:"sw39-art5",type:"image",src:"/raster/sw39-art5.png?v=1783853115",fit:"fill",x:0.0,y:104.0,width:204.0,height:128.2,rotation:0},
      {id:"sw39-art7",type:"image",src:"/raster/sw39-art7.png?v=1783853115",fit:"fill",x:265.9,y:156.0,width:108.4,height:221.4,rotation:0},
      {id:"sw39-art2",type:"image",src:"/raster/sw39-art2.png?v=1783853115",fit:"fill",x:0.0,y:258.0,width:156.2,height:152.9,rotation:0},
      {id:"sw39-art3",type:"image",src:"/raster/sw39-art3.png?v=1783853115",fit:"fill",x:0.0,y:258.0,width:156.2,height:152.9,rotation:0},
      {id:"sw39-art0",type:"image",src:"/raster/sw39-art0.png?v=1783853115",fit:"fill",x:68.6,y:423.6,width:152.8,height:126.5,rotation:0},
      {id:"sw39-art6",type:"image",src:"/raster/sw39-art6.png?v=1783853115",fit:"fill",x:242.3,y:110.5,width:97.4,height:133.2,rotation:0},
      {id:"sw39-art1",type:"image",src:"/raster/sw39-art1.png?v=1783853115",fit:"fill",x:0.0,y:575.6,width:18.8,height:24.3,rotation:0}
    ]},
  { id:"sw40", collection:"swan-lake", name:"Back Option 4", category:"invite", availableSizes:["120x120"], sizeKey:"120x120", background:"#FFFFFF", elements:[
      {id:"sw40-r0",type:"image",src:"/raster/sw40-r0.png?v=1783853115",fit:"fill",x:0.0,y:0.0,width:400.0,height:400.0,rotation:0},
      {id:"sw40-art3",type:"image",src:"/raster/sw40-art3.png?v=1783853115",fit:"fill",x:36.6,y:134.4,width:363.4,height:265.6,rotation:0},
      {id:"sw40-art4",type:"image",src:"/raster/sw40-art4.png?v=1783853115",fit:"fill",x:36.6,y:134.4,width:363.4,height:265.6,rotation:0},
      {id:"sw40-art5",type:"image",src:"/raster/sw40-art5.png?v=1783853115",fit:"fill",x:22.8,y:156.3,width:136.9,height:114.6,rotation:0},
      {id:"sw40-art6",type:"image",src:"/raster/sw40-art6.png?v=1783853115",fit:"fill",x:22.8,y:156.3,width:136.9,height:114.6,rotation:0},
      {id:"sw40-art7",type:"image",src:"/raster/sw40-art7.png?v=1783853115",fit:"fill",x:22.8,y:156.3,width:136.9,height:114.6,rotation:0},
      {id:"sw40-art0",type:"image",src:"/raster/sw40-art0.png?v=1783853115",fit:"fill",x:242.0,y:71.1,width:81.3,height:166.0,rotation:0},
      {id:"sw40-art1",type:"image",src:"/raster/sw40-art1.png?v=1783853115",fit:"fill",x:224.3,y:36.9,width:73.0,height:99.9,rotation:0},
      {id:"sw40-art2",type:"image",src:"/raster/sw40-art2.png?v=1783853115",fit:"fill",x:59.5,y:69.9,width:117.4,height:56.9,rotation:0}
    ]},
  { id:"sw41", collection:"swan-lake", name:"Front Option 3", category:"invite", availableSizes:["120x120"], sizeKey:"120x120", background:"#FFFFFF", elements:[
      {id:"sw41-aw0",type:"image",src:"/artwork/Double Swan copy.png?v=1783853115",fit:"fill",x:151.0,y:203.8,width:219.7,height:150.8,rotation:0},
      {id:"sw41-t0",type:"text",content:"CEREMONY \nCOMMENCES 4PM",x:286.0,y:227.0,fontSize:9.4,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:107.8,lineHeight:1.0,rotation:0},
      {id:"sw41-t1",type:"text",content:"RSVP BY \n12 AUGUST 2026",x:106.4,y:227.0,fontSize:9.4,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:72.2,lineHeight:1.01,rotation:0},
      {id:"sw41-t2",type:"text",content:"BLACK TIE",x:203.3,y:358.5,fontSize:9.4,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:100.2,lineHeight:1.2,rotation:0},
      {id:"sw41-t3",type:"text",content:"FOR MORE DETAILS \nAND TO RSVP PLEASE VISIT\nMONIQUEANDJAMES.COM.AU",x:66.8,y:327.3,fontSize:9.4,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:143.9,lineHeight:1.12,rotation:0},
      {id:"sw41-t4",type:"text",content:"PLEASE JOIN US TO CELEBRATE THE MARRIAGE OF",x:0.0,y:32.7,fontSize:9.4,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:400.0,lineHeight:1.2,rotation:0},
      {id:"sw41-t5",type:"text",content:"Monique Wells\nand\nJames Graham",x:0.0,y:75.8,fontSize:28.2,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:400.0,lineHeight:1.38,rotation:0},
      {id:"sw41-t6",type:"text",content:"12 \nOctober \n2025",x:10.2,y:246.8,fontSize:18.8,fontId:"mozart",italic:false,align:"center",color:"#000000",width:134.6,lineHeight:1.24,rotation:0}
    ]},
  { id:"sw42", collection:"swan-lake", name:"Front Option 1", category:"envelope-front", availableSizes:["190x130"], sizeKey:"190x130", background:"#FFFFFF", elements:[
      {id:"sw42-t0",type:"text",content:"Please Deliver To",x:0.0,y:114.8,fontSize:10.2,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:400.0,lineHeight:1.2,rotation:0},
      {id:"sw42-t1",type:"text",content:"Monique and James\n1 Example Street\nDouble Bay NSW 2010\n",x:0.0,y:134.8,fontSize:10.2,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:400.0,lineHeight:1.18,rotation:0}
    ]},
  { id:"sw43", collection:"swan-lake", name:"Back Option 1 (Euro Flap)", category:"envelope-back", availableSizes:["190x130"], sizeKey:"190x130", background:"#FFFFFF", elements:[
      {id:"sw43-t0",type:"text",content:"1 Example Street\nDouble Bay NSW 2010\n",x:242.8,y:221.6,fontSize:10.2,fontId:"dubiel",italic:false,align:"right",color:"#000000",width:123.6,lineHeight:1.18,rotation:0},
      {id:"sw43-t1",type:"text",content:"&",x:171.3,y:104.3,fontSize:20.1,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:30.1,lineHeight:1.2,rotation:0},
      {id:"sw43-t2",type:"text",content:"J",x:174.6,y:115.7,fontSize:30.5,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:52.4,lineHeight:1.2,rotation:0},
      {id:"sw43-t3",type:"text",content:"M",x:164.8,y:77.1,fontSize:29.0,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:70.3,lineHeight:1.2,rotation:0}
    ]},
  { id:"sw44", collection:"swan-lake", name:"Front Option 2", category:"envelope-front", availableSizes:["190x130"], sizeKey:"190x130", background:"#FFFFFF", elements:[
      {id:"sw44-aw0",type:"image",src:"/artwork/Double Swan copy.png?v=1783853115",fit:"fill",x:119.6,y:78.9,width:154.6,height:106.1,rotation:0},
      {id:"sw44-t0",type:"text",content:"Special  Delivery \n   For",x:46.3,y:146.6,fontSize:13.8,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:141.2,lineHeight:1.95,rotation:0},
      {id:"sw44-t1",type:"text",content:"Monique Bright and James Graham\n1 Example Street\nDouble Bay NSW 2010\n",x:221.9,y:102.1,fontSize:9.4,fontId:"dubiel",italic:false,align:"right",color:"#000000",width:131.8,lineHeight:1.33,rotation:0}
    ]},
  { id:"sw45", collection:"swan-lake", name:"Back Option 2 (iFlap)", category:"envelope-back", availableSizes:["190x130"], sizeKey:"190x130", background:"#FFFFFF", elements:[
      {id:"sw45-art0",type:"image",src:"/raster/sw45-art0.png?v=1783853115",fit:"fill",x:0.3,y:0.0,width:200.2,height:155.5,rotation:0},
      {id:"sw45-art1",type:"image",src:"/raster/sw45-art1.png?v=1783853115",fit:"fill",x:199.5,y:0.0,width:200.2,height:155.5,rotation:0},
      {id:"sw45-t0",type:"text",content:"With love from",x:138.2,y:62.4,fontSize:14.1,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:123.6,lineHeight:1.2,rotation:0},
      {id:"sw45-t1",type:"text",content:"Monique and James\n1 Example Street\nDouble Bay NSW 2010\n",x:138.2,y:87.9,fontSize:10.2,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:123.6,lineHeight:1.18,rotation:0}
    ]},
  { id:"sw46", collection:"swan-lake", name:"Front Option 1", category:"envelope-front", availableSizes:["130x130"], sizeKey:"130x130", background:"#FFFFFF", elements:[
      {id:"sw46-t0",type:"text",content:"Please Deliver To",x:0.0,y:158.8,fontSize:14.9,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:400.0,lineHeight:1.2,rotation:0},
      {id:"sw46-t1",type:"text",content:"Monique and James\n1 Example Street\nDouble Bay NSW 2010\n",x:0.0,y:188.1,fontSize:14.9,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:400.0,lineHeight:1.18,rotation:0}
    ]},
  { id:"sw47", collection:"swan-lake", name:"Back Option 1 (Euro Flap)", category:"envelope-back", availableSizes:["130x130"], sizeKey:"130x130", background:"#FFFFFF", elements:[
      {id:"sw47-t0",type:"text",content:"&",x:167.6,y:132.5,fontSize:22.6,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:33.9,lineHeight:1.2,rotation:0},
      {id:"sw47-t1",type:"text",content:"J",x:171.4,y:145.3,fontSize:34.3,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:59.0,lineHeight:1.2,rotation:0},
      {id:"sw47-t2",type:"text",content:"M",x:160.4,y:101.8,fontSize:32.6,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:79.2,lineHeight:1.2,rotation:0},
      {id:"sw47-t3",type:"text",content:"1 Example Street\nDouble Bay NSW 2010\n",x:167.3,y:320.4,fontSize:14.9,fontId:"dubiel",italic:false,align:"right",color:"#000000",width:180.7,lineHeight:1.18,rotation:0}
    ]},
  { id:"sw48", collection:"swan-lake", name:"Front Option 2", category:"envelope-front", availableSizes:["130x130"], sizeKey:"130x130", background:"#FFFFFF", elements:[
      {id:"sw48-aw0",type:"image",src:"/artwork/Double Swan copy.png?v=1783853115",fit:"fill",x:99.1,y:124.6,width:191.0,height:131.1,rotation:0},
      {id:"sw48-art0",type:"image",src:"/raster/sw48-art0.png?v=1783853115",fit:"fill",x:114.7,y:92.0,width:159.7,height:77.2,rotation:0},
      {id:"sw48-t0",type:"text",content:"Monique Bright and James Graham\n1 Example Street\nDouble Bay NSW 2010\n",x:113.2,y:269.6,fontSize:11.6,fontId:"dubiel",italic:false,align:"right",color:"#000000",width:162.8,lineHeight:1.33,rotation:0}
    ]},
  { id:"sw49", collection:"swan-lake", name:"Back Option 2 (iFlap)", category:"envelope-back", availableSizes:["130x130"], sizeKey:"130x130", background:"#FFFFFF", elements:[
      {id:"sw49-t0",type:"text",content:"With love from",x:109.7,y:116.7,fontSize:20.6,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:180.7,lineHeight:1.2,rotation:0},
      {id:"sw49-t1",type:"text",content:"Monique and James\n1 Example Street\nDouble Bay NSW 2010\n",x:109.6,y:153.9,fontSize:14.9,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:180.7,lineHeight:1.18,rotation:0}
    ]},
  { id:"sw50", collection:"swan-lake", name:"Option 1 (Euro Flap)", category:"envelope-liner", availableSizes:["liner-c5"], sizeKey:"liner-c5", background:"#FFFFFF", elements:[
      {id:"sw50-bg",type:"image",src:"/raster/sw50-bg.png?v=1783853115",fit:"fill",x:0.0,y:0.0,width:400.0,height:543.8,rotation:0}
    ]},
  { id:"sw51", collection:"swan-lake", name:"Option 1 (iFlap)", category:"envelope-liner", availableSizes:["liner-c5"], sizeKey:"liner-c5", background:"#FFFFFF", elements:[
      {id:"sw51-bg",type:"image",src:"/raster/sw51-bg.png?v=1783853115",fit:"fill",x:0.0,y:0.0,width:400.0,height:543.8,rotation:0}
    ]},
  { id:"sw52", collection:"swan-lake", name:"Option 1 (Euro Flap)", category:"envelope-liner", availableSizes:["liner-130x190"], sizeKey:"liner-130x190", background:"#FFFFFF", elements:[
      {id:"sw52-bg",type:"image",src:"/raster/sw52-bg.png?v=1783853115",fit:"fill",x:0.0,y:0.0,width:400.0,height:543.8,rotation:0}
    ]},
  { id:"sw53", collection:"swan-lake", name:"Option 1 (iFlap)", category:"envelope-liner", availableSizes:["liner-130x190"], sizeKey:"liner-130x190", background:"#FFFFFF", elements:[
      {id:"sw53-bg",type:"image",src:"/raster/sw53-bg.png?v=1783853115",fit:"fill",x:0.0,y:0.0,width:400.0,height:543.8,rotation:0}
    ]},
  { id:"sw54", collection:"swan-lake", name:"Option 1 (iFlap)", category:"envelope-liner", availableSizes:["liner-130x130"], sizeKey:"liner-130x130", background:"#FFFFFF", elements:[
      {id:"sw54-bg",type:"image",src:"/raster/sw54-bg.png?v=1783853115",fit:"fill",x:0.0,y:0.0,width:400.0,height:543.8,rotation:0}
    ]},
  { id:"sw55", collection:"swan-lake", name:"Option 2 (Euro Flap)", category:"envelope-liner", availableSizes:["liner-c5"], sizeKey:"liner-c5", background:"#FFFFFF", elements:[
      {id:"sw55-bg",type:"image",src:"/raster/sw55-bg.png?v=1783853115",fit:"fill",x:0.0,y:0.0,width:400.0,height:544.7,rotation:0},
      {id:"sw55-aw0",type:"image",src:"/artwork/Double Swan copy.png?v=1783853115",fit:"fill",x:130.5,y:101.4,width:139.0,height:95.4,rotation:0}
    ]},
  { id:"sw56", collection:"swan-lake", name:"Option 2 (iFlap)", category:"envelope-liner", availableSizes:["liner-c5"], sizeKey:"liner-c5", background:"#FFFFFF", elements:[
      {id:"sw56-bg",type:"image",src:"/raster/sw56-bg.png?v=1783853115",fit:"fill",x:0.0,y:0.0,width:400.0,height:544.7,rotation:0},
      {id:"sw56-aw0",type:"image",src:"/artwork/Double Swan copy.png?v=1783853115",fit:"fill",x:131.4,y:128.5,width:139.0,height:95.4,rotation:0}
    ]},
  { id:"sw57", collection:"swan-lake", name:"Option 3 (Euro Flap)", category:"envelope-liner", availableSizes:["liner-c5"], sizeKey:"liner-c5", background:"#FFFFFF", elements:[
      {id:"sw57-bg",type:"image",src:"/raster/sw57-bg.png?v=1783853115",fit:"fill",x:0.0,y:0.0,width:400.0,height:544.7,rotation:0},
      {id:"sw57-t0",type:"text",content:"&",x:170.3,y:141.1,fontSize:15.2,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:22.9,lineHeight:1.2,rotation:0},
      {id:"sw57-t1",type:"text",content:"J",x:172.9,y:149.7,fontSize:23.2,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:39.8,lineHeight:1.2,rotation:0},
      {id:"sw57-t2",type:"text",content:"M",x:165.5,y:120.4,fontSize:22.0,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:53.5,lineHeight:1.2,rotation:0}
    ]},
  { id:"sw58", collection:"swan-lake", name:"Option 3 (iFlap)", category:"envelope-liner", availableSizes:["liner-c5"], sizeKey:"liner-c5", background:"#FFFFFF", elements:[
      {id:"sw58-bg",type:"image",src:"/raster/sw58-bg.png?v=1783853115",fit:"fill",x:0.0,y:0.0,width:400.0,height:544.7,rotation:0},
      {id:"sw58-t0",type:"text",content:"&",x:172.1,y:170.4,fontSize:15.2,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:22.9,lineHeight:1.2,rotation:0},
      {id:"sw58-t1",type:"text",content:"J",x:174.7,y:179.1,fontSize:23.2,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:39.8,lineHeight:1.2,rotation:0},
      {id:"sw58-t2",type:"text",content:"M",x:167.2,y:149.7,fontSize:22.0,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:53.5,lineHeight:1.2,rotation:0}
    ]},
  { id:"sw59", collection:"swan-lake", name:"Option 2 (Euro Flap)", category:"envelope-liner", availableSizes:["liner-130x190"], sizeKey:"liner-130x190", background:"#FFFFFF", elements:[
      {id:"sw59-bg",type:"image",src:"/raster/sw59-bg.png?v=1783853115",fit:"fill",x:0.0,y:0.0,width:400.0,height:547.2,rotation:0},
      {id:"sw59-aw0",type:"image",src:"/artwork/Double Swan copy.png?v=1783853115",fit:"fill",x:137.7,y:115.2,width:139.7,height:95.9,rotation:0}
    ]},
  { id:"sw60", collection:"swan-lake", name:"Option 2 (iFlap)", category:"envelope-liner", availableSizes:["liner-130x190"], sizeKey:"liner-130x190", background:"#FFFFFF", elements:[
      {id:"sw60-bg",type:"image",src:"/raster/sw60-bg.png?v=1783853115",fit:"fill",x:0.0,y:0.0,width:400.0,height:543.8,rotation:0},
      {id:"sw60-aw0",type:"image",src:"/artwork/Double Swan copy.png?v=1783853115",fit:"fill",x:138.1,y:141.5,width:138.8,height:95.3,rotation:0}
    ]},
  { id:"sw61", collection:"swan-lake", name:"Option 3 (Euro Flap)", category:"envelope-liner", availableSizes:["liner-130x190"], sizeKey:"liner-130x190", background:"#FFFFFF", elements:[
      {id:"sw61-bg",type:"image",src:"/raster/sw61-bg.png?v=1783853115",fit:"fill",x:0.0,y:0.0,width:400.0,height:547.2,rotation:0},
      {id:"sw61-t0",type:"text",content:"&",x:178.0,y:149.0,fontSize:15.3,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:23.0,lineHeight:1.2,rotation:0},
      {id:"sw61-t1",type:"text",content:"J",x:180.6,y:157.6,fontSize:23.3,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:40.0,lineHeight:1.2,rotation:0},
      {id:"sw61-t2",type:"text",content:"M",x:173.1,y:128.2,fontSize:22.1,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:53.7,lineHeight:1.2,rotation:0}
    ]},
  { id:"sw62", collection:"swan-lake", name:"Option 3 (iFlap)", category:"envelope-liner", availableSizes:["liner-130x190"], sizeKey:"liner-130x190", background:"#FFFFFF", elements:[
      {id:"sw62-bg",type:"image",src:"/raster/sw62-bg.png?v=1783853115",fit:"fill",x:0.0,y:0.0,width:400.0,height:543.8,rotation:0},
      {id:"sw62-t0",type:"text",content:"&",x:175.8,y:170.9,fontSize:15.2,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:22.8,lineHeight:1.2,rotation:0},
      {id:"sw62-t1",type:"text",content:"J",x:178.3,y:179.6,fontSize:23.1,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:39.7,lineHeight:1.2,rotation:0},
      {id:"sw62-t2",type:"text",content:"M",x:170.9,y:150.3,fontSize:22.0,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:53.4,lineHeight:1.2,rotation:0}
    ]},
  { id:"sw63", collection:"swan-lake", name:"Option 2 (iFlap)", category:"envelope-liner", availableSizes:["liner-130x130"], sizeKey:"liner-130x130", background:"#FFFFFF", elements:[
      {id:"sw63-bg",type:"image",src:"/raster/sw63-bg.png?v=1783853115",fit:"fill",x:0.0,y:0.0,width:400.0,height:543.8,rotation:0},
      {id:"sw63-aw0",type:"image",src:"/artwork/Double Swan copy.png?v=1783853115",fit:"fill",x:138.1,y:117.0,width:138.8,height:95.3,rotation:0}
    ]},
  { id:"sw64", collection:"swan-lake", name:"Option 3 (iFlap)", category:"envelope-liner", availableSizes:["liner-130x130"], sizeKey:"liner-130x130", background:"#FFFFFF", elements:[
      {id:"sw64-bg",type:"image",src:"/raster/sw64-bg.png?v=1783853115",fit:"fill",x:0.0,y:0.0,width:400.0,height:543.8,rotation:0},
      {id:"sw64-t0",type:"text",content:"&",x:175.8,y:171.4,fontSize:15.2,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:22.8,lineHeight:1.2,rotation:0},
      {id:"sw64-t1",type:"text",content:"J",x:178.3,y:180.0,fontSize:23.1,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:39.7,lineHeight:1.2,rotation:0},
      {id:"sw64-t2",type:"text",content:"M",x:170.9,y:150.7,fontSize:22.0,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:53.4,lineHeight:1.2,rotation:0}
    ]},
  // ⟦generated-collection:swan-lake END⟧
  // ⟦generated-collection:swan-lake-signs START⟧ — auto-managed by splice_templates.py, do not hand-edit
  { id:"sl00", collection:"swan-lake", name:"Option 1", category:"wedding-welcome", availableSizes:["450x1000"], sizeKey:"450x1000", background:"#FFFFFF", elements:[
      {id:"sl00-t0",type:"text",content:"WELCOME TO \nTHE WEDDING OF",x:0.0,y:148.0,fontSize:15.1,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:400.1,lineHeight:1.38,rotation:0},
      {id:"sl00-t1",type:"text",content:"&",x:85.2,y:364.0,fontSize:36.8,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:46.6,lineHeight:1.2,rotation:0},
      {id:"sl00-t2",type:"text",content:"<span style=\"font-feature-settings: &quot;ss02&quot;;\">s</span>",x:282.1,y:414.2,fontSize:38.0,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:33.1,lineHeight:1.2,rotation:0},
      {id:"sl00-t3",type:"text",content:"AME",x:222.1,y:429.3,fontSize:27.6,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:145.7,lineHeight:1.2,rotation:0},
      {id:"sl00-t4",type:"text",content:"ONIQUE",x:190.3,y:329.3,fontSize:27.6,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:95.5,lineHeight:1.2,rotation:0},
      {id:"sl00-t5",type:"text",content:"J",x:148.5,y:379.7,fontSize:54.1,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:98.2,lineHeight:1.2,rotation:0},
      {id:"sl00-t6",type:"text",content:"M",x:66.9,y:294.7,fontSize:54.1,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:127.2,lineHeight:1.2,rotation:0},
      {id:"sl00-t7",type:"text",content:"12 OCTOBER 2026",x:0.0,y:581.1,fontSize:14.1,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:400.1,lineHeight:1.2,rotation:0}
    ]},
  { id:"sl01", collection:"swan-lake", name:"Option 2", category:"wedding-welcome", availableSizes:["450x1000"], sizeKey:"450x1000", background:"#FFFFFF", elements:[
      {id:"sl01-aw0",type:"image",src:"/artwork/Double Swan copy.png?v=1783852948",fit:"fill",x:95.8,y:468.2,width:214.9,height:147.5,rotation:0},
      {id:"sl01-t0",type:"text",content:"12 October 2025",x:4.1,y:665.2,fontSize:16.8,fontId:"mozart-light",italic:false,align:"center",color:"#231f20",width:391.7,lineHeight:1.2,rotation:0},
      {id:"sl01-t1",type:"text",content:"WELCOME TO\nTHE WEDDING OF",x:4.1,y:165.2,fontSize:13.8,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:391.7,lineHeight:1.5,rotation:0},
      {id:"sl01-t2",type:"text",content:"&",x:249.8,y:320.4,fontSize:29.9,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:37.8,lineHeight:1.2,rotation:0},
      {id:"sl01-t3",type:"text",content:"James",x:4.1,y:364.0,fontSize:43.9,fontId:"mozart-light",italic:false,align:"center",color:"#231f20",width:391.7,lineHeight:1.2,rotation:0},
      {id:"sl01-t4",type:"text",content:"Monique",x:4.1,y:260.3,fontSize:43.9,fontId:"mozart-light",italic:false,align:"center",color:"#231f20",width:391.7,lineHeight:1.2,rotation:0}
    ]},
  { id:"sl02", collection:"swan-lake", name:"Option 3", category:"wedding-welcome", availableSizes:["450x1000"], sizeKey:"450x1000", background:"#FFFFFF", elements:[
      {id:"sl02-aw1",type:"image",src:"/artwork/Lake.png?v=1783852948",fit:"fill",x:-0.1,y:0.0,width:399.5,height:889.0,rotation:0},
      {id:"sl02-aw0",type:"image",src:"/artwork/Double Swan copy.png?v=1783852948",fit:"fill",x:35.0,y:262.9,width:308.5,height:211.8,rotation:0},
      {id:"sl02-t0",type:"text",content:"&",x:75.3,y:585.4,fontSize:36.8,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:46.6,lineHeight:1.2,rotation:0},
      {id:"sl02-t1",type:"text",content:"<span style=\"font-feature-settings: &quot;ss02&quot;;\">s</span>",x:272.2,y:635.6,fontSize:38.0,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:33.1,lineHeight:1.2,rotation:0},
      {id:"sl02-t2",type:"text",content:"AME",x:212.2,y:650.8,fontSize:27.6,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:145.7,lineHeight:1.2,rotation:0},
      {id:"sl02-t3",type:"text",content:"ONIQUE",x:180.3,y:550.8,fontSize:27.6,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:95.5,lineHeight:1.2,rotation:0},
      {id:"sl02-t4",type:"text",content:"J",x:138.6,y:601.2,fontSize:54.1,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:98.2,lineHeight:1.2,rotation:0},
      {id:"sl02-t5",type:"text",content:"M",x:57.0,y:516.2,fontSize:54.1,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:127.2,lineHeight:1.2,rotation:0},
      {id:"sl02-t6",type:"text",content:"12 OCTOBER 2026",x:-0.1,y:752.5,fontSize:14.1,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:399.5,lineHeight:1.2,rotation:0},
      {id:"sl02-t7",type:"text",content:"WELCOME TO \nOUR WEDDING",x:0.5,y:125.6,fontSize:18.5,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:399.5,lineHeight:1.32,rotation:0}
    ]},
  { id:"sl03", collection:"swan-lake", name:"Option 1", category:"wedding-welcome", availableSizes:["700x1400"], sizeKey:"700x1400", background:"#FFFFFF", elements:[
      {id:"sl03-t0",type:"text",content:"WELCOME TO \nTHE WEDDING OF",x:0.1,y:129.2,fontSize:15.0,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:399.9,lineHeight:1.38,rotation:0},
      {id:"sl03-t1",type:"text",content:"&",x:85.3,y:342.6,fontSize:36.8,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:46.5,lineHeight:1.2,rotation:0},
      {id:"sl03-t2",type:"text",content:"<span style=\"font-feature-settings: &quot;ss02&quot;;\">s</span>",x:282.1,y:392.8,fontSize:37.9,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:33.1,lineHeight:1.2,rotation:0},
      {id:"sl03-t3",type:"text",content:"AME",x:222.1,y:408.0,fontSize:27.6,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:145.6,lineHeight:1.2,rotation:0},
      {id:"sl03-t4",type:"text",content:"ONIQUE",x:190.3,y:308.0,fontSize:27.6,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:95.4,lineHeight:1.2,rotation:0},
      {id:"sl03-t5",type:"text",content:"J",x:148.5,y:358.4,fontSize:54.0,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:98.1,lineHeight:1.2,rotation:0},
      {id:"sl03-t6",type:"text",content:"M",x:67.0,y:273.4,fontSize:54.0,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:127.2,lineHeight:1.2,rotation:0},
      {id:"sl03-t7",type:"text",content:"12 OCTOBER 2026",x:0.1,y:553.8,fontSize:14.1,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:399.9,lineHeight:1.2,rotation:0}
    ]},
  { id:"sl04", collection:"swan-lake", name:"Option 2", category:"wedding-welcome", availableSizes:["700x1400"], sizeKey:"700x1400", background:"#FFFFFF", elements:[
      {id:"sl04-t0",type:"text",content:"WELCOME TO",x:-0.0,y:230.1,fontSize:15.0,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:399.9,lineHeight:1.2,rotation:0},
      {id:"sl04-t1",type:"text",content:"the",x:204.8,y:311.3,fontSize:31.0,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:127.2,lineHeight:1.2,rotation:0},
      {id:"sl04-t2",type:"text",content:"<span style=\"font-feature-settings: &quot;ss02&quot;;\">s</span>",x:282.7,y:360.0,fontSize:29.6,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:61.6,lineHeight:1.2,rotation:0},
      {id:"sl04-t3",type:"text",content:"wedding",x:178.0,y:396.2,fontSize:31.0,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:140.9,lineHeight:1.2,rotation:0},
      {id:"sl04-t4",type:"text",content:"ATTHEW",x:173.0,y:368.8,fontSize:27.6,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:114.4,lineHeight:1.2,rotation:0},
      {id:"sl04-t5",type:"text",content:"M",x:55.8,y:334.2,fontSize:54.0,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:127.2,lineHeight:1.2,rotation:0},
      {id:"sl04-t6",type:"text",content:"12 OCTOBER 2026",x:-0.0,y:525.8,fontSize:14.1,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:399.9,lineHeight:1.2,rotation:0}
    ]},
  { id:"sl05", collection:"swan-lake", name:"Option 3", category:"wedding-welcome", availableSizes:["700x1400"], sizeKey:"700x1400", background:"#FFFFFF", elements:[
      {id:"sl05-r0",type:"image",src:"/raster/sl05-r0.png?v=1783852948",fit:"fill",x:0.0,y:0.1,width:399.9,height:799.9,rotation:0},
      {id:"sl05-t0",type:"text",content:"&",x:-3.9,y:469.7,fontSize:121.6,fontId:"mozart-light",italic:false,align:"right",color:"#000000",width:163.9,lineHeight:1.2,rotation:0},
      {id:"sl05-t1",type:"text",content:"J",x:-16.5,y:531.3,fontSize:176.2,fontId:"mozart-light",italic:false,align:"right",color:"#000000",width:331.7,lineHeight:1.2,rotation:0},
      {id:"sl05-t2",type:"text",content:"M",x:-11.5,y:305.6,fontSize:171.1,fontId:"mozart-light",italic:false,align:"right",color:"#000000",width:367.7,lineHeight:1.2,rotation:0},
      {id:"sl05-t3",type:"text",content:"to our",x:119.0,y:149.4,fontSize:35.1,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:173.6,lineHeight:1.2,rotation:0},
      {id:"sl05-t4s0",type:"text",content:"W",x:106.2,y:105.3,fontSize:35.1,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:53.2,lineHeight:1.2,rotation:0},
      {id:"sl05-t4s1",type:"text",content:"elcome",x:162.7,y:103.6,fontSize:35.1,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:104.6,lineHeight:1.2,rotation:0},
      {id:"sl05-t5s0",type:"text",content:"F",x:131.6,y:197.6,fontSize:35.1,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:17.3,lineHeight:1.2,rotation:0},
      {id:"sl05-t5s1",type:"text",content:"oreve",x:152.2,y:195.9,fontSize:35.1,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:82.7,lineHeight:1.2,rotation:0},
      {id:"sl05-t5s2",type:"text",content:"<span style=\"font-feature-settings: &quot;ss08&quot;;\">r</span>",x:238.2,y:197.6,fontSize:35.1,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:43.1,lineHeight:1.2,rotation:0}
    ]},
  { id:"sl06", collection:"swan-lake", name:"Option 1", category:"bar-sign", availableSizes:["450x1000"], sizeKey:"450x1000", background:"#FFFFFF", elements:[
      {id:"sl06-t0",type:"text",content:"Selection of soft drinks\nSparkling water",x:-0.1,y:715.9,fontSize:11.0,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:400.1,lineHeight:1.83,rotation:0},
      {id:"sl06-t1",type:"text",content:"Non-Alcoholic",x:-0.1,y:686.7,fontSize:17.2,fontId:"mozart-light",italic:false,align:"center",color:"#231f20",width:400.1,lineHeight:1.2,rotation:0},
      {id:"sl06-t2",type:"text",content:"Great Northern Super Crisp Lager\nCarlton Dry",x:-0.1,y:627.9,fontSize:11.0,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:400.1,lineHeight:1.83,rotation:0},
      {id:"sl06-t3",type:"text",content:"Beer",x:-0.1,y:598.4,fontSize:17.2,fontId:"mozart-light",italic:false,align:"center",color:"#231f20",width:400.1,lineHeight:1.2,rotation:0},
      {id:"sl06-t4",type:"text",content:"Tolpuddle Vineyard Pinot Noir\nPenfolds Bin 389 Cabernet Shiraz",x:-0.1,y:535.4,fontSize:11.0,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:400.1,lineHeight:1.83,rotation:0},
      {id:"sl06-t5",type:"text",content:"Red",x:-0.1,y:504.9,fontSize:17.2,fontId:"mozart-light",italic:false,align:"center",color:"#231f20",width:400.1,lineHeight:1.2,rotation:0},
      {id:"sl06-t6",type:"text",content:"Shaw + Smith Sauvignon Blanc\nLeeuwin Estate Art Series Chardonnay",x:-0.1,y:448.5,fontSize:11.0,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:400.1,lineHeight:1.83,rotation:0},
      {id:"sl06-t7",type:"text",content:"White",x:-0.1,y:423.1,fontSize:17.2,fontId:"mozart-light",italic:false,align:"center",color:"#231f20",width:400.1,lineHeight:1.2,rotation:0},
      {id:"sl06-t8",type:"text",content:"Howard Park NV Petit Jeté\nHouse of Arras Brut Elite Cuvée",x:-0.1,y:361.3,fontSize:11.0,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:400.1,lineHeight:1.83,rotation:0},
      {id:"sl06-t9",type:"text",content:"Bubbles",x:-0.1,y:329.5,fontSize:17.2,fontId:"mozart-light",italic:false,align:"center",color:"#231f20",width:400.1,lineHeight:1.2,rotation:0},
      {id:"sl06-t10",type:"text",content:"RINK",x:240.7,y:270.3,fontSize:21.0,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:55.5,lineHeight:1.2,rotation:0},
      {id:"sl06-t11",type:"text",content:"O",x:165.6,y:237.9,fontSize:21.0,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:14.3,lineHeight:1.2,rotation:0},
      {id:"sl06-t12",type:"text",content:"D",x:184.8,y:236.7,fontSize:41.1,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:74.6,lineHeight:1.2,rotation:0},
      {id:"sl06-t13",type:"text",content:"T",x:103.5,y:211.7,fontSize:41.1,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:66.6,lineHeight:1.2,rotation:0}
    ]},
  { id:"sl07", collection:"swan-lake", name:"Option 2", category:"bar-sign", availableSizes:["450x1000"], sizeKey:"450x1000", background:"#FFFFFF", elements:[
      {id:"sl07-border",type:"illustration",illustrationId:"border-sl07",illustrationSrc:"/borders/sl07-border.svg?v=1783852948",label:"Border",x:33.2,y:184.6,width:329.9,height:677.8,color:"#000000",rotation:0,stretch:true},
      {id:"sl07-aw0",type:"image",src:"/artwork/Swan with glasses_left_oil.png?v=1783852948",fit:"fill",x:15.0,y:618.0,width:122.4,height:135.5,rotation:0},
      {id:"sl07-aw1",type:"image",src:"/artwork/Swan with champagne bottle_left_oil.png?v=1783852948",fit:"fill",x:251.5,y:327.3,width:90.3,height:99.4,rotation:0},
      {id:"sl07-t0",type:"text",content:"Selection of soft drinks\nSparkling water",x:143.0,y:787.0,fontSize:11.0,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:222.5,lineHeight:1.83,rotation:0},
      {id:"sl07-t1",type:"text",content:"ON - ALCOHOLIC",x:192.7,y:763.6,fontSize:13.5,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:102.0,lineHeight:1.2,rotation:0},
      {id:"sl07-t2",type:"text",content:"N",x:141.9,y:745.2,fontSize:26.5,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:71.8,lineHeight:1.2,rotation:0},
      {id:"sl07-t3",type:"text",content:"Great Northern Super Crisp Lager\nCarlton Dry",x:100.9,y:675.9,fontSize:11.0,fontId:"dubiel",italic:false,align:"right",color:"#231f20",width:222.5,lineHeight:1.83,rotation:0},
      {id:"sl07-t4",type:"text",content:"EER",x:260.7,y:649.7,fontSize:13.5,fontId:"dubiel",italic:false,align:"right",color:"#231f20",width:62.7,lineHeight:1.2,rotation:0},
      {id:"sl07-t5",type:"text",content:"B",x:230.9,y:634.1,fontSize:26.5,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:71.8,lineHeight:1.2,rotation:0},
      {id:"sl07-t6",type:"text",content:"Tolpuddle Vineyard Pinot Noir\nPenfolds Bin 389 Cabernet Shiraz",x:73.4,y:590.5,fontSize:11.0,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:222.5,lineHeight:1.83,rotation:0},
      {id:"sl07-t7",type:"text",content:"ED",x:148.8,y:550.8,fontSize:13.5,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:62.7,lineHeight:1.2,rotation:0},
      {id:"sl07-t8",type:"text",content:"R",x:78.9,y:544.0,fontSize:26.5,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:71.8,lineHeight:1.2,rotation:0},
      {id:"sl07-t9",type:"text",content:"Shaw + Smith Sauvignon Blanc\nLeeuwin Estate Art Series Chardonnay",x:101.0,y:490.5,fontSize:11.0,fontId:"dubiel",italic:false,align:"right",color:"#231f20",width:222.5,lineHeight:1.83,rotation:0},
      {id:"sl07-t10",type:"text",content:"HITE",x:260.7,y:464.3,fontSize:13.5,fontId:"dubiel",italic:false,align:"right",color:"#231f20",width:62.7,lineHeight:1.2,rotation:0},
      {id:"sl07-t11",type:"text",content:"W",x:250.4,y:448.7,fontSize:26.5,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:71.8,lineHeight:1.2,rotation:0},
      {id:"sl07-t12",type:"text",content:"Howard Park NV Petit Jeté\nHouse of Arras Brut Elite Cuvée",x:73.5,y:413.3,fontSize:11.0,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:222.5,lineHeight:2.53,rotation:0},
      {id:"sl07-t13",type:"text",content:"UBBLES",x:148.9,y:373.6,fontSize:13.5,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:62.7,lineHeight:1.2,rotation:0},
      {id:"sl07-t14",type:"text",content:"B",x:79.0,y:366.8,fontSize:26.5,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:71.8,lineHeight:1.2,rotation:0},
      {id:"sl07-t15",type:"text",content:"AR",x:267.9,y:293.7,fontSize:20.8,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:55.1,lineHeight:1.2,rotation:0},
      {id:"sl07-t16",type:"text",content:"HE",x:175.9,y:259.4,fontSize:20.8,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:60.4,lineHeight:1.2,rotation:0},
      {id:"sl07-t17",type:"text",content:"B",x:160.4,y:283.2,fontSize:40.8,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:110.4,lineHeight:1.2,rotation:0},
      {id:"sl07-t18",type:"text",content:"T",x:109.8,y:236.4,fontSize:40.8,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:66.2,lineHeight:1.2,rotation:0}
    ]},
  { id:"sl08", collection:"swan-lake", name:"Option 3", category:"bar-sign", availableSizes:["450x1000"], sizeKey:"450x1000", background:"#FFFFFF", elements:[
      {id:"sl08-aw0",type:"image",src:"/artwork/Swan with glasses_left_oil.png?v=1783852948",fit:"fill",x:236.4,y:732.5,width:122.4,height:135.5,rotation:0},
      {id:"sl08-t0",type:"text",content:"Selection of soft drinks\nSparkling water\nTea + Coffee",x:205.9,y:692.5,fontSize:11.0,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:127.7,lineHeight:1.83,rotation:0},
      {id:"sl08-t1",type:"text",content:"Non  Alcoholic",x:51.8,y:692.5,fontSize:26.5,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:225.7,lineHeight:1.2,rotation:0},
      {id:"sl08-t2",type:"text",content:"Great Northern Super Crisp Lager\nCarlton Dry",x:86.8,y:611.8,fontSize:11.0,fontId:"dubiel",italic:false,align:"right",color:"#231f20",width:147.7,lineHeight:1.83,rotation:0},
      {id:"sl08-t3",type:"text",content:"Beer",x:243.9,y:613.3,fontSize:26.5,fontId:"mozart-light",italic:false,align:"right",color:"#231f20",width:107.5,lineHeight:1.2,rotation:0},
      {id:"sl08-t4",type:"text",content:"Tolpuddle Vineyard Pinot Noir\nPenfolds Bin 389 Cabernet Shiraz",x:157.6,y:527.4,fontSize:11.0,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:156.2,lineHeight:1.83,rotation:0},
      {id:"sl08-t5",type:"text",content:"Red",x:49.3,y:527.7,fontSize:26.5,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:118.1,lineHeight:1.2,rotation:0},
      {id:"sl08-t6",type:"text",content:"Shaw + Smith Sauvignon Blanc\nLeeuwin Estate Art Series Chardonnay",x:37.2,y:447.8,fontSize:11.0,fontId:"dubiel",italic:false,align:"right",color:"#231f20",width:222.5,lineHeight:1.83,rotation:0},
      {id:"sl08-t7",type:"text",content:"White",x:246.8,y:445.5,fontSize:26.5,fontId:"mozart-light",italic:false,align:"right",color:"#231f20",width:103.7,lineHeight:1.2,rotation:0},
      {id:"sl08-t8",type:"text",content:"Howard Park NV Petit Jeté\nHouse of Arras Brut Elite Cuvée",x:203.8,y:364.3,fontSize:11.0,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:156.1,lineHeight:1.83,rotation:0},
      {id:"sl08-t9",type:"text",content:"Bubbles",x:51.9,y:369.3,fontSize:26.5,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:157.2,lineHeight:1.2,rotation:0},
      {id:"sl08-t10",type:"text",content:"Bar",x:141.0,y:268.5,fontSize:48.5,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:250.9,lineHeight:1.2,rotation:0},
      {id:"sl08-t11",type:"text",content:"The",x:80.9,y:212.8,fontSize:48.5,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:185.7,lineHeight:1.2,rotation:0}
    ]},
  { id:"sl09", collection:"swan-lake", name:"Option 1", category:"table-number", availableSizes:["450x1000"], sizeKey:"450x1000", background:"#FFFFFF", elements:[
      {id:"sl09-r0",type:"image",src:"/raster/sl09-r0.png?v=1783852948",fit:"fill",x:0.1,y:0.0,width:399.8,height:888.9,rotation:0},
      {id:"sl09-t0",type:"text",content:"NE",x:219.3,y:421.9,fontSize:53.3,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:184.4,lineHeight:1.2,rotation:0},
      {id:"sl09-t1",type:"text",content:"O",x:96.7,y:355.0,fontSize:104.4,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:245.7,lineHeight:1.2,rotation:0}
    ]},
  { id:"sl10", collection:"swan-lake", name:"Option 2", category:"table-number", availableSizes:["450x1000"], sizeKey:"450x1000", background:"#FFFFFF", elements:[
      {id:"sl10-t0",type:"text",content:"ONE",x:147.5,y:437.5,fontSize:75.3,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:137.7,lineHeight:1.2,rotation:0},
      {id:"sl10-t1",type:"text",content:"Table",x:79.1,y:362.9,fontSize:60.8,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:245.7,lineHeight:1.2,rotation:0}
    ]},
  { id:"sl11", collection:"swan-lake", name:"Option 3", category:"table-number", availableSizes:["450x1000"], sizeKey:"450x1000", background:"#FFFFFF", elements:[
      {id:"sl11-aw2",type:"image",src:"/artwork/Lake.png?v=1783852948",fit:"fill",x:0.1,y:0.6,width:399.5,height:889.0,rotation:0},
      {id:"sl11-aw1",type:"image",src:"/artwork/Swan with glasses_no blue.png?v=1783852948",fit:"fill",x:192.3,y:544.3,width:183.7,height:203.3,rotation:0},
      {id:"sl11-aw0",type:"image",src:"/artwork/Swan with champagne no blue.png?v=1783852948",fit:"fill",x:76.3,y:186.2,width:143.9,height:158.4,rotation:0},
      {id:"sl11-t0",type:"text",content:"TABLE",x:234.5,y:450.8,fontSize:18.8,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:69.2,lineHeight:1.2,rotation:0},
      {id:"sl11-t1",type:"text",content:"One",x:110.0,y:445.4,fontSize:78.2,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:193.7,lineHeight:1.2,rotation:0}
    ]},
  { id:"sl12", collection:"swan-lake", name:"Option 1", category:"memorial", availableSizes:["450x1000"], sizeKey:"450x1000", background:"#FFFFFF", elements:[
      {id:"sl12-aw0",type:"image",src:"/artwork/Double Swan copy.png?v=1783852948",fit:"fill",x:92.6,y:699.5,width:214.9,height:147.5,rotation:0},
      {id:"sl12-t0",type:"text",content:"I’ll \nbe there",x:44.1,y:122.2,fontSize:50.8,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:311.9,lineHeight:1.24,rotation:0},
      {id:"sl12-t1",type:"text",content:"Grandpa Jones\nGrandma Smith\nJohn Michaels\nAmy Richards",x:0.1,y:498.0,fontSize:14.1,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:399.8,lineHeight:2.93,rotation:0},
      {id:"sl12-t2",type:"text",content:"I'm in heaven for your wedding, \nso what shall I do?\nI'll come to earth to spend \nthis special day with you.\nSo save me a seat, just a comfy chair, \nyou may not see me, \nbut I will be there.",x:0.1,y:287.4,fontSize:15.1,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:399.8,lineHeight:1.65,rotation:0}
    ]},
  { id:"sl13", collection:"swan-lake", name:"Option 2", category:"memorial", availableSizes:["450x1000"], sizeKey:"450x1000", background:"#FFFFFF", elements:[
      {"id": "sl13-t0", "type": "text", "content": "&", "x": 164.3, "y": 725.9, "fontSize": 17.9, "fontId": "mozart-light", "italic": false, "align": "left", "color": "#231f20", "width": 22.6, "lineHeight": 1.2, "rotation": 0},
      {"id": "sl13-t1", "type": "text", "content": "J", "x": 172.5, "y": 735.4, "fontSize": 26.3, "fontId": "mozart-light", "italic": false, "align": "left", "color": "#231f20", "width": 118.3, "lineHeight": 1.2, "rotation": 0},
      {"id": "sl13-t2", "type": "text", "content": "M", "x": 161.2, "y": 701.7, "fontSize": 26.3, "fontId": "mozart-light", "italic": false, "align": "left", "color": "#231f20", "width": 118.3, "lineHeight": 1.2, "rotation": 0},
      {"id": "sl13-t3", "type": "text", "content": "y   ", "x": 241.95, "y": 179.85, "fontSize": 36.1, "fontId": "mozart-light", "italic": false, "align": "center", "color": "#000000", "width": 86.3, "lineHeight": 1.2, "rotation": 0},
      {"id": "sl13-t4", "type": "text", "content": "M", "x": -9.25, "y": 177.3, "fontSize": 41.2, "fontId": "mozart-light", "italic": false, "align": "center", "color": "#000000", "width": 229.6, "lineHeight": 1.2, "rotation": 0},
      {"id": "sl13-t5s0", "type": "text", "content": "I", "x": 79.7, "y": 108.8, "fontSize": 41.2, "fontId": "mozart-light", "italic": false, "align": "left", "color": "#000000", "width": 63.5, "lineHeight": 1.2, "rotation": 0},
      {"id": "sl13-t5s1", "type": "text", "content": "N", "x": 145.5, "y": 115.9, "fontSize": 30.5, "fontId": "dubiel", "italic": false, "align": "left", "color": "#000000", "width": 20, "lineHeight": 1.2, "rotation": 0},
      {"id": "sl13-t5s2", "type": "text", "content": " L", "x": 178.5, "y": 108.8, "fontSize": 41.2, "fontId": "mozart-light", "italic": false, "align": "left", "color": "#000000", "width": 58.8, "lineHeight": 1.2, "rotation": 0},
      {"id": "sl13-t5s3", "type": "text", "content": "OVING", "x": 239.6, "y": 115.9, "fontSize": 30.5, "fontId": "dubiel", "italic": false, "align": "left", "color": "#000000", "width": 91, "lineHeight": 1.2, "rotation": 0},
      {"id": "sl13-t6", "type": "text", "content": "Grandpa Jones\nJohn Michaels\nAmy Richards", "x": 0.1, "y": 519.7, "fontSize": 18.8, "fontId": "dubiel", "italic": false, "align": "center", "color": "#000000", "width": 399.8, "lineHeight": 2.2, "rotation": 0},
      {"id": "sl13-t7s0", "type": "text", "content": "Of those who", "x": 149.1, "y": 308.3, "fontSize": 20.4, "fontId": "dubiel", "italic": false, "align": "left", "color": "#231f20", "width": 109.1, "lineHeight": 1.2, "rotation": 0},
      {"id": "sl13-t7s1", "type": "text", "content": "couldn’t be here today,", "x": 110.6, "y": 345.3, "fontSize": 20.4, "fontId": "dubiel", "italic": false, "align": "left", "color": "#231f20", "width": 180, "lineHeight": 1.2, "rotation": 0},
      {"id": "sl13-t7s2", "type": "text", "content": "but are forever", "x": 140.1, "y": 382.3, "fontSize": 20.4, "fontId": "dubiel", "italic": false, "align": "left", "color": "#231f20", "width": 126.9, "lineHeight": 1.2, "rotation": 0},
      {"id": "sl13-t7s3", "type": "text", "content": "in our hearts.", "x": 130.3, "y": 420.3, "fontSize": 20.4, "fontId": "mozart-light", "italic": false, "align": "left", "color": "#231f20", "width": 140.7, "lineHeight": 1.2, "rotation": 0},
      {"id": "el-1783468391525", "type": "text", "content": "EMOR", "x": 165.5, "y": 188, "fontSize": 30.5, "fontId": "dubiel", "italic": false, "align": "left", "color": "#000000", "width": 91, "lineHeight": 1.2, "rotation": 0, "letterSpacing": 7}
    ]},
  { id:"sl14", collection:"swan-lake", name:"Option 3", category:"memorial", availableSizes:["450x1000"], sizeKey:"450x1000", background:"#FFFFFF", elements:[
      {id:"sl14-r0",type:"image",src:"/raster/sl14-r0.png?v=1783852948",fit:"fill",x:0.0,y:0.0,width:400.0,height:889.0,rotation:0},
      {id:"sl14-t0s0",type:"text",content:"I",x:82.5,y:90.2,fontSize:39.2,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:60.4,lineHeight:1.2,rotation:0},
      {id:"sl14-t0s1",type:"text",content:"’LL",x:141.6,y:92.3,fontSize:34.5,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:43.9,lineHeight:1.2,rotation:0},
      {id:"sl14-t0s2",type:"text",content:" B",x:82.5,y:152.9,fontSize:39.2,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:118.7,lineHeight:1.2,rotation:0},
      {id:"sl14-t0s3",type:"text",content:"E",x:199.9,y:155.0,fontSize:34.5,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:19.9,lineHeight:1.2,rotation:0},
      {id:"sl14-t0s4",type:"text",content:"   T",x:82.5,y:215.7,fontSize:39.2,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:125.4,lineHeight:1.2,rotation:0},
      {id:"sl14-t0s5",type:"text",content:"HERE",x:210.9,y:217.7,fontSize:34.5,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:96.1,lineHeight:1.2,rotation:0},
      {id:"sl14-t1",type:"text",content:"GRANDPA JONES\nGRANDMA SMITH\nJOHN MICHAELS\nAMY RICHARDS",x:0.2,y:555.9,fontSize:15.7,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:399.8,lineHeight:2.8,rotation:0},
      {id:"sl14-t2",type:"text",content:"I'm in heaven for your wedding, \nso what shall I do?\nI'll come to earth to spend \nthis special day with you.\nSo save me a seat, just a comfy chair, \nyou may not see me, \nbut I will be there.",x:0.2,y:327.7,fontSize:15.7,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:399.8,lineHeight:1.64,rotation:0}
    ]},
  { id:"sl15", collection:"swan-lake", name:"Option 1", category:"wedding-seating", availableSizes:["700x1400"], sizeKey:"700x1400", background:"#FFFFFF", elements:[
      {id:"sl15-t0",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\nScheana Shae\nJames Kennedy\n ",x:273.7,y:573.6,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.56,rotation:0},
      {id:"sl15-t1",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\nScheana Shae\nJames Kennedy\n ",x:43.2,y:573.6,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.56,rotation:0},
      {id:"sl15-t2",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\nScheana Shae\nJames Kennedy\n ",x:158.8,y:573.7,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.56,rotation:0},
      {id:"sl15-t3",type:"text",content:"IX",x:317.8,y:545.8,fontSize:10.4,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:13.1,lineHeight:1.2,rotation:0},
      {id:"sl15-t4",type:"text",content:"S",x:289.6,y:532.7,fontSize:20.4,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:31.3,lineHeight:1.2,rotation:0},
      {id:"sl15-t5",type:"text",content:"IVE",x:203.7,y:547.3,fontSize:10.4,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:18.3,lineHeight:1.2,rotation:0},
      {id:"sl15-t6",type:"text",content:"F",x:172.5,y:534.3,fontSize:20.4,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:48.0,lineHeight:1.2,rotation:0},
      {id:"sl15-t7",type:"text",content:"OUR",x:84.0,y:550.3,fontSize:10.4,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:36.0,lineHeight:1.2,rotation:0},
      {id:"sl15-t8",type:"text",content:"F",x:53.4,y:537.3,fontSize:20.4,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:36.0,lineHeight:1.2,rotation:0},
      {id:"sl15-t9",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\nScheana Shae\nJames Kennedy\n ",x:274.5,y:326.4,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.56,rotation:0},
      {id:"sl15-t10",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\nScheana Shae\nJames Kennedy\n ",x:44.1,y:326.4,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.56,rotation:0},
      {id:"sl15-t11",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\nScheana Shae\nJames Kennedy\n ",x:159.6,y:326.5,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.56,rotation:0},
      {id:"sl15-t12",type:"text",content:"HREE",x:308.3,y:298.6,fontSize:10.4,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:35.7,lineHeight:1.2,rotation:0},
      {id:"sl15-t13",type:"text",content:"T",x:277.1,y:285.5,fontSize:20.4,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:48.0,lineHeight:1.2,rotation:0},
      {id:"sl15-t14",type:"text",content:"WO",x:206.2,y:300.1,fontSize:10.4,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:16.7,lineHeight:1.2,rotation:0},
      {id:"sl15-t15",type:"text",content:"T",x:175.0,y:287.1,fontSize:20.4,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:48.0,lineHeight:1.2,rotation:0},
      {id:"sl15-t16",type:"text",content:"NE",x:84.8,y:303.1,fontSize:10.4,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:36.0,lineHeight:1.2,rotation:0},
      {id:"sl15-t17",type:"text",content:"O",x:60.9,y:290.1,fontSize:20.4,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:48.0,lineHeight:1.2,rotation:0},
      {id:"sl15-t18",type:"text",content:"EOPLE",x:270.0,y:195.1,fontSize:23.7,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:81.0,lineHeight:1.2,rotation:0},
      {id:"sl15-t19",type:"text",content:"P",x:187.9,y:161.1,fontSize:46.4,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:104.3,lineHeight:1.2,rotation:0},
      {id:"sl15-t20",type:"text",content:"AVOURITE",x:116.3,y:145.0,fontSize:23.7,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:115.0,lineHeight:1.2,rotation:0},
      {id:"sl15-t21",type:"text",content:"OUR",x:219.3,y:98.9,fontSize:23.7,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:68.6,lineHeight:1.2,rotation:0},
      {id:"sl15-t22",type:"text",content:"F",x:42.3,y:119.5,fontSize:46.4,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:84.6,lineHeight:1.2,rotation:0},
      {id:"sl15-t23",type:"text",content:"O",x:167.6,y:66.3,fontSize:46.4,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:75.2,lineHeight:1.2,rotation:0}
    ]},
  { id:"sl16", collection:"swan-lake", name:"Option 2", category:"wedding-seating", availableSizes:["700x1400"], sizeKey:"700x1400", background:"#FFFFFF", elements:[
      {id:"sl16-t0",type:"text",content:"Twelve",x:294.5,y:587.2,fontSize:14.1,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:58.6,lineHeight:1.2,rotation:0},
      {id:"sl16-t1",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\n ",x:284.1,y:607.7,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.33,rotation:0},
      {id:"sl16-t2",type:"text",content:"Eleven",x:213.5,y:587.3,fontSize:14.1,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:58.6,lineHeight:1.2,rotation:0},
      {id:"sl16-t3",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\n ",x:203.1,y:607.8,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.33,rotation:0},
      {id:"sl16-t4",type:"text",content:"Ten",x:132.5,y:587.3,fontSize:14.1,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:58.6,lineHeight:1.2,rotation:0},
      {id:"sl16-t5",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\n ",x:122.1,y:607.8,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.33,rotation:0},
      {id:"sl16-t6",type:"text",content:"Nine",x:45.6,y:587.3,fontSize:14.1,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:58.6,lineHeight:1.2,rotation:0},
      {id:"sl16-t7",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\n ",x:35.1,y:607.8,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.33,rotation:0},
      {id:"sl16-t8",type:"text",content:"Eight",x:299.6,y:418.4,fontSize:14.1,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:58.6,lineHeight:1.2,rotation:0},
      {id:"sl16-t9",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\n ",x:289.2,y:438.9,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.33,rotation:0},
      {id:"sl16-t10",type:"text",content:"Seven",x:218.7,y:418.5,fontSize:14.1,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:58.6,lineHeight:1.2,rotation:0},
      {id:"sl16-t11",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\n ",x:208.2,y:439.0,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.33,rotation:0},
      {id:"sl16-t12",type:"text",content:"Six",x:137.6,y:418.4,fontSize:14.1,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:58.6,lineHeight:1.2,rotation:0},
      {id:"sl16-t13",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\n ",x:127.2,y:438.9,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.33,rotation:0},
      {id:"sl16-t14",type:"text",content:"Five",x:50.7,y:418.5,fontSize:14.1,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:58.6,lineHeight:1.2,rotation:0},
      {id:"sl16-t15",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\n ",x:40.2,y:439.0,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.33,rotation:0},
      {id:"sl16-t16",type:"text",content:"Four",x:296.6,y:250.5,fontSize:14.1,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:58.6,lineHeight:1.2,rotation:0},
      {id:"sl16-t17",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\n ",x:286.1,y:271.0,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.33,rotation:0},
      {id:"sl16-t18",type:"text",content:"Three",x:215.6,y:250.6,fontSize:14.1,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:58.6,lineHeight:1.2,rotation:0},
      {id:"sl16-t19",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\n ",x:205.2,y:271.1,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.33,rotation:0},
      {id:"sl16-t20",type:"text",content:"Two",x:134.6,y:250.6,fontSize:14.1,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:58.6,lineHeight:1.2,rotation:0},
      {id:"sl16-t21",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\n ",x:124.2,y:271.1,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.33,rotation:0},
      {id:"sl16-t22",type:"text",content:"One",x:47.6,y:250.7,fontSize:14.1,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:58.6,lineHeight:1.2,rotation:0},
      {id:"sl16-t23",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\n ",x:37.2,y:271.1,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.33,rotation:0},
      {id:"sl16-t24",type:"text",content:"WAITS",x:179.5,y:173.5,fontSize:23.7,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:81.0,lineHeight:1.2,rotation:0},
      {id:"sl16-t25",type:"text",content:"A",x:75.2,y:139.6,fontSize:46.4,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:104.3,lineHeight:1.2,rotation:0},
      {id:"sl16-t26",type:"text",content:"EAT",x:270.1,y:124.2,fontSize:23.7,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:115.0,lineHeight:1.2,rotation:0},
      {id:"sl16-t27",type:"text",content:"OUR",x:212.2,y:82.1,fontSize:23.7,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:68.6,lineHeight:1.2,rotation:0},
      {id:"sl16-t28",type:"text",content:"S",x:202.1,y:104.6,fontSize:46.4,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:84.6,lineHeight:1.2,rotation:0},
      {id:"sl16-t29",type:"text",content:"Y",x:143.2,y:49.5,fontSize:46.4,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:75.2,lineHeight:1.2,rotation:0}
    ]},
  { id:"sl17", collection:"swan-lake", name:"Option 3", category:"wedding-seating", availableSizes:["700x1400"], sizeKey:"700x1400", background:"#FFFFFF", elements:[
      {id:"sl17-t0",type:"text",content:"Z",x:269.4,y:649.6,fontSize:10.9,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:80.2,lineHeight:1.2,rotation:0},
      {id:"sl17-t1",type:"text",content:"Amelia Zhang\nCharlie ",x:271.7,y:670.1,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.38,rotation:0},
      {id:"sl17-t2",type:"text",content:"Y",x:277.2,y:566.0,fontSize:10.9,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:71.3,lineHeight:1.2,rotation:0},
      {id:"sl17-t3",type:"text",content:"Amelia Yates\nJames Young\nEmma York",x:270.6,y:592.5,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.38,rotation:0},
      {id:"sl17-t4",type:"text",content:"W",x:267.1,y:447.5,fontSize:10.9,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:80.2,lineHeight:1.2,rotation:0},
      {id:"sl17-t5",type:"text",content:"Amelia Ward\nJames Watson\nSophia West\nDaniel White\nEmma Williams\nLucas Wilkins",x:269.4,y:467.4,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.38,rotation:0},
      {id:"sl17-t6",type:"text",content:"V",x:266.0,y:344.9,fontSize:10.9,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:80.2,lineHeight:1.2,rotation:0},
      {id:"sl17-t7",type:"text",content:"Olivia Vaughan\nHenry Vickers\nAmelia Vincent\nJames Vance\nSophia Vega",x:268.3,y:364.8,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.38,rotation:0},
      {id:"sl17-t8",type:"text",content:"U",x:265.9,y:236.3,fontSize:10.9,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:80.2,lineHeight:1.2,rotation:0},
      {id:"sl17-t9",type:"text",content:"Emma Underwood\nJames Upton\nSophie Ulrich\nDaniel Underhill\nCharlotte Urban",x:268.2,y:259.2,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.38,rotation:0},
      {id:"sl17-t10",type:"text",content:"T",x:160.1,y:711.3,fontSize:10.9,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:80.2,lineHeight:1.2,rotation:0},
      {id:"sl17-t11",type:"text",content:"William Taylor\nIsla Thompson\nJames Turner",x:162.4,y:730.0,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.38,rotation:0},
      {id:"sl17-t12",type:"text",content:"Q - S",x:159.0,y:591.4,fontSize:10.9,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:80.2,lineHeight:1.2,rotation:0},
      {id:"sl17-t13",type:"text",content:"Oliver Quinn\nEmma Quinn\nLucas Reid\nSophie Rogers\nDaniel Scott\nChloe Stevens",x:161.3,y:614.3,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.38,rotation:0},
      {id:"sl17-t14",type:"text",content:"P",x:157.9,y:471.1,fontSize:10.9,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:80.2,lineHeight:1.2,rotation:0},
      {id:"sl17-t15",type:"text",content:"Ella Parker\nThomas Price\nMia Phillips\nGeorge Porter\nSophie Palmer\nOlivia Parsons",x:160.2,y:491.0,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.38,rotation:0},
      {id:"sl17-t16",type:"text",content:"M - O",x:156.7,y:327.8,fontSize:10.9,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:80.2,lineHeight:1.2,rotation:0},
      {id:"sl17-t17",type:"text",content:"Olivia Martin\nHenry Mitchell\nAva Nelson\nJack Oliver\nEmily Morgan\nJacob O’Brien\nGrace Miller\nThomas Osborne",x:159.0,y:347.7,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.38,rotation:0},
      {id:"sl17-t18",type:"text",content:"J - L",x:156.7,y:236.3,fontSize:10.9,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:80.2,lineHeight:1.2,rotation:0},
      {id:"sl17-t19",type:"text",content:"Ethan Johnson\nAmelia James\nLucas Kone\nSophia Lee",x:159.0,y:256.2,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.38,rotation:0},
      {id:"sl17-t20",type:"text",content:"I",x:42.8,y:662.4,fontSize:10.9,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:80.2,lineHeight:1.2,rotation:0},
      {id:"sl17-t21",type:"text",content:"Jacob Ingram\nLily Irving\nDaniel Isaacs\nSophia Innes\nThomas Irwin\nEmma Ives\nBenjamin Ingram",x:45.1,y:682.9,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.38,rotation:0},
      {id:"sl17-t22",type:"text",content:"G - H",x:41.7,y:565.4,fontSize:10.9,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:80.2,lineHeight:1.2,rotation:0},
      {id:"sl17-t23",type:"text",content:"Samuel Grant\nIsabella Gray\nAlexander Hughes\nCharlotte Hayes",x:44.0,y:592.0,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.38,rotation:0},
      {id:"sl17-t24",type:"text",content:"D - F",x:40.5,y:446.9,fontSize:10.9,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:80.2,lineHeight:1.2,rotation:0},
      {id:"sl17-t25",type:"text",content:"Laura Dawson\nBenjamin Douglas\nChloe Edwards\nPatrick Evans\nGrace Foster \nNathan Fisher",x:42.8,y:466.8,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.38,rotation:0},
      {id:"sl17-t26",type:"text",content:"C",x:39.4,y:344.4,fontSize:10.9,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:80.2,lineHeight:1.2,rotation:0},
      {id:"sl17-t27",type:"text",content:"Daniel Carter\nHannah Collins\nMatthew Clarke\nPhil Clarke\nRoger Clarke",x:41.7,y:364.3,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.38,rotation:0},
      {id:"sl17-t28",type:"text",content:"A - B",x:39.3,y:241.8,fontSize:10.9,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:80.2,lineHeight:1.2,rotation:0},
      {id:"sl17-t29",type:"text",content:"Emily Andrews\nJames Baxter\nOlivia Bennett\nWilliam Archer\nSophia Barnes ",x:41.6,y:261.7,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.38,rotation:0},
      {id:"sl17-t30",type:"text",content:"e",x:300.7,y:89.4,fontSize:26.2,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:38.8,lineHeight:1.2,rotation:0},
      {id:"sl17-t31",type:"text",content:"First",x:74.0,y:59.1,fontSize:42.5,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:208.9,lineHeight:1.2,rotation:0},
      {id:"sl17-t32",type:"text",content:"then we",x:184.2,y:126.4,fontSize:26.2,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:92.8,lineHeight:1.2,rotation:0},
      {id:"sl17-t33",type:"text",content:"Dance",x:98.1,y:135.1,fontSize:46.4,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:172.2,lineHeight:1.2,rotation:0},
      {id:"sl17-t34",type:"text",content:"we din",x:207.1,y:92.6,fontSize:38.1,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:140.0,lineHeight:1.2,rotation:0}
    ]},
  { id:"sl18", collection:"swan-lake", name:"Option 1", category:"wedding-welcome", availableSizes:["700x2000"], sizeKey:"700x2000", background:"#FFFFFF", elements:[
      {"id": "sl18-t0", "type": "text", "content": "WELCOME TO \nTHE WEDDING OF", "x": -0.1, "y": 166.4, "fontSize": 18.1, "fontId": "dubiel", "italic": false, "align": "center", "color": "#231f20", "width": 399.9, "lineHeight": 1.14, "rotation": 0},
      {"id": "sl18-t1", "type": "text", "content": "&", "x": 85.2, "y": 379.9, "fontSize": 36.8, "fontId": "mozart-light", "italic": false, "align": "left", "color": "#231f20", "width": 46.5, "lineHeight": 1.2, "rotation": 0},
      {"id": "sl18-t2", "type": "text", "content": "<span style=\"font-feature-settings: &quot;ss02&quot;;\">s</span>", "x": 280.6, "y": 433.9, "fontSize": 37.9, "fontId": "mozart-light", "italic": false, "align": "left", "color": "#231f20", "width": 33.1, "lineHeight": 1.2, "rotation": 0},
      {"id": "sl18-t3", "type": "text", "content": "AME", "x": 222, "y": 445.2, "fontSize": 27.6, "fontId": "dubiel", "italic": false, "align": "left", "color": "#231f20", "width": 145.6, "lineHeight": 1.2, "rotation": 0},
      {"id": "sl18-t4", "type": "text", "content": "ONIQUE", "x": 190.2, "y": 345.2, "fontSize": 27.6, "fontId": "dubiel", "italic": false, "align": "left", "color": "#231f20", "width": 95.4, "lineHeight": 1.2, "rotation": 0},
      {"id": "sl18-t5", "type": "text", "content": "J", "x": 148.4, "y": 395.6, "fontSize": 54, "fontId": "mozart-light", "italic": false, "align": "left", "color": "#231f20", "width": 98.1, "lineHeight": 1.2, "rotation": 0},
      {"id": "sl18-t6", "type": "text", "content": "M", "x": 66.8, "y": 310.6, "fontSize": 54, "fontId": "mozart-light", "italic": false, "align": "left", "color": "#231f20", "width": 127.2, "lineHeight": 1.2, "rotation": 0},
      {"id": "sl18-t7", "type": "text", "content": "12 OCTOBER 2026", "x": -0.1, "y": 591, "fontSize": 18.1, "fontId": "dubiel", "italic": false, "align": "center", "color": "#231f20", "width": 399.9, "lineHeight": 1.2, "rotation": 0}
    ]},
  { id:"sl19", collection:"swan-lake", name:"Option 2", category:"wedding-welcome", availableSizes:["700x2000"], sizeKey:"700x2000", background:"#FFFFFF", elements:[
      {"id": "sl19-t0", "type": "text", "content": "WELCOME TO", "x": 0, "y": 185.3, "fontSize": 18.1, "fontId": "dubiel", "italic": false, "align": "center", "color": "#231f20", "width": 400, "lineHeight": 1.2, "rotation": 0},
      {"id": "sl19-t1", "type": "text", "content": "the", "x": 212.3, "y": 294.9, "fontSize": 36.8, "fontId": "mozart-light", "italic": false, "align": "left", "color": "#231f20", "width": 150.7, "lineHeight": 1.2, "rotation": 0},
      {"id": "sl19-t2", "type": "text", "content": "<span style=\"font-feature-settings: &quot;ss09&quot;;\"><span style=\"font-feature-settings: &quot;ss02&quot;;\">s</span></span>", "x": 300, "y": 356.1, "fontSize": 35.1, "fontId": "mozart-light", "italic": false, "align": "left", "color": "#231f20", "width": 73, "lineHeight": 1.2, "rotation": 0},
      {"id": "sl19-t3", "type": "text", "content": "wedding", "x": 180.6, "y": 395.6, "fontSize": 36.8, "fontId": "mozart-light", "italic": false, "align": "left", "color": "#231f20", "width": 167, "lineHeight": 1.2, "rotation": 0},
      {"id": "sl19-t4", "type": "text", "content": "ATTHEW", "x": 174.7, "y": 363.1, "fontSize": 32.7, "fontId": "dubiel", "italic": false, "align": "left", "color": "#231f20", "width": 135.6, "lineHeight": 1.2, "rotation": 0},
      {"id": "sl19-t5", "type": "text", "content": "M", "x": 35.8, "y": 322.1, "fontSize": 64, "fontId": "mozart-light", "italic": false, "align": "left", "color": "#231f20", "width": 150.7, "lineHeight": 1.2, "rotation": 0},
      {"id": "sl19-t6", "type": "text", "content": "12 OCTOBER 2026", "x": 0, "y": 535.9, "fontSize": 18.1, "fontId": "dubiel", "italic": false, "align": "center", "color": "#231f20", "width": 400, "lineHeight": 1.2, "rotation": 0}
    ]},
  { id:"sl20", collection:"swan-lake", name:"Option 3", category:"wedding-welcome", availableSizes:["700x2000"], sizeKey:"700x2000", background:"#FFFFFF", elements:[
      {"id": "sl20-r0", "type": "image", "src": "/raster/sl20-r0.png?v=1783852948", "fit": "fill", "x": 0, "y": 0, "width": 400, "height": 1142.8, "rotation": 0},
      {"id": "sl20-t0", "type": "text", "content": "to our", "x": 90.6, "y": 318.4, "fontSize": 50.4, "fontId": "dubiel", "italic": false, "align": "center", "color": "#4E3324", "width": 249.1, "lineHeight": 1.2, "rotation": 0},
      {"id": "sl20-t1s0", "type": "text", "content": "W", "x": 72.2, "y": 255.2, "fontSize": 50.4, "fontId": "mozart-light", "italic": false, "align": "left", "color": "#4E3324", "width": 76, "lineHeight": 1.2, "rotation": 0},
      {"id": "sl20-t1s1", "type": "text", "content": "elcome", "x": 153.3, "y": 252.7, "fontSize": 50.4, "fontId": "dubiel", "italic": false, "align": "left", "color": "#4E3324", "width": 149.7, "lineHeight": 1.2, "rotation": 0},
      {"id": "sl20-t2s0", "type": "text", "content": "F", "x": 66.1, "y": 387.6, "fontSize": 50.4, "fontId": "mozart-light", "italic": false, "align": "left", "color": "#4E3324", "width": 24.5, "lineHeight": 1.2, "rotation": 0},
      {"id": "sl20-t2s1", "type": "text", "content": "oreve", "x": 156.0, "y": 387.6, "fontSize": 50.4, "fontId": "dubiel", "italic": false, "align": "left", "color": "#4E3324", "width": 118.3, "lineHeight": 1.2, "rotation": 0},
      {"id": "sl20-t2s2", "type": "text", "content": "<span style=\"font-feature-settings: &quot;ss12&quot;;\"><span style=\"font-feature-settings: &quot;ss12&quot;;\"><span style=\"font-feature-settings: &quot;ss11&quot;;\"><span style=\"font-feature-settings: &quot;ss09&quot;;\"><span style=\"font-feature-settings: &quot;ss11&quot;;\"><span style=\"font-feature-settings: &quot;ss09&quot;;\"><span style=\"font-feature-settings: &quot;ss08&quot;;\"><span style=\"font-feature-settings: &quot;ss07&quot;;\"><span style=\"font-feature-settings: &quot;ss12&quot;;\"><span style=\"font-feature-settings: &quot;ss11&quot;;\"><span style=\"font-feature-settings: &quot;ss03&quot;;\"><span style=\"font-feature-settings: &quot;ss07&quot;;\"><span style=\"font-feature-settings: &quot;ss08&quot;;\"><span style=\"font-feature-settings: &quot;calt&quot;;\"><span style=\"font-feature-settings: &quot;ss10&quot;;\"><span style=\"font-feature-settings: &quot;ss12&quot;;\">r</span></span></span></span></span></span></span></span></span></span></span></span></span></span></span></span>", "x": 254.39, "y": 387.6, "fontSize": 50.4, "fontId": "mozart-light", "italic": false, "align": "left", "color": "#4E3324", "width": 61.5, "lineHeight": 1.2, "rotation": 0},
      {"id": "sl20-t3", "type": "text", "content": "&", "x": -0.5, "y": 817.2, "fontSize": 121.6, "fontId": "mozart-light", "italic": false, "align": "right", "color": "#4E3324", "width": 163.9, "lineHeight": 1.2, "rotation": 0},
      {"id": "sl20-t4", "type": "text", "content": "J", "x": -9.4, "y": 878.8, "fontSize": 176.2, "fontId": "mozart-light", "italic": false, "align": "right", "color": "#4E3324", "width": 328, "lineHeight": 1.2, "rotation": 0, "hidden": false},
      {"id": "sl20-t5", "type": "text", "content": "M", "x": -9.4, "y": 653.1, "fontSize": 171.1, "fontId": "mozart-light", "italic": false, "align": "right", "color": "#4E3324", "width": 369.1, "lineHeight": 1.2, "rotation": 0, "hidden": false}
    ]},
  { id:"sl21", collection:"swan-lake", name:"Option 1", category:"wedding-seating", availableSizes:["700x2000"], sizeKey:"700x2000", background:"#FFFFFF", elements:[
      {id:"sl21-t0",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\nScheana Shae\nJames Kennedy\n ",x:273.1,y:845.3,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.56,rotation:0},
      {id:"sl21-t1",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\nScheana Shae\nJames Kennedy\n ",x:55.4,y:845.3,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.56,rotation:0},
      {id:"sl21-t2",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\nScheana Shae\nJames Kennedy\n ",x:163.7,y:845.4,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.56,rotation:0},
      {id:"sl21-t3",type:"text",content:"INE",x:323.7,y:817.5,fontSize:10.4,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:20.8,lineHeight:1.2,rotation:0},
      {id:"sl21-t4",type:"text",content:"N",x:286.8,y:804.5,fontSize:20.4,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:47.2,lineHeight:1.2,rotation:0},
      {id:"sl21-t5",type:"text",content:"IGHT",x:209.6,y:819.1,fontSize:10.4,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:28.4,lineHeight:1.2,rotation:0},
      {id:"sl21-t6",type:"text",content:"E",x:189.9,y:806.0,fontSize:20.4,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:48.0,lineHeight:1.2,rotation:0},
      {id:"sl21-t7",type:"text",content:"EVEN",x:90.1,y:822.0,fontSize:10.4,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:36.0,lineHeight:1.2,rotation:0},
      {id:"sl21-t8",type:"text",content:"S",x:62.6,y:809.0,fontSize:20.4,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:36.0,lineHeight:1.2,rotation:0},
      {id:"sl21-t9",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\nScheana Shae\nJames Kennedy\n ",x:271.8,y:595.5,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.56,rotation:0},
      {id:"sl21-t10",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\nScheana Shae\nJames Kennedy\n ",x:48.1,y:595.5,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.56,rotation:0},
      {id:"sl21-t11",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\nScheana Shae\nJames Kennedy\n ",x:163.6,y:595.6,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.56,rotation:0},
      {id:"sl21-t12",type:"text",content:"IX",x:316.0,y:567.7,fontSize:10.4,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:13.1,lineHeight:1.2,rotation:0},
      {id:"sl21-t13",type:"text",content:"S",x:287.8,y:554.7,fontSize:20.4,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:31.3,lineHeight:1.2,rotation:0},
      {id:"sl21-t14",type:"text",content:"IVE",x:208.6,y:569.3,fontSize:10.4,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:18.3,lineHeight:1.2,rotation:0},
      {id:"sl21-t15",type:"text",content:"F",x:177.4,y:556.2,fontSize:20.4,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:48.0,lineHeight:1.2,rotation:0},
      {id:"sl21-t16",type:"text",content:"OUR",x:88.9,y:572.2,fontSize:10.4,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:36.0,lineHeight:1.2,rotation:0},
      {id:"sl21-t17",type:"text",content:"F",x:58.3,y:559.2,fontSize:20.4,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:36.0,lineHeight:1.2,rotation:0},
      {id:"sl21-t18",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\nScheana Shae\nJames Kennedy\n ",x:272.7,y:348.3,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.56,rotation:0},
      {id:"sl21-t19",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\nScheana Shae\nJames Kennedy\n ",x:48.9,y:348.3,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.56,rotation:0},
      {id:"sl21-t20",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\nScheana Shae\nJames Kennedy\n ",x:164.4,y:348.4,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.56,rotation:0},
      {id:"sl21-t21",type:"text",content:"HREE",x:313.2,y:320.5,fontSize:10.4,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:35.7,lineHeight:1.2,rotation:0},
      {id:"sl21-t22",type:"text",content:"T",x:282.0,y:307.5,fontSize:20.4,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:48.0,lineHeight:1.2,rotation:0},
      {id:"sl21-t23",type:"text",content:"WO",x:211.0,y:322.1,fontSize:10.4,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:16.7,lineHeight:1.2,rotation:0},
      {id:"sl21-t24",type:"text",content:"T",x:179.8,y:309.0,fontSize:20.4,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:48.0,lineHeight:1.2,rotation:0},
      {id:"sl21-t25",type:"text",content:"NE",x:89.7,y:325.0,fontSize:10.4,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:36.0,lineHeight:1.2,rotation:0},
      {id:"sl21-t26",type:"text",content:"O",x:65.7,y:312.0,fontSize:20.4,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:48.0,lineHeight:1.2,rotation:0},
      {id:"sl21-t27",type:"text",content:"EOPLE",x:274.9,y:217.1,fontSize:23.7,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:81.0,lineHeight:1.2,rotation:0},
      {id:"sl21-t28",type:"text",content:"P",x:192.7,y:183.1,fontSize:46.4,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:104.3,lineHeight:1.2,rotation:0},
      {id:"sl21-t29",type:"text",content:"AVOURITE",x:121.2,y:166.9,fontSize:23.7,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:115.0,lineHeight:1.2,rotation:0},
      {id:"sl21-t30",type:"text",content:"OUR",x:224.1,y:120.8,fontSize:23.7,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:68.6,lineHeight:1.2,rotation:0},
      {id:"sl21-t31",type:"text",content:"F",x:47.1,y:141.4,fontSize:46.4,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:84.6,lineHeight:1.2,rotation:0},
      {id:"sl21-t32",type:"text",content:"O",x:172.5,y:88.2,fontSize:46.4,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:75.2,lineHeight:1.2,rotation:0}
    ]},
  { id:"sl22", collection:"swan-lake", name:"Option 2", category:"wedding-seating", availableSizes:["700x2000"], sizeKey:"700x2000", background:"#FFFFFF", elements:[
      {id:"sl22-t0",type:"text",content:"&",x:160.0,y:1017.0,fontSize:20.5,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:26.0,lineHeight:1.2,rotation:0},
      {id:"sl22-t1",type:"text",content:"J",x:169.4,y:1027.9,fontSize:30.2,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:135.9,lineHeight:1.2,rotation:0},
      {id:"sl22-t2",type:"text",content:"M",x:156.5,y:989.2,fontSize:30.2,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:135.9,lineHeight:1.2,rotation:0},
      {id:"sl22-t3",type:"text",content:"Sixteen",x:286.5,y:784.0,fontSize:14.1,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:58.6,lineHeight:1.2,rotation:0},
      {id:"sl22-t4",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\n ",x:276.0,y:804.5,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.33,rotation:0},
      {id:"sl22-t5",type:"text",content:"Fifteen",x:205.5,y:784.1,fontSize:14.1,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:58.6,lineHeight:1.2,rotation:0},
      {id:"sl22-t6",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\n ",x:195.1,y:804.6,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.33,rotation:0},
      {id:"sl22-t7",type:"text",content:"Fourteen",x:117.1,y:784.1,fontSize:14.1,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:69.5,lineHeight:1.2,rotation:0},
      {id:"sl22-t8",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\n ",x:114.0,y:804.6,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.33,rotation:0},
      {id:"sl22-t9",type:"text",content:"Thirteen",x:28.8,y:784.2,fontSize:14.1,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:67.4,lineHeight:1.2,rotation:0},
      {id:"sl22-t10",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\n ",x:27.1,y:804.7,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.33,rotation:0},
      {id:"sl22-t11",type:"text",content:"Twelve",x:284.4,y:612.8,fontSize:14.1,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:58.6,lineHeight:1.2,rotation:0},
      {id:"sl22-t12",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\n ",x:273.9,y:633.3,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.33,rotation:0},
      {id:"sl22-t13",type:"text",content:"Eleven",x:203.4,y:612.9,fontSize:14.1,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:58.6,lineHeight:1.2,rotation:0},
      {id:"sl22-t14",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\n ",x:193.0,y:633.4,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.33,rotation:0},
      {id:"sl22-t15",type:"text",content:"Ten",x:122.4,y:612.9,fontSize:14.1,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:58.6,lineHeight:1.2,rotation:0},
      {id:"sl22-t16",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\n ",x:111.9,y:633.3,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.33,rotation:0},
      {id:"sl22-t17",type:"text",content:"Nine",x:35.4,y:612.9,fontSize:14.1,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:58.6,lineHeight:1.2,rotation:0},
      {id:"sl22-t18",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\n ",x:25.0,y:633.4,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.33,rotation:0},
      {id:"sl22-t19",type:"text",content:"Eight",x:289.5,y:444.0,fontSize:14.1,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:58.6,lineHeight:1.2,rotation:0},
      {id:"sl22-t20",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\n ",x:279.0,y:464.5,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.33,rotation:0},
      {id:"sl22-t21",type:"text",content:"Seven",x:208.5,y:444.1,fontSize:14.1,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:58.6,lineHeight:1.2,rotation:0},
      {id:"sl22-t22",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\n ",x:198.1,y:464.6,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.33,rotation:0},
      {id:"sl22-t23",type:"text",content:"Six",x:127.5,y:444.0,fontSize:14.1,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:58.6,lineHeight:1.2,rotation:0},
      {id:"sl22-t24",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\n ",x:117.1,y:464.5,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.33,rotation:0},
      {id:"sl22-t25",type:"text",content:"Five",x:40.5,y:444.1,fontSize:14.1,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:58.6,lineHeight:1.2,rotation:0},
      {id:"sl22-t26",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\n ",x:30.1,y:464.6,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.33,rotation:0},
      {id:"sl22-t27",type:"text",content:"Four",x:286.5,y:276.1,fontSize:14.1,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:58.6,lineHeight:1.2,rotation:0},
      {id:"sl22-t28",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\n ",x:276.0,y:296.6,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.33,rotation:0},
      {id:"sl22-t29",type:"text",content:"Three",x:205.5,y:276.2,fontSize:14.1,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:58.6,lineHeight:1.2,rotation:0},
      {id:"sl22-t30",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\n ",x:195.1,y:296.7,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.33,rotation:0},
      {id:"sl22-t31",type:"text",content:"Two",x:124.5,y:276.2,fontSize:14.1,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:58.6,lineHeight:1.2,rotation:0},
      {id:"sl22-t32",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\n ",x:114.0,y:296.7,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.33,rotation:0},
      {id:"sl22-t33",type:"text",content:"One",x:37.5,y:276.3,fontSize:14.1,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:58.6,lineHeight:1.2,rotation:0},
      {id:"sl22-t34",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\n ",x:27.1,y:296.7,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.33,rotation:0},
      {id:"sl22-t35",type:"text",content:"WAITS",x:169.4,y:199.1,fontSize:23.7,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:81.0,lineHeight:1.2,rotation:0},
      {id:"sl22-t36",type:"text",content:"A",x:65.0,y:165.2,fontSize:46.4,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:104.3,lineHeight:1.2,rotation:0},
      {id:"sl22-t37",type:"text",content:"EAT",x:260.0,y:149.8,fontSize:23.7,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:115.0,lineHeight:1.2,rotation:0},
      {id:"sl22-t38",type:"text",content:"OUR",x:202.1,y:107.7,fontSize:23.7,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:68.6,lineHeight:1.2,rotation:0},
      {id:"sl22-t39",type:"text",content:"S",x:192.0,y:130.2,fontSize:46.4,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:84.6,lineHeight:1.2,rotation:0},
      {id:"sl22-t40",type:"text",content:"Y",x:133.1,y:75.1,fontSize:46.4,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:75.2,lineHeight:1.2,rotation:0}
    ]},
  { id:"sl23", collection:"swan-lake", name:"Option 3", category:"wedding-seating", availableSizes:["700x2000"], sizeKey:"700x2000", background:"#FFFFFF", elements:[
      {id:"sl23-t0",type:"text",content:"Z",x:276.7,y:721.7,fontSize:10.9,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:80.2,lineHeight:1.2,rotation:0},
      {id:"sl23-t1",type:"text",content:"Amelia Zhang\nCharlie Zhang\nBrian Zhang\nDenise Zhang",x:276.5,y:742.2,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.38,rotation:0},
      {id:"sl23-t2",type:"text",content:"Y",x:276.2,y:632.1,fontSize:10.9,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:80.2,lineHeight:1.2,rotation:0},
      {id:"sl23-t3",type:"text",content:"Amelia Yates\nJames Young\nEmma York",x:276.6,y:658.6,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.38,rotation:0},
      {id:"sl23-t4",type:"text",content:"W",x:276.8,y:480.9,fontSize:10.9,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:80.2,lineHeight:1.2,rotation:0},
      {id:"sl23-t5",type:"text",content:"Amelia Ward\nJames Watson\nSophia West\nDaniel White\nEmma Williams\nJohn Williams\nLucas Wilkins\nMatthew Wilkins",x:276.7,y:500.8,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.38,rotation:0},
      {id:"sl23-t6",type:"text",content:"V",x:277.5,y:370.5,fontSize:10.9,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:80.2,lineHeight:1.2,rotation:0},
      {id:"sl23-t7",type:"text",content:"Olivia Vaughan\nHenry Vickers\nAmelia Vincent\nJames Vance\nSophia Vega",x:276.8,y:390.4,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.38,rotation:0},
      {id:"sl23-t8",type:"text",content:"U",x:273.2,y:257.0,fontSize:10.9,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:80.2,lineHeight:1.2,rotation:0},
      {id:"sl23-t9",type:"text",content:"Emma Underwood\nJames Upton\nSophie Ulrich\nDaniel Underhill\nCharlotte Urban",x:276.7,y:279.9,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.38,rotation:0},
      {id:"sl23-t10",type:"text",content:"T",x:169.2,y:759.8,fontSize:10.9,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:80.2,lineHeight:1.2,rotation:0},
      {id:"sl23-t11",type:"text",content:"William Taylor\nAnna Thompson\nBree Thompson\nIsla Thompson\nJames Turner\nKate Turner\nLiam Turner\nMatt Turner",x:171.5,y:778.5,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.38,rotation:0},
      {id:"sl23-t12",type:"text",content:"Q - S",x:168.1,y:639.9,fontSize:10.9,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:80.2,lineHeight:1.2,rotation:0},
      {id:"sl23-t13",type:"text",content:"Oliver Quinn\nEmma Quinn\nLucas Reid\nSophie Rogers\nDaniel Scott\nChloe Stevens",x:171.6,y:662.8,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.38,rotation:0},
      {id:"sl23-t14",type:"text",content:"P",x:167.0,y:491.8,fontSize:10.9,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:80.2,lineHeight:1.2,rotation:0},
      {id:"sl23-t15",type:"text",content:"Ella Parker\nThomas Price\nMia Phillips\nGeorge Porter\nSophie Palmer\nAmy Parsons\nBree Parsons\nJames Parsons\nOlivia Parsons",x:171.7,y:511.7,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.38,rotation:0},
      {id:"sl23-t16",type:"text",content:"M - O",x:165.8,y:348.5,fontSize:10.9,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:80.2,lineHeight:1.2,rotation:0},
      {id:"sl23-t17",type:"text",content:"Olivia Martin\nHenry Mitchell\nAva Nelson\nJack Oliver\nEmily Morgan\nJacob O’Brien\nGrace Miller\nThomas Osborne",x:171.8,y:368.4,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.38,rotation:0},
      {id:"sl23-t18",type:"text",content:"J - L",x:170.0,y:257.0,fontSize:10.9,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:80.2,lineHeight:1.2,rotation:0},
      {id:"sl23-t19",type:"text",content:"Ethan Johnson\nAmelia James\nLucas Kone\nSophia Lee",x:171.7,y:276.9,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.38,rotation:0},
      {id:"sl23-t20",type:"text",content:"I",x:53.1,y:775.0,fontSize:10.9,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:80.2,lineHeight:1.2,rotation:0},
      {id:"sl23-t21",type:"text",content:"Jacob Ingram\nLily Irving\nDaniel Isaacs\nSophia Innes\nThomas Irwin\nEmma Ives\nBenjamin Ingram",x:51.1,y:795.5,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.38,rotation:0},
      {id:"sl23-t22",type:"text",content:"G - H",x:50.8,y:647.2,fontSize:10.9,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:80.2,lineHeight:1.2,rotation:0},
      {id:"sl23-t23",type:"text",content:"Samuel Grant\nAmelia Gray\nIsabella Gray\nAlexander Hughes\nCharlotte Hayes\nDonald Hayes",x:50.6,y:673.8,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.38,rotation:0},
      {id:"sl23-t24",type:"text",content:"D - F",x:50.8,y:497.3,fontSize:10.9,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:80.2,lineHeight:1.2,rotation:0},
      {id:"sl23-t25",type:"text",content:"Laura Dawson\nBenjamin Douglas\nChloe Edwards\nPatrick Evans\nGrace Foster \nNathan Fisher\nMatthew Fisher\nOwen Fisher\nPaula Fisher",x:50.7,y:517.2,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.38,rotation:0},
      {id:"sl23-t26",type:"text",content:"C",x:50.3,y:372.4,fontSize:10.9,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:80.2,lineHeight:1.2,rotation:0},
      {id:"sl23-t27",type:"text",content:"Daniel Carter\nHannah Collins\n Amy Clarke\nMatthew Clarke\nPhil Clarke\nRoger Clarke",x:50.8,y:392.3,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.38,rotation:0},
      {id:"sl23-t28",type:"text",content:"A - B",x:49.6,y:262.5,fontSize:10.9,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:80.2,lineHeight:1.2,rotation:0},
      {id:"sl23-t29",type:"text",content:"Emily Andrews\nJames Baxter\nOlivia Bennett\nWilliam Archer\nSophia Barnes ",x:50.7,y:282.4,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.38,rotation:0},
      {id:"sl23-t30",type:"text",content:"e",x:309.8,y:105.8,fontSize:26.2,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:38.8,lineHeight:1.2,rotation:0},
      {id:"sl23-t31",type:"text",content:"First",x:83.1,y:75.6,fontSize:42.5,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:208.9,lineHeight:1.2,rotation:0},
      {id:"sl23-t32",type:"text",content:"then we",x:193.3,y:142.9,fontSize:26.2,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:92.8,lineHeight:1.2,rotation:0},
      {id:"sl23-t33",type:"text",content:"Dance",x:107.2,y:151.6,fontSize:46.4,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:172.2,lineHeight:1.2,rotation:0},
      {id:"sl23-t34",type:"text",content:"we din",x:216.2,y:109.1,fontSize:38.1,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:140.0,lineHeight:1.2,rotation:0}
    ]},
  { id:"sl24", collection:"swan-lake", name:"Option 4", category:"wedding-welcome", availableSizes:["700x1400"], sizeKey:"700x1400", background:"#FFFFFF", elements:[
      {id:"sl24-aw0",type:"image",src:"/artwork/Double Swan copy.png?v=1783852948",fit:"fill",x:94.2,y:544.1,width:219.1,height:150.4,rotation:0},
      {id:"sl24-t0",type:"text",content:"12 October 2025",x:0.7,y:480.1,fontSize:18.1,fontId:"mozart-light",italic:false,align:"center",color:"#231f20",width:399.4,lineHeight:1.2,rotation:0},
      {id:"sl24-t1",type:"text",content:"WELCOME TO THE WEDDING OF",x:0.7,y:148.0,fontSize:11.5,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:399.4,lineHeight:1.2,rotation:0},
      {id:"sl24-t2",type:"text",content:"&",x:251.2,y:307.6,fontSize:35.7,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:53.2,lineHeight:1.2,rotation:0},
      {id:"sl24-t3",type:"text",content:"James",x:0.7,y:354.4,fontSize:50.4,fontId:"mozart-light",italic:false,align:"center",color:"#231f20",width:399.4,lineHeight:1.2,rotation:0},
      {id:"sl24-t4",type:"text",content:"Monique",x:0.7,y:231.2,fontSize:50.4,fontId:"mozart-light",italic:false,align:"center",color:"#231f20",width:399.4,lineHeight:1.2,rotation:0}
    ]},
  { id:"sl25", collection:"swan-lake", name:"Option 4", category:"wedding-welcome", availableSizes:["700x2000"], sizeKey:"700x2000", background:"#FFFFFF", elements:[
      {id:"sl25-aw0",type:"image",src:"/artwork/Double Swan copy.png?v=1783852948",fit:"fill",x:81.5,y:627.6,width:253.7,height:174.1,rotation:0},
      {id:"sl25-t0",type:"text",content:"12 October 2025",x:0.0,y:553.4,fontSize:21.0,fontId:"mozart-light",italic:false,align:"center",color:"#231f20",width:399.9,lineHeight:1.2,rotation:0},
      {id:"sl25-t1",type:"text",content:"WELCOME TO THE WEDDING OF",x:0.0,y:168.9,fontSize:15.1,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:399.9,lineHeight:1.2,rotation:0},
      {id:"sl25-t2",type:"text",content:"&",x:244.9,y:353.7,fontSize:41.3,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:61.7,lineHeight:1.2,rotation:0},
      {id:"sl25-t3",type:"text",content:"James",x:0.0,y:407.9,fontSize:58.4,fontId:"mozart-light",italic:false,align:"center",color:"#231f20",width:399.9,lineHeight:1.2,rotation:0},
      {id:"sl25-t4",type:"text",content:"Monique",x:0.0,y:265.3,fontSize:58.4,fontId:"mozart-light",italic:false,align:"center",color:"#231f20",width:399.9,lineHeight:1.2,rotation:0}
    ]},
  // ⟦generated-collection:swan-lake-signs END⟧
  // ⟦generated-collection:swan-lake-rigid START⟧ — auto-managed by splice_templates.py, do not hand-edit
  { id:"sr00", collection:"swan-lake", name:"Option 1", category:"wedding-welcome", material:"rigid", availableSizes:["a2"], sizeKey:"a2", background:"#FFFFFF", elements:[
      {id:"sr00-t0",type:"text",content:"WELCOME TO \nTHE WEDDING OF",x:0.2,y:95.9,fontSize:17.7,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:398.8,lineHeight:1.37,rotation:0},
      {id:"sr00-t1",type:"text",content:"&",x:86.6,y:280.8,fontSize:36.4,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:46.0,lineHeight:1.2,rotation:0},
      {id:"sr00-t2",type:"text",content:"<span style=\"font-feature-settings: &quot;ss02&quot;;\">s</span>",x:281.2,y:330.5,fontSize:37.5,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:32.7,lineHeight:1.2,rotation:0},
      {id:"sr00-t3",type:"text",content:"AME",x:221.9,y:345.4,fontSize:27.3,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:144.0,lineHeight:1.2,rotation:0},
      {id:"sr00-t4",type:"text",content:"ONIQUE",x:190.5,y:246.6,fontSize:27.3,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:94.4,lineHeight:1.2,rotation:0},
      {id:"sr00-t5",type:"text",content:"J",x:149.2,y:296.4,fontSize:53.4,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:97.1,lineHeight:1.2,rotation:0},
      {id:"sr00-t6",type:"text",content:"M",x:68.5,y:212.4,fontSize:53.4,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:125.8,lineHeight:1.2,rotation:0},
      {id:"sr00-t7",type:"text",content:"12 OCTOBER 2026",x:1.2,y:465.1,fontSize:17.7,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:397.6,lineHeight:1.2,rotation:0}
    ]},
  { id:"sr01", collection:"swan-lake", name:"Option 2", category:"wedding-welcome", material:"rigid", availableSizes:["a2"], sizeKey:"a2", background:"#FFFFFF", elements:[
      {id:"sr01-t0",type:"text",content:"WELCOME TO",x:1.0,y:102.4,fontSize:17.6,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:397.8,lineHeight:1.2,rotation:0},
      {id:"sr01-t1",type:"text",content:"the",x:205.4,y:212.1,fontSize:36.4,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:149.0,lineHeight:1.2,rotation:0},
      {id:"sr01-t2",type:"text",content:"<span style=\"font-feature-settings: &quot;ss02&quot;;\">s</span>",x:296.8,y:269.2,fontSize:34.7,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:72.2,lineHeight:1.2,rotation:0},
      {id:"sr01-t3",type:"text",content:"wedding",x:174.1,y:311.6,fontSize:36.4,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:165.1,lineHeight:1.2,rotation:0},
      {id:"sr01-t4",type:"text",content:"ATTHEW",x:168.3,y:279.4,fontSize:32.3,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:134.1,lineHeight:1.2,rotation:0},
      {id:"sr01-t5",type:"text",content:"M",x:30.8,y:238.9,fontSize:63.3,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:149.0,lineHeight:1.2,rotation:0},
      {id:"sr01-t6",type:"text",content:"12 OCTOBER 2026",x:1.0,y:449.1,fontSize:16.5,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:397.8,lineHeight:1.2,rotation:0}
    ]},
  { id:"sr02", collection:"swan-lake", name:"Option 3", category:"wedding-welcome", material:"rigid", availableSizes:["a2"], sizeKey:"a2", background:"#FFFFFF", elements:[
      {id:"sr02-r0",type:"image",src:"/raster/sr02-r0.png?v=1783852885",fit:"fill",x:0.1,y:0.0,width:399.8,height:565.7,rotation:0},
      {id:"sr02-t0",type:"text",content:" our",x:78.6,y:64.7,fontSize:35.3,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:174.6,lineHeight:1.2,rotation:0},
      {id:"sr02-t1",type:"text",content:"to",x:162.3,y:38.3,fontSize:35.3,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:90.8,lineHeight:1.2,rotation:0},
      {id:"sr02-t2s0",type:"text",content:"W",x:19.5,y:33.5,fontSize:35.3,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:54.1,lineHeight:1.2,rotation:0},
      {id:"sr02-t2s1",type:"text",content:"elcome",x:76.3,y:31.8,fontSize:35.3,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:105.7,lineHeight:1.2,rotation:0},
      {id:"sr02-t3s0",type:"text",content:"F",x:89.2,y:86.6,fontSize:35.3,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:17.9,lineHeight:1.2,rotation:0},
      {id:"sr02-t3s1",type:"text",content:"o re v e",x:109.9,y:84.8,fontSize:35.3,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:89.9,lineHeight:1.2,rotation:0},
      {id:"sr02-t3s2",type:"text",content:" r",x:198.4,y:86.6,fontSize:35.3,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:49.5,lineHeight:1.2,rotation:0},
      {id:"sr02-t4",type:"text",content:"&",x:-20.8,y:303.7,fontSize:94.5,fontId:"mozart-light",italic:false,align:"right",color:"#000000",width:157.8,lineHeight:1.2,rotation:0},
      {id:"sr02-t5",type:"text",content:"J",x:10.0,y:325.2,fontSize:169.6,fontId:"mozart-light",italic:false,align:"right",color:"#000000",width:315.8,lineHeight:1.2,rotation:0},
      {id:"sr02-t6",type:"text",content:"M",x:-20.9,y:156.1,fontSize:164.8,fontId:"mozart-light",italic:false,align:"right",color:"#000000",width:355.3,lineHeight:1.2,rotation:0}
    ]},
  { id:"sr03", collection:"swan-lake", name:"Option 1", category:"wedding-seating", material:"rigid", availableSizes:["a2"], sizeKey:"a2", background:"#FFFFFF", elements:[
      {id:"sr03-t0",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\nScheana Shae\nJames Kennedy\n ",x:210.4,y:393.8,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.1,lineHeight:1.56,rotation:0},
      {id:"sr03-t1",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\nScheana Shae\nJames Kennedy\n ",x:293.4,y:393.9,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.1,lineHeight:1.56,rotation:0},
      {id:"sr03-t2",type:"text",content:"IGHT",x:321.4,y:376.1,fontSize:8.0,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:21.8,lineHeight:1.2,rotation:0},
      {id:"sr03-t3",type:"text",content:"E",x:306.3,y:366.0,fontSize:15.6,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:36.8,lineHeight:1.2,rotation:0},
      {id:"sr03-t4",type:"text",content:"EVEN",x:237.0,y:376.0,fontSize:8.0,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:27.6,lineHeight:1.2,rotation:0},
      {id:"sr03-t5",type:"text",content:"S",x:215.9,y:366.0,fontSize:15.6,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:27.6,lineHeight:1.2,rotation:0},
      {id:"sr03-t6",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\nScheana Shae\nJames Kennedy\n ",x:125.1,y:392.6,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.1,lineHeight:1.56,rotation:0},
      {id:"sr03-t7",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\nScheana Shae\nJames Kennedy\n ",x:293.6,y:221.6,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.1,lineHeight:1.56,rotation:0},
      {id:"sr03-t8",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\nScheana Shae\nJames Kennedy\n ",x:42.0,y:392.7,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.1,lineHeight:1.56,rotation:0},
      {id:"sr03-t9",type:"text",content:"IX",x:158.9,y:375.6,fontSize:8.0,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:10.1,lineHeight:1.2,rotation:0},
      {id:"sr03-t10",type:"text",content:"S",x:137.3,y:365.5,fontSize:15.6,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:24.0,lineHeight:1.2,rotation:0},
      {id:"sr03-t11",type:"text",content:"IVE",x:76.5,y:375.3,fontSize:8.0,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:14.1,lineHeight:1.2,rotation:0},
      {id:"sr03-t12",type:"text",content:"F",x:52.6,y:365.3,fontSize:15.6,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:36.8,lineHeight:1.2,rotation:0},
      {id:"sr03-t13",type:"text",content:"OUR",x:324.9,y:205.8,fontSize:8.0,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:27.6,lineHeight:1.2,rotation:0},
      {id:"sr03-t14",type:"text",content:"F",x:301.4,y:195.8,fontSize:15.6,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:27.6,lineHeight:1.2,rotation:0},
      {id:"sr03-t15",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\nScheana Shae\nJames Kennedy\n ",x:208.6,y:221.4,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.1,lineHeight:1.56,rotation:0},
      {id:"sr03-t16",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\nScheana Shae\nJames Kennedy\n ",x:37.0,y:221.4,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.1,lineHeight:1.56,rotation:0},
      {id:"sr03-t17",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\nScheana Shae\nJames Kennedy\n ",x:125.6,y:221.5,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.1,lineHeight:1.56,rotation:0},
      {id:"sr03-t18",type:"text",content:"HREE",x:239.7,y:205.8,fontSize:8.0,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:27.4,lineHeight:1.2,rotation:0},
      {id:"sr03-t19",type:"text",content:"T",x:215.7,y:195.8,fontSize:15.6,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:36.8,lineHeight:1.2,rotation:0},
      {id:"sr03-t20",type:"text",content:"WO",x:161.3,y:205.5,fontSize:8.0,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:12.8,lineHeight:1.2,rotation:0},
      {id:"sr03-t21",type:"text",content:"T",x:137.4,y:195.5,fontSize:15.6,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:36.8,lineHeight:1.2,rotation:0},
      {id:"sr03-t22",type:"text",content:"NE",x:68.2,y:206.4,fontSize:8.0,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:27.6,lineHeight:1.2,rotation:0},
      {id:"sr03-t23",type:"text",content:"O",x:49.9,y:196.4,fontSize:15.6,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:36.8,lineHeight:1.2,rotation:0},
      {id:"sr03-t24",type:"text",content:"EOPLE",x:252.2,y:152.6,fontSize:19.5,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:66.7,lineHeight:1.2,rotation:0},
      {id:"sr03-t25",type:"text",content:"P",x:184.5,y:124.6,fontSize:38.2,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:85.9,lineHeight:1.2,rotation:0},
      {id:"sr03-t26",type:"text",content:"AVOURITE",x:125.6,y:111.2,fontSize:19.5,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:94.7,lineHeight:1.2,rotation:0},
      {id:"sr03-t27",type:"text",content:"OUR",x:210.4,y:73.3,fontSize:19.5,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:56.5,lineHeight:1.2,rotation:0},
      {id:"sr03-t28",type:"text",content:"F",x:64.6,y:90.3,fontSize:38.2,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:69.7,lineHeight:1.2,rotation:0},
      {id:"sr03-t29",type:"text",content:"O",x:167.9,y:46.4,fontSize:38.2,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:61.9,lineHeight:1.2,rotation:0}
    ]},
  { id:"sr04", collection:"swan-lake", name:"Option 2", category:"wedding-seating", material:"rigid", availableSizes:["a2"], sizeKey:"a2", background:"#FFFFFF", elements:[
      {id:"sr04-t0",type:"text",content:"Twelve",x:288.2,y:424.4,fontSize:10.8,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:45.0,lineHeight:1.2,rotation:0},
      {id:"sr04-t1",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\n ",x:280.2,y:440.1,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.1,lineHeight:1.22,rotation:0},
      {id:"sr04-t2",type:"text",content:"Eleven",x:216.8,y:424.5,fontSize:10.8,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:45.0,lineHeight:1.2,rotation:0},
      {id:"sr04-t3",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\n ",x:208.8,y:440.2,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.1,lineHeight:1.22,rotation:0},
      {id:"sr04-t4",type:"text",content:"Ten",x:141.2,y:424.4,fontSize:10.8,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:45.0,lineHeight:1.2,rotation:0},
      {id:"sr04-t5",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\n ",x:133.2,y:440.1,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.1,lineHeight:1.22,rotation:0},
      {id:"sr04-t6",type:"text",content:"Nine",x:64.6,y:424.5,fontSize:10.8,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:45.0,lineHeight:1.2,rotation:0},
      {id:"sr04-t7",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\n ",x:56.6,y:440.2,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.1,lineHeight:1.22,rotation:0},
      {id:"sr04-t8",type:"text",content:"Eight",x:292.1,y:311.2,fontSize:10.8,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:45.0,lineHeight:1.2,rotation:0},
      {id:"sr04-t9",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\n ",x:284.1,y:326.9,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.1,lineHeight:1.22,rotation:0},
      {id:"sr04-t10",type:"text",content:"Seven",x:220.8,y:311.2,fontSize:10.8,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:45.0,lineHeight:1.2,rotation:0},
      {id:"sr04-t11",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\n ",x:212.8,y:327.0,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.1,lineHeight:1.22,rotation:0},
      {id:"sr04-t12",type:"text",content:"Six",x:145.1,y:311.2,fontSize:10.8,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:45.0,lineHeight:1.2,rotation:0},
      {id:"sr04-t13",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\n ",x:137.1,y:326.9,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.1,lineHeight:1.22,rotation:0},
      {id:"sr04-t14",type:"text",content:"Five",x:68.5,y:311.3,fontSize:10.8,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:45.0,lineHeight:1.2,rotation:0},
      {id:"sr04-t15",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\n ",x:60.5,y:327.0,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.1,lineHeight:1.22,rotation:0},
      {id:"sr04-t16",type:"text",content:"Four",x:289.8,y:200.1,fontSize:10.8,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:45.0,lineHeight:1.2,rotation:0},
      {id:"sr04-t17",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\n ",x:281.8,y:215.8,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.1,lineHeight:1.22,rotation:0},
      {id:"sr04-t18",type:"text",content:"Three",x:218.5,y:200.2,fontSize:10.8,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:45.0,lineHeight:1.2,rotation:0},
      {id:"sr04-t19",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\n ",x:210.4,y:215.9,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.1,lineHeight:1.22,rotation:0},
      {id:"sr04-t20",type:"text",content:"Two",x:142.8,y:200.1,fontSize:10.8,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:45.0,lineHeight:1.2,rotation:0},
      {id:"sr04-t21",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\n ",x:134.8,y:215.9,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.1,lineHeight:1.22,rotation:0},
      {id:"sr04-t22",type:"text",content:"One",x:66.2,y:200.2,fontSize:10.8,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:45.0,lineHeight:1.2,rotation:0},
      {id:"sr04-t23",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\n ",x:58.2,y:215.9,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.1,lineHeight:1.22,rotation:0},
      {id:"sr04-t24",type:"text",content:"WAITS",x:185.3,y:138.5,fontSize:18.2,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:62.2,lineHeight:1.2,rotation:0},
      {id:"sr04-t25",type:"text",content:"A",x:105.3,y:112.4,fontSize:35.6,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:80.0,lineHeight:1.2,rotation:0},
      {id:"sr04-t26",type:"text",content:"EAT",x:254.8,y:100.6,fontSize:18.2,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:88.2,lineHeight:1.2,rotation:0},
      {id:"sr04-t27",type:"text",content:"OUR",x:210.4,y:68.3,fontSize:18.2,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:52.7,lineHeight:1.2,rotation:0},
      {id:"sr04-t28",type:"text",content:"S",x:202.6,y:85.6,fontSize:35.6,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:64.9,lineHeight:1.2,rotation:0},
      {id:"sr04-t29",type:"text",content:"Y",x:157.5,y:43.3,fontSize:35.6,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:57.7,lineHeight:1.2,rotation:0}
    ]},
  { id:"sr05", collection:"swan-lake", name:"Option 3", category:"wedding-seating", material:"rigid", availableSizes:["a2"], sizeKey:"a2", background:"#FFFFFF", elements:[
      {id:"sr05-t0",type:"text",content:"FIRST WE DINE",x:74.5,y:51.5,fontSize:32.6,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:299.2,lineHeight:1.2,rotation:0},
      {id:"sr05-t1",type:"text",content:"then we Dance",x:46.0,y:77.9,fontSize:43.7,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:318.3,lineHeight:1.2,rotation:0},
      {id:"sr05-t2",type:"text",content:"Daniel Scott\nRachel Scott\nChloe Stevens\nThomas Stevens\nOlivia Stevens",x:218.3,y:273.3,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.1,lineHeight:1.38,rotation:0},
      {id:"sr05-t3",type:"text",content:"S",x:218.2,y:254.0,fontSize:8.3,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:55.3,lineHeight:1.2,rotation:0},
      {id:"sr05-t4",type:"text",content:"Z",x:291.4,y:440.1,fontSize:8.3,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:61.6,lineHeight:1.2,rotation:0},
      {id:"sr05-t5",type:"text",content:"Amelia Zhang\nCharlie Zhang\nBrian Zhang\nDenise Zhang",x:291.3,y:455.8,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.1,lineHeight:1.38,rotation:0},
      {id:"sr05-t6",type:"text",content:"Y",x:291.0,y:371.3,fontSize:8.3,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:61.6,lineHeight:1.2,rotation:0},
      {id:"sr05-t7",type:"text",content:"Amelia Yates\nJames Young\nEmma York",x:291.4,y:391.6,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.1,lineHeight:1.38,rotation:0},
      {id:"sr05-t8",type:"text",content:"W",x:291.5,y:255.3,fontSize:8.3,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:61.6,lineHeight:1.2,rotation:0},
      {id:"sr05-t9",type:"text",content:"Amelia Ward\nJames Watson\nSophia West\nDaniel White\nEmma Williams\nJohn Williams\nLucas Wilkins\nMatthew Wilkins",x:291.5,y:270.6,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.1,lineHeight:1.38,rotation:0},
      {id:"sr05-t10",type:"text",content:"V",x:292.1,y:170.6,fontSize:8.3,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:61.6,lineHeight:1.2,rotation:0},
      {id:"sr05-t11",type:"text",content:"Olivia Vaughan\nHenry Vickers\nAmelia Vincent\nJames Vance\nSophia Vega",x:291.5,y:185.9,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.1,lineHeight:1.38,rotation:0},
      {id:"sr05-t12",type:"text",content:"U",x:213.2,y:450.9,fontSize:8.3,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:61.6,lineHeight:1.2,rotation:0},
      {id:"sr05-t13",type:"text",content:"Emma Underwood\nJames Upton\nSophie Ulrich\nDaniel Underhill\nCharlotte Urban",x:215.9,y:468.5,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.1,lineHeight:1.38,rotation:0},
      {id:"sr05-t14",type:"text",content:"T",x:213.0,y:339.1,fontSize:8.3,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:61.6,lineHeight:1.2,rotation:0},
      {id:"sr05-t15",type:"text",content:"William Taylor\nAnna Thompson\nBree Thompson\nIsla Thompson\nJames Turner\nKate Turner\nLiam Turner\nMatt Turner",x:214.8,y:353.5,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.1,lineHeight:1.38,rotation:0},
      {id:"sr05-t16",type:"text",content:"Q ",x:219.1,y:168.9,fontSize:8.3,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:55.3,lineHeight:1.2,rotation:0},
      {id:"sr05-t17",type:"text",content:"Oliver Quinn\nEmma Quinn\nLucas Reid\nSophie Rogers\nThomas Rogers",x:214.9,y:185.8,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.1,lineHeight:1.38,rotation:0},
      {id:"sr05-t18",type:"text",content:"P",x:131.7,y:451.3,fontSize:8.3,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:61.6,lineHeight:1.2,rotation:0},
      {id:"sr05-t19",type:"text",content:"Ella Parker\nThomas Price\nMia Phillips\nGeorge Porter\nSophie Palmer",x:135.3,y:466.5,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.1,lineHeight:1.38,rotation:0},
      {id:"sr05-t20",type:"text",content:"M - O",x:130.8,y:341.3,fontSize:8.3,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:61.6,lineHeight:1.2,rotation:0},
      {id:"sr05-t21",type:"text",content:"Olivia Martin\nHenry Mitchell\nAva Nelson\nJack Oliver\nEmily Morgan\nJacob O’Brien\nGrace Miller\nThomas Osborne",x:135.3,y:356.6,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.1,lineHeight:1.38,rotation:0},
      {id:"sr05-t22",type:"text",content:"J - L",x:134.0,y:271.1,fontSize:8.3,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:61.6,lineHeight:1.2,rotation:0},
      {id:"sr05-t23",type:"text",content:"Ethan Johnson\nAmelia James\nLucas Kone\nSophia Lee",x:135.3,y:286.4,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.1,lineHeight:1.38,rotation:0},
      {id:"sr05-t24",type:"text",content:"I",x:134.8,y:169.8,fontSize:8.3,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:61.6,lineHeight:1.2,rotation:0},
      {id:"sr05-t25",type:"text",content:"Jacob Ingram\nLily Irving\nDaniel Isaacs\nSophia Innes\nThomas Irwin\nEmma Ives\nBenjamin Ingram",x:133.3,y:185.5,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.1,lineHeight:1.38,rotation:0},
      {id:"sr05-t26",type:"text",content:"G - H",x:49.6,y:445.3,fontSize:8.3,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:61.6,lineHeight:1.2,rotation:0},
      {id:"sr05-t27",type:"text",content:"Samuel Grant\nAmelia Gray\nIsabella Gray\nAlexander Hughes\nCharlotte Hayes\nDonald Hayes",x:49.5,y:465.7,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.1,lineHeight:1.38,rotation:0},
      {id:"sr05-t28",type:"text",content:"D - F",x:49.7,y:330.3,fontSize:8.3,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:61.6,lineHeight:1.2,rotation:0},
      {id:"sr05-t29",type:"text",content:"Laura Dawson\nBenjamin Douglas\nChloe Edwards\nPatrick Evans\nGrace Foster \nNathan Fisher\nMatthew Fisher\nOwen Fisher\nPaula Fisher",x:49.6,y:345.5,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.1,lineHeight:1.38,rotation:0},
      {id:"sr05-t30",type:"text",content:"C",x:49.3,y:254.0,fontSize:8.3,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:61.6,lineHeight:1.2,rotation:0},
      {id:"sr05-t31",type:"text",content:"Daniel Carter\nHannah Collins\n Amy Clarke\nMatthew Clarke",x:49.6,y:269.3,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.1,lineHeight:1.38,rotation:0},
      {id:"sr05-t32",type:"text",content:"A - B",x:48.8,y:169.7,fontSize:8.3,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:61.6,lineHeight:1.2,rotation:0},
      {id:"sr05-t33",type:"text",content:"Emily Andrews\nJames Baxter\nOlivia Bennett\nWilliam Archer\nSophia Barnes ",x:49.6,y:185.0,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.1,lineHeight:1.38,rotation:0}
    ]},
  { id:"sr06", collection:"swan-lake", name:"Option 1", category:"wedding-welcome", material:"rigid", availableSizes:["a1"], sizeKey:"a1", background:"#FFFFFF", elements:[
      {id:"sr06-t0",type:"text",content:"WELCOME TO \nTHE WEDDING OF",x:0.1,y:90.3,fontSize:17.8,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:399.8,lineHeight:1.37,rotation:0},
      {id:"sr06-t1",type:"text",content:"&",x:86.0,y:276.3,fontSize:36.6,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:46.3,lineHeight:1.2,rotation:0},
      {id:"sr06-t2",type:"text",content:"<span style=\"font-feature-settings: &quot;ss02&quot;;\">s</span>",x:281.7,y:326.2,fontSize:37.7,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:32.9,lineHeight:1.2,rotation:0},
      {id:"sr06-t3",type:"text",content:"AME",x:222.1,y:341.3,fontSize:27.4,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:144.8,lineHeight:1.2,rotation:0},
      {id:"sr06-t4",type:"text",content:"ONIQUE",x:190.4,y:241.8,fontSize:27.4,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:94.9,lineHeight:1.2,rotation:0},
      {id:"sr06-t5",type:"text",content:"J",x:148.9,y:291.9,fontSize:53.7,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:97.6,lineHeight:1.2,rotation:0},
      {id:"sr06-t6",type:"text",content:"M",x:67.8,y:207.4,fontSize:53.7,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:126.5,lineHeight:1.2,rotation:0},
      {id:"sr06-t7",type:"text",content:"12 OCTOBER 2026",x:0.1,y:461.6,fontSize:17.8,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:399.8,lineHeight:1.2,rotation:0}
    ]},
  { id:"sr07", collection:"swan-lake", name:"Option 2", category:"wedding-welcome", material:"rigid", availableSizes:["a1"], sizeKey:"a1", background:"#FFFFFF", elements:[
      {id:"sr07-t0",type:"text",content:"WELCOME TO",x:0.0,y:94.4,fontSize:17.7,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:400.1,lineHeight:1.2,rotation:0},
      {id:"sr07-t1",type:"text",content:"the",x:205.6,y:204.6,fontSize:36.6,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:149.8,lineHeight:1.2,rotation:0},
      {id:"sr07-t2",type:"text",content:"<span style=\"font-feature-settings: &quot;ss02&quot;;\">s</span>",x:297.4,y:262.0,fontSize:34.9,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:72.6,lineHeight:1.2,rotation:0},
      {id:"sr07-t3",type:"text",content:"wedding",x:174.0,y:304.7,fontSize:36.6,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:166.0,lineHeight:1.2,rotation:0},
      {id:"sr07-t4",type:"text",content:"ATTHEW",x:168.2,y:272.3,fontSize:32.5,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:134.8,lineHeight:1.2,rotation:0},
      {id:"sr07-t5",type:"text",content:"M",x:30.0,y:231.6,fontSize:63.7,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:149.8,lineHeight:1.2,rotation:0},
      {id:"sr07-t6",type:"text",content:"12 OCTOBER 2026",x:0.0,y:442.9,fontSize:16.6,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:400.1,lineHeight:1.2,rotation:0}
    ]},
  { id:"sr08", collection:"swan-lake", name:"Option 3", category:"wedding-welcome", material:"rigid", availableSizes:["a1"], sizeKey:"a1", background:"#FFFFFF", elements:[
      {id:"sr08-r0",type:"image",src:"/raster/sr08-r0.png?v=1783852885",fit:"fill",x:0.0,y:0.0,width:400.0,height:566.3,rotation:0},
      {id:"sr08-t0",type:"text",content:" our",x:78.9,y:65.0,fontSize:35.5,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:175.6,lineHeight:1.2,rotation:0},
      {id:"sr08-t1",type:"text",content:"to",x:163.2,y:38.5,fontSize:35.5,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:91.3,lineHeight:1.2,rotation:0},
      {id:"sr08-t2s0",type:"text",content:"W",x:19.5,y:33.6,fontSize:35.5,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:54.0,lineHeight:1.2,rotation:0},
      {id:"sr08-t2s1",type:"text",content:"elcome",x:76.7,y:31.9,fontSize:35.5,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:105.9,lineHeight:1.2,rotation:0},
      {id:"sr08-t3s0",type:"text",content:"F",x:89.6,y:87.0,fontSize:35.5,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:17.6,lineHeight:1.2,rotation:0},
      {id:"sr08-t3s1",type:"text",content:"o re v e",x:110.4,y:85.3,fontSize:35.5,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:90.0,lineHeight:1.2,rotation:0},
      {id:"sr08-t3s2",type:"text",content:" r",x:199.4,y:87.0,fontSize:35.5,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:49.4,lineHeight:1.2,rotation:0},
      {id:"sr08-t4",type:"text",content:"&",x:-21.0,y:305.3,fontSize:95.0,fontId:"mozart-light",italic:false,align:"right",color:"#000000",width:158.7,lineHeight:1.2,rotation:0},
      {id:"sr08-t5",type:"text",content:"J",x:10.0,y:326.9,fontSize:170.6,fontId:"mozart-light",italic:false,align:"right",color:"#000000",width:317.5,lineHeight:1.2,rotation:0},
      {id:"sr08-t6",type:"text",content:"M",x:-21.1,y:156.9,fontSize:165.7,fontId:"mozart-light",italic:false,align:"right",color:"#000000",width:357.3,lineHeight:1.2,rotation:0}
    ]},
  { id:"sr09", collection:"swan-lake", name:"Option 1", category:"wedding-seating", material:"rigid", availableSizes:["a1"], sizeKey:"a1", background:"#FFFFFF", elements:[
      {id:"sr09-t0",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\nScheana Shae\nJames Kennedy\n ",x:210.8,y:396.8,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.5,lineHeight:1.56,rotation:0},
      {id:"sr09-t1",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\nScheana Shae\nJames Kennedy\n ",x:294.3,y:396.9,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.5,lineHeight:1.56,rotation:0},
      {id:"sr09-t2",type:"text",content:"IGHT",x:322.4,y:378.9,fontSize:8.0,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:21.9,lineHeight:1.2,rotation:0},
      {id:"sr09-t3",type:"text",content:"E",x:307.2,y:368.9,fontSize:15.7,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:37.0,lineHeight:1.2,rotation:0},
      {id:"sr09-t4",type:"text",content:"EVEN",x:237.6,y:378.8,fontSize:8.0,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:27.8,lineHeight:1.2,rotation:0},
      {id:"sr09-t5",type:"text",content:"S",x:216.3,y:368.8,fontSize:15.7,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:27.8,lineHeight:1.2,rotation:0},
      {id:"sr09-t6",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\nScheana Shae\nJames Kennedy\n ",x:125.0,y:395.6,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.5,lineHeight:1.56,rotation:0},
      {id:"sr09-t7",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\nScheana Shae\nJames Kennedy\n ",x:294.4,y:223.6,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.5,lineHeight:1.56,rotation:0},
      {id:"sr09-t8",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\nScheana Shae\nJames Kennedy\n ",x:41.5,y:395.7,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.5,lineHeight:1.56,rotation:0},
      {id:"sr09-t9",type:"text",content:"IX",x:159.0,y:378.4,fontSize:8.0,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:10.1,lineHeight:1.2,rotation:0},
      {id:"sr09-t10",type:"text",content:"S",x:137.3,y:368.3,fontSize:15.7,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:24.1,lineHeight:1.2,rotation:0},
      {id:"sr09-t11",type:"text",content:"IVE",x:76.2,y:378.2,fontSize:8.0,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:14.1,lineHeight:1.2,rotation:0},
      {id:"sr09-t12",type:"text",content:"F",x:52.1,y:368.1,fontSize:15.7,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:37.0,lineHeight:1.2,rotation:0},
      {id:"sr09-t13",type:"text",content:"OUR",x:325.9,y:207.8,fontSize:8.0,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:27.8,lineHeight:1.2,rotation:0},
      {id:"sr09-t14",type:"text",content:"F",x:302.3,y:197.7,fontSize:15.7,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:27.8,lineHeight:1.2,rotation:0},
      {id:"sr09-t15",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\nScheana Shae\nJames Kennedy\n ",x:209.0,y:223.4,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.5,lineHeight:1.56,rotation:0},
      {id:"sr09-t16",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\nScheana Shae\nJames Kennedy\n ",x:36.4,y:223.4,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.5,lineHeight:1.56,rotation:0},
      {id:"sr09-t17",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\nScheana Shae\nJames Kennedy\n ",x:125.5,y:223.5,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.5,lineHeight:1.56,rotation:0},
      {id:"sr09-t18",type:"text",content:"HREE",x:240.2,y:207.7,fontSize:8.0,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:27.5,lineHeight:1.2,rotation:0},
      {id:"sr09-t19",type:"text",content:"T",x:216.1,y:197.6,fontSize:15.7,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:37.0,lineHeight:1.2,rotation:0},
      {id:"sr09-t20",type:"text",content:"WO",x:161.4,y:207.5,fontSize:8.0,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:12.9,lineHeight:1.2,rotation:0},
      {id:"sr09-t21",type:"text",content:"T",x:137.4,y:197.4,fontSize:15.7,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:37.0,lineHeight:1.2,rotation:0},
      {id:"sr09-t22",type:"text",content:"NE",x:67.8,y:208.3,fontSize:8.0,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:27.8,lineHeight:1.2,rotation:0},
      {id:"sr09-t23",type:"text",content:"O",x:49.4,y:198.3,fontSize:15.7,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:37.0,lineHeight:1.2,rotation:0},
      {id:"sr09-t24",type:"text",content:"EOPLE",x:252.8,y:154.2,fontSize:19.6,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:67.1,lineHeight:1.2,rotation:0},
      {id:"sr09-t25",type:"text",content:"P",x:184.8,y:126.0,fontSize:38.4,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:86.4,lineHeight:1.2,rotation:0},
      {id:"sr09-t26",type:"text",content:"AVOURITE",x:125.5,y:112.6,fontSize:19.6,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:95.2,lineHeight:1.2,rotation:0},
      {id:"sr09-t27",type:"text",content:"OUR",x:210.8,y:74.5,fontSize:19.6,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:56.8,lineHeight:1.2,rotation:0},
      {id:"sr09-t28",type:"text",content:"F",x:64.2,y:91.6,fontSize:38.4,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:70.1,lineHeight:1.2,rotation:0},
      {id:"sr09-t29",type:"text",content:"O",x:168.0,y:47.5,fontSize:38.4,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:62.3,lineHeight:1.2,rotation:0}
    ]},
  { id:"sr10", collection:"swan-lake", name:"Option 2", category:"wedding-seating", material:"rigid", availableSizes:["a1"], sizeKey:"a1", background:"#FFFFFF", elements:[
      {id:"sr10-t0",type:"text",content:"Twelve",x:289.0,y:428.8,fontSize:10.9,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:45.2,lineHeight:1.2,rotation:0},
      {id:"sr10-t1",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\n ",x:280.9,y:444.6,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.5,lineHeight:1.22,rotation:0},
      {id:"sr10-t2",type:"text",content:"Eleven",x:217.2,y:428.8,fontSize:10.9,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:45.2,lineHeight:1.2,rotation:0},
      {id:"sr10-t3",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\n ",x:209.2,y:444.7,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.5,lineHeight:1.22,rotation:0},
      {id:"sr10-t4",type:"text",content:"Ten",x:141.2,y:428.8,fontSize:10.9,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:45.2,lineHeight:1.2,rotation:0},
      {id:"sr10-t5",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\n ",x:133.1,y:444.6,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.5,lineHeight:1.22,rotation:0},
      {id:"sr10-t6",type:"text",content:"Nine",x:64.1,y:428.9,fontSize:10.9,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:45.2,lineHeight:1.2,rotation:0},
      {id:"sr10-t7",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\n ",x:56.1,y:444.7,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.5,lineHeight:1.22,rotation:0},
      {id:"sr10-t8",type:"text",content:"Eight",x:292.9,y:314.9,fontSize:10.9,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:45.2,lineHeight:1.2,rotation:0},
      {id:"sr10-t9",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\n ",x:284.8,y:330.7,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.5,lineHeight:1.22,rotation:0},
      {id:"sr10-t10",type:"text",content:"Seven",x:221.2,y:315.0,fontSize:10.9,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:45.2,lineHeight:1.2,rotation:0},
      {id:"sr10-t11",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\n ",x:213.1,y:330.8,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.5,lineHeight:1.22,rotation:0},
      {id:"sr10-t12",type:"text",content:"Six",x:145.1,y:315.0,fontSize:10.9,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:45.2,lineHeight:1.2,rotation:0},
      {id:"sr10-t13",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\n ",x:137.1,y:330.8,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.5,lineHeight:1.22,rotation:0},
      {id:"sr10-t14",type:"text",content:"Five",x:68.1,y:315.0,fontSize:10.9,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:45.2,lineHeight:1.2,rotation:0},
      {id:"sr10-t15",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\n ",x:60.0,y:330.8,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.5,lineHeight:1.22,rotation:0},
      {id:"sr10-t16",type:"text",content:"Four",x:290.6,y:203.2,fontSize:10.9,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:45.2,lineHeight:1.2,rotation:0},
      {id:"sr10-t17",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\n ",x:282.5,y:219.1,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.5,lineHeight:1.22,rotation:0},
      {id:"sr10-t18",type:"text",content:"Three",x:218.9,y:203.3,fontSize:10.9,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:45.2,lineHeight:1.2,rotation:0},
      {id:"sr10-t19",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\n ",x:210.8,y:219.1,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.5,lineHeight:1.22,rotation:0},
      {id:"sr10-t20",type:"text",content:"Two",x:142.8,y:203.3,fontSize:10.9,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:45.2,lineHeight:1.2,rotation:0},
      {id:"sr10-t21",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\n ",x:134.7,y:219.1,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.5,lineHeight:1.22,rotation:0},
      {id:"sr10-t22",type:"text",content:"One",x:65.7,y:203.4,fontSize:10.9,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:45.2,lineHeight:1.2,rotation:0},
      {id:"sr10-t23",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\n ",x:57.7,y:219.2,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.5,lineHeight:1.22,rotation:0},
      {id:"sr10-t24",type:"text",content:"WAITS",x:185.5,y:141.3,fontSize:18.3,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:62.5,lineHeight:1.2,rotation:0},
      {id:"sr10-t25",type:"text",content:"A",x:105.0,y:115.0,fontSize:35.8,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:80.5,lineHeight:1.2,rotation:0},
      {id:"sr10-t26",type:"text",content:"EAT",x:255.4,y:103.2,fontSize:18.3,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:88.7,lineHeight:1.2,rotation:0},
      {id:"sr10-t27",type:"text",content:"OUR",x:210.7,y:70.7,fontSize:18.3,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:52.9,lineHeight:1.2,rotation:0},
      {id:"sr10-t28",type:"text",content:"S",x:203.0,y:88.1,fontSize:35.8,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:65.3,lineHeight:1.2,rotation:0},
      {id:"sr10-t29",type:"text",content:"Y",x:157.5,y:45.6,fontSize:35.8,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:58.0,lineHeight:1.2,rotation:0}
    ]},
  { id:"sr11", collection:"swan-lake", name:"Option 3", category:"wedding-seating", material:"rigid", availableSizes:["a1"], sizeKey:"a1", background:"#FFFFFF", elements:[
      {id:"sr11-t0",type:"text",content:"Daniel Scott\nRachel Scott\nChloe Stevens\nThomas Stevens\nOlivia Stevens",x:222.1,y:272.8,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.5,lineHeight:1.38,rotation:0},
      {id:"sr11-t1",type:"text",content:"S",x:222.0,y:253.3,fontSize:8.4,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:55.6,lineHeight:1.2,rotation:0},
      {id:"sr11-t2",type:"text",content:"Z",x:295.7,y:440.4,fontSize:8.4,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:61.9,lineHeight:1.2,rotation:0},
      {id:"sr11-t3",type:"text",content:"Amelia Zhang\nCharlie Zhang\nBrian Zhang\nDenise Zhang",x:295.6,y:456.2,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.5,lineHeight:1.38,rotation:0},
      {id:"sr11-t4",type:"text",content:"Y",x:295.3,y:371.2,fontSize:8.4,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:61.9,lineHeight:1.2,rotation:0},
      {id:"sr11-t5",type:"text",content:"Amelia Yates\nJames Young\nEmma York",x:295.6,y:391.7,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.5,lineHeight:1.38,rotation:0},
      {id:"sr11-t6",type:"text",content:"W",x:295.8,y:254.6,fontSize:8.4,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:61.9,lineHeight:1.2,rotation:0},
      {id:"sr11-t7",type:"text",content:"Amelia Ward\nJames Watson\nSophia West\nDaniel White\nEmma Williams\nJohn Williams\nLucas Wilkins\nMatthew Wilkins",x:295.7,y:270.0,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.5,lineHeight:1.38,rotation:0},
      {id:"sr11-t8",type:"text",content:"V",x:296.3,y:174.5,fontSize:8.4,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:61.9,lineHeight:1.2,rotation:0},
      {id:"sr11-t9",type:"text",content:"Olivia Vaughan\nHenry Vickers\nAmelia Vincent\nJames Vance\nSophia Vega",x:295.8,y:189.8,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.5,lineHeight:1.38,rotation:0},
      {id:"sr11-t10",type:"text",content:"U",x:217.0,y:451.3,fontSize:8.4,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:61.9,lineHeight:1.2,rotation:0},
      {id:"sr11-t11",type:"text",content:"Emma Underwood\nJames Upton\nSophie Ulrich\nDaniel Underhill\nCharlotte Urban",x:219.7,y:469.0,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.5,lineHeight:1.38,rotation:0},
      {id:"sr11-t12",type:"text",content:"T",x:216.8,y:338.9,fontSize:8.4,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:61.9,lineHeight:1.2,rotation:0},
      {id:"sr11-t13",type:"text",content:"William Taylor\nAnna Thompson\nBree Thompson\nIsla Thompson\nJames Turner\nKate Turner\nLiam Turner\nMatt Turner",x:218.6,y:353.3,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.5,lineHeight:1.38,rotation:0},
      {id:"sr11-t14",type:"text",content:"Q ",x:223.0,y:172.8,fontSize:8.4,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:55.6,lineHeight:1.2,rotation:0},
      {id:"sr11-t15",type:"text",content:"Oliver Quinn\nEmma Quinn\nLucas Reid\nSophie Rogers\nThomas Rogers",x:218.7,y:189.7,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.5,lineHeight:1.38,rotation:0},
      {id:"sr11-t16",type:"text",content:"P",x:135.0,y:451.7,fontSize:8.4,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:61.9,lineHeight:1.2,rotation:0},
      {id:"sr11-t17",type:"text",content:"Ella Parker\nThomas Price\nMia Phillips\nGeorge Porter\nSophie Palmer",x:138.7,y:467.0,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.5,lineHeight:1.38,rotation:0},
      {id:"sr11-t18",type:"text",content:"M - O",x:134.2,y:341.2,fontSize:8.4,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:61.9,lineHeight:1.2,rotation:0},
      {id:"sr11-t19",type:"text",content:"Olivia Martin\nHenry Mitchell\nAva Nelson\nJack Oliver\nEmily Morgan\nJacob O’Brien\nGrace Miller\nThomas Osborne",x:138.7,y:356.5,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.5,lineHeight:1.38,rotation:0},
      {id:"sr11-t20",type:"text",content:"J - L",x:137.4,y:270.6,fontSize:8.4,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:61.9,lineHeight:1.2,rotation:0},
      {id:"sr11-t21",type:"text",content:"Ethan Johnson\nAmelia James\nLucas Kone\nSophia Lee",x:138.7,y:285.9,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.5,lineHeight:1.38,rotation:0},
      {id:"sr11-t22",type:"text",content:"I",x:138.2,y:173.6,fontSize:8.4,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:61.9,lineHeight:1.2,rotation:0},
      {id:"sr11-t23",type:"text",content:"Jacob Ingram\nLily Irving\nDaniel Isaacs\nSophia Innes\nThomas Irwin\nEmma Ives\nBenjamin Ingram",x:136.7,y:189.4,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.5,lineHeight:1.38,rotation:0},
      {id:"sr11-t24",type:"text",content:"G - H",x:52.5,y:445.7,fontSize:8.4,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:61.9,lineHeight:1.2,rotation:0},
      {id:"sr11-t25",type:"text",content:"Samuel Grant\nAmelia Gray\nIsabella Gray\nAlexander Hughes\nCharlotte Hayes\nDonald Hayes",x:52.4,y:466.1,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.5,lineHeight:1.38,rotation:0},
      {id:"sr11-t26",type:"text",content:"D - F",x:52.6,y:330.0,fontSize:8.4,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:61.9,lineHeight:1.2,rotation:0},
      {id:"sr11-t27",type:"text",content:"Laura Dawson\nBenjamin Douglas\nChloe Edwards\nPatrick Evans\nGrace Foster \nNathan Fisher\nMatthew Fisher\nOwen Fisher\nPaula Fisher",x:52.5,y:345.3,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.5,lineHeight:1.38,rotation:0},
      {id:"sr11-t28",type:"text",content:"C",x:52.2,y:253.4,fontSize:8.4,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:61.9,lineHeight:1.2,rotation:0},
      {id:"sr11-t29",type:"text",content:"Daniel Carter\nHannah Collins\n Amy Clarke\nMatthew Clarke",x:52.5,y:268.7,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.5,lineHeight:1.38,rotation:0},
      {id:"sr11-t30",type:"text",content:"A - B",x:51.7,y:173.6,fontSize:8.4,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:61.9,lineHeight:1.2,rotation:0},
      {id:"sr11-t31",type:"text",content:"Emily Andrews\nJames Baxter\nOlivia Bennett\nWilliam Archer\nSophia Barnes ",x:52.5,y:188.9,fontSize:7.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:62.5,lineHeight:1.38,rotation:0},
      {id:"sr11-t32",type:"text",content:"e",x:278.4,y:70.3,fontSize:20.2,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:29.9,lineHeight:1.2,rotation:0},
      {id:"sr11-t33",type:"text",content:"First",x:103.6,y:47.0,fontSize:32.8,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:161.1,lineHeight:1.2,rotation:0},
      {id:"sr11-t34",type:"text",content:"then we",x:188.6,y:98.9,fontSize:20.2,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:71.6,lineHeight:1.2,rotation:0},
      {id:"sr11-t35",type:"text",content:"Dance",x:122.2,y:105.6,fontSize:35.8,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:132.8,lineHeight:1.2,rotation:0},
      {id:"sr11-t36",type:"text",content:"we din",x:206.3,y:72.9,fontSize:29.4,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:108.0,lineHeight:1.2,rotation:0}
    ]},
  { id:"sr12", collection:"swan-lake", name:"Option 4", category:"wedding-welcome", material:"rigid", availableSizes:["a2"], sizeKey:"a2", background:"#FFFFFF", elements:[
      {id:"sr12-aw0",type:"image",src:"/artwork/Double Swan copy.png?v=1783852885",fit:"fill",x:111.0,y:407.2,width:177.9,height:122.1,rotation:0},
      {id:"sr12-t0",type:"text",content:"12 October 2025",x:0.9,y:358.6,fontSize:17.0,fontId:"mozart-light",italic:false,align:"center",color:"#231f20",width:397.8,lineHeight:1.2,rotation:0},
      {id:"sr12-t1",type:"text",content:"WELCOME TO THE WEDDING OF",x:0.9,y:63.2,fontSize:12.2,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:397.8,lineHeight:1.2,rotation:0},
      {id:"sr12-t2",type:"text",content:"&",x:257.2,y:198.6,fontSize:33.4,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:49.8,lineHeight:1.2,rotation:0},
      {id:"sr12-t3",type:"text",content:"James",x:0.9,y:248.6,fontSize:47.2,fontId:"mozart-light",italic:false,align:"center",color:"#231f20",width:397.8,lineHeight:1.2,rotation:0},
      {id:"sr12-t4",type:"text",content:"Monique",x:0.9,y:133.3,fontSize:47.2,fontId:"mozart-light",italic:false,align:"center",color:"#231f20",width:397.8,lineHeight:1.2,rotation:0}
    ]},
  { id:"sr13", collection:"swan-lake", name:"Option 4", category:"wedding-welcome", material:"rigid", availableSizes:["a1"], sizeKey:"a1", background:"#FFFFFF", elements:[
      {id:"sr13-aw0",type:"image",src:"/artwork/Double Swan copy.png?v=1783852885",fit:"fill",x:110.7,y:410.4,width:178.9,height:122.8,rotation:0},
      {id:"sr13-t0",type:"text",content:"12 October 2025",x:-0.0,y:361.6,fontSize:17.1,fontId:"mozart-light",italic:false,align:"center",color:"#231f20",width:400.1,lineHeight:1.2,rotation:0},
      {id:"sr13-t1",type:"text",content:"WELCOME TO THE WEDDING OF",x:-0.0,y:64.5,fontSize:12.3,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:400.1,lineHeight:1.2,rotation:0},
      {id:"sr13-t2",type:"text",content:"&",x:257.7,y:200.7,fontSize:33.6,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:50.1,lineHeight:1.2,rotation:0},
      {id:"sr13-t3",type:"text",content:"James",x:-0.0,y:250.9,fontSize:47.4,fontId:"mozart-light",italic:false,align:"center",color:"#231f20",width:400.1,lineHeight:1.2,rotation:0},
      {id:"sr13-t4",type:"text",content:"Monique",x:-0.0,y:135.0,fontSize:47.4,fontId:"mozart-light",italic:false,align:"center",color:"#231f20",width:400.1,lineHeight:1.2,rotation:0}
    ]},
  { id:"sr14", collection:"swan-lake", name:"Option 1", category:"menu", material:"rigid", availableSizes:["a3"], sizeKey:"a3", background:"#FFFFFF", elements:[
      {id:"sr14-border",type:"illustration",illustrationId:"border-sr14",illustrationSrc:"/borders/sr14-border.svg?v=1783852885",label:"Border",x:20.2,y:17.7,width:359.9,height:530.8,color:"#000000",rotation:0,stretch:true},
      {id:"sr14-t0",type:"text",content:"Selection of soft drinks\nSparkling water",x:50.6,y:472.3,fontSize:8.6,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:312.8,lineHeight:1.83,rotation:0},
      {id:"sr14-t1",type:"text",content:"Non-Alcoholic",x:50.6,y:449.5,fontSize:13.5,fontId:"mozart-light",italic:false,align:"center",color:"#231f20",width:312.8,lineHeight:1.2,rotation:0},
      {id:"sr14-t2",type:"text",content:"Great Northern Super Crisp Lager\nCarlton Dry",x:50.6,y:409.3,fontSize:8.6,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:312.8,lineHeight:1.83,rotation:0},
      {id:"sr14-t3",type:"text",content:"Beer",x:50.6,y:386.1,fontSize:13.5,fontId:"mozart-light",italic:false,align:"center",color:"#231f20",width:312.8,lineHeight:1.2,rotation:0},
      {id:"sr14-t4",type:"text",content:"Tolpuddle Vineyard Pinot Noir\nPenfolds Bin 389 Cabernet Shiraz",x:50.6,y:344.0,fontSize:8.6,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:312.8,lineHeight:1.83,rotation:0},
      {id:"sr14-t5",type:"text",content:"Red",x:50.6,y:320.2,fontSize:13.5,fontId:"mozart-light",italic:false,align:"center",color:"#231f20",width:312.8,lineHeight:1.2,rotation:0},
      {id:"sr14-t6",type:"text",content:"Shaw + Smith Sauvignon Blanc\nLeeuwin Estate Art Series Chardonnay",x:50.6,y:281.8,fontSize:8.6,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:312.8,lineHeight:1.83,rotation:0},
      {id:"sr14-t7",type:"text",content:"White",x:50.6,y:262.0,fontSize:13.5,fontId:"mozart-light",italic:false,align:"center",color:"#231f20",width:312.8,lineHeight:1.2,rotation:0},
      {id:"sr14-t8",type:"text",content:"Howard Park NV Petit Jeté\nHouse of Arras Brut Elite Cuvée",x:50.6,y:223.6,fontSize:8.6,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:312.8,lineHeight:1.83,rotation:0},
      {id:"sr14-t9",type:"text",content:"Bubbles",x:50.6,y:198.8,fontSize:13.5,fontId:"mozart-light",italic:false,align:"center",color:"#231f20",width:312.8,lineHeight:1.2,rotation:0},
      {id:"sr14-t10",type:"text",content:"RINK",x:250.8,y:139.5,fontSize:22.4,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:59.3,lineHeight:1.2,rotation:0},
      {id:"sr14-t11",type:"text",content:"O",x:170.5,y:104.9,fontSize:22.4,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:15.3,lineHeight:1.2,rotation:0},
      {id:"sr14-t12",type:"text",content:"D",x:191.1,y:103.5,fontSize:43.9,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:79.8,lineHeight:1.2,rotation:0},
      {id:"sr14-t13",type:"text",content:"T",x:104.1,y:76.7,fontSize:43.9,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:71.2,lineHeight:1.2,rotation:0}
    ]},
  { id:"sr15", collection:"swan-lake", name:"Option 2", category:"menu", material:"rigid", availableSizes:["a3"], sizeKey:"a3", background:"#FFFFFF", elements:[
      {id:"sr15-border",type:"illustration",illustrationId:"border-sr15",illustrationSrc:"/borders/sr15-border.svg?v=1783852885",label:"Border",x:23.4,y:24.9,width:353.0,height:517.0,color:"#000000",rotation:0,stretch:true},
      {id:"sr15-aw0",type:"image",src:"/artwork/Swan with glasses_left_oil.png?v=1783852885",fit:"fill",x:31.6,y:389.0,width:95.7,height:111.7,rotation:0},
      {id:"sr15-aw1",type:"image",src:"/artwork/Swan with champagne bottle_left_oil.png?v=1783852885",fit:"fill",x:213.5,y:165.2,width:79.4,height:86.9,rotation:0},
      {id:"sr15-t0",type:"text",content:"Selection of soft drinks\nSparkling water",x:153.1,y:473.5,fontSize:8.6,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:173.9,lineHeight:1.83,rotation:0},
      {id:"sr15-t1",type:"text",content:"ON - ALCOHOLIC",x:190.5,y:455.2,fontSize:10.6,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:79.7,lineHeight:1.2,rotation:0},
      {id:"sr15-t2",type:"text",content:"N",x:150.8,y:440.8,fontSize:20.7,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:56.1,lineHeight:1.2,rotation:0},
      {id:"sr15-t3",type:"text",content:"Great Northern Super Crisp Lager\nCarlton Dry",x:144.5,y:393.8,fontSize:8.6,fontId:"dubiel",italic:false,align:"right",color:"#231f20",width:173.9,lineHeight:1.83,rotation:0},
      {id:"sr15-t4",type:"text",content:"EER",x:269.3,y:373.3,fontSize:10.6,fontId:"dubiel",italic:false,align:"right",color:"#231f20",width:49.0,lineHeight:1.2,rotation:0},
      {id:"sr15-t5",type:"text",content:"B",x:246.1,y:361.1,fontSize:20.7,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:56.1,lineHeight:1.2,rotation:0},
      {id:"sr15-t6",type:"text",content:"Tolpuddle Vineyard Pinot Noir\nPenfolds Bin 389 Cabernet Shiraz",x:72.1,y:342.2,fontSize:8.6,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:173.9,lineHeight:2.02,rotation:0},
      {id:"sr15-t7",type:"text",content:"ED",x:131.0,y:311.2,fontSize:10.6,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:49.0,lineHeight:1.2,rotation:0},
      {id:"sr15-t8",type:"text",content:"R",x:76.4,y:305.9,fontSize:20.7,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:56.1,lineHeight:1.2,rotation:0},
      {id:"sr15-t9",type:"text",content:"Shaw + Smith Sauvignon Blanc\nLeeuwin Estate Art Series Chardonnay",x:151.2,y:293.5,fontSize:8.6,fontId:"dubiel",italic:false,align:"right",color:"#231f20",width:173.9,lineHeight:1.83,rotation:0},
      {id:"sr15-t10",type:"text",content:"HITE",x:276.0,y:273.0,fontSize:10.6,fontId:"dubiel",italic:false,align:"right",color:"#231f20",width:49.0,lineHeight:1.2,rotation:0},
      {id:"sr15-t11",type:"text",content:"W",x:268.0,y:260.8,fontSize:20.7,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:56.1,lineHeight:1.2,rotation:0},
      {id:"sr15-t12",type:"text",content:"Howard Park NV Petit Jeté\nHouse of Arras Brut Elite Cuvée",x:72.2,y:234.1,fontSize:8.6,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:173.9,lineHeight:1.83,rotation:0},
      {id:"sr15-t13",type:"text",content:"UBBLES",x:131.1,y:203.1,fontSize:10.6,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:49.0,lineHeight:1.2,rotation:0},
      {id:"sr15-t14",type:"text",content:"B",x:76.5,y:197.8,fontSize:20.7,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:56.1,lineHeight:1.2,rotation:0},
      {id:"sr15-t15",type:"text",content:"AR",x:273.3,y:125.6,fontSize:19.9,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:52.7,lineHeight:1.2,rotation:0},
      {id:"sr15-t16",type:"text",content:"HE",x:185.4,y:92.8,fontSize:19.9,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:57.8,lineHeight:1.2,rotation:0},
      {id:"sr15-t17",type:"text",content:"B",x:170.5,y:115.6,fontSize:39.0,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:105.7,lineHeight:1.2,rotation:0},
      {id:"sr15-t18",type:"text",content:"T",x:122.1,y:70.8,fontSize:39.0,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:63.3,lineHeight:1.2,rotation:0}
    ]},
  { id:"sr16", collection:"swan-lake", name:"Option 3", category:"menu", material:"rigid", availableSizes:["a3"], sizeKey:"a3", background:"#FFFFFF", elements:[
      {id:"sr16-aw0",type:"image",src:"/artwork/Swan with glasses_left_oil.png?v=1783852885",fit:"fill",x:255.1,y:423.7,width:109.4,height:121.1,rotation:0},
      {id:"sr16-t0",type:"text",content:"Selection of soft drinks\nSparkling water\nTea + Coffee",x:173.3,y:427.7,fontSize:8.6,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:99.8,lineHeight:1.83,rotation:0},
      {id:"sr16-t1",type:"text",content:"Non  Alcoholic",x:52.9,y:427.6,fontSize:20.7,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:176.4,lineHeight:1.2,rotation:0},
      {id:"sr16-t2",type:"text",content:"Great Northern Super Crisp Lager\nCarlton Dry",x:150.1,y:368.8,fontSize:8.6,fontId:"dubiel",italic:false,align:"right",color:"#231f20",width:115.5,lineHeight:1.83,rotation:0},
      {id:"sr16-t3",type:"text",content:"Beer",x:272.9,y:370.0,fontSize:20.7,fontId:"mozart-light",italic:false,align:"right",color:"#231f20",width:84.0,lineHeight:1.2,rotation:0},
      {id:"sr16-t4",type:"text",content:"Tolpuddle Vineyard Pinot Noir\nPenfolds Bin 389 Cabernet Shiraz",x:137.5,y:310.0,fontSize:8.6,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:122.1,lineHeight:1.83,rotation:0},
      {id:"sr16-t5",type:"text",content:"Red",x:52.8,y:310.2,fontSize:20.7,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:92.3,lineHeight:1.2,rotation:0},
      {id:"sr16-t6",type:"text",content:"Shaw + Smith Sauvignon Blanc\nLeeuwin Estate Art Series Chardonnay",x:110.4,y:249.1,fontSize:8.6,fontId:"dubiel",italic:false,align:"right",color:"#231f20",width:173.9,lineHeight:1.83,rotation:0},
      {id:"sr16-t7",type:"text",content:"White",x:274.2,y:252.1,fontSize:20.7,fontId:"mozart-light",italic:false,align:"right",color:"#231f20",width:81.0,lineHeight:1.2,rotation:0},
      {id:"sr16-t8",type:"text",content:"Howard Park NV Petit Jeté\nHouse of Arras Brut Elite Cuvée",x:171.7,y:186.8,fontSize:8.6,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:122.0,lineHeight:1.83,rotation:0},
      {id:"sr16-t9",type:"text",content:"Bubbles",x:52.9,y:190.6,fontSize:20.7,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:122.9,lineHeight:1.2,rotation:0},
      {id:"sr16-t10",type:"text",content:"Bar",x:149.7,y:109.2,fontSize:42.2,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:218.2,lineHeight:1.2,rotation:0},
      {id:"sr16-t11",type:"text",content:"The",x:97.4,y:60.7,fontSize:42.2,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:161.5,lineHeight:1.2,rotation:0}
    ]},
  { id:"sr17", collection:"swan-lake", name:"Option 1", category:"wishing-well", material:"rigid", availableSizes:["a3"], sizeKey:"a3", background:"#FFFFFF", elements:[
      {id:"sr17-border",type:"illustration",illustrationId:"border-sr17",illustrationSrc:"/borders/sr17-border.svg?v=1783852885",label:"Border",x:20.0,y:16.8,width:359.9,height:530.8,color:"#000000",rotation:0,stretch:true},
      {id:"sr17-t0",type:"text",content:"ISHES",x:221.7,y:406.3,fontSize:31.8,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:111.2,lineHeight:1.2,rotation:0},
      {id:"sr17-t1",type:"text",content:"W",x:144.6,y:361.2,fontSize:61.3,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:97.9,lineHeight:1.2,rotation:0},
      {id:"sr17-t2",type:"text",content:"&",x:242.0,y:229.5,fontSize:36.6,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:50.8,lineHeight:1.2,rotation:0},
      {id:"sr17-t3",type:"text",content:"ELL",x:179.3,y:277.9,fontSize:31.8,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:111.2,lineHeight:1.2,rotation:0},
      {id:"sr17-t4",type:"text",content:"W",x:95.7,y:237.6,fontSize:61.3,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:97.9,lineHeight:1.2,rotation:0},
      {id:"sr17-t5",type:"text",content:"ARDS",x:162.2,y:174.4,fontSize:31.8,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:111.2,lineHeight:1.2,rotation:0},
      {id:"sr17-t6",type:"text",content:"C",x:119.8,y:125.5,fontSize:63.2,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:44.3,lineHeight:1.2,rotation:0}
    ]},
  { id:"sr18", collection:"swan-lake", name:"Option 2", category:"wishing-well", material:"rigid", availableSizes:["a3"], sizeKey:"a3", background:"#FFFFFF", elements:[
      {id:"sr18-r0",type:"image",src:"/raster/sr18-r0.png?v=1783852885",fit:"fill",x:0.0,y:0.0,width:399.8,height:565.5,rotation:0},
      {id:"sr18-t0",type:"text",content:"ISHES",x:262.9,y:489.1,fontSize:42.8,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:191.5,lineHeight:1.2,rotation:0},
      {id:"sr18-t1",type:"text",content:"W",x:103.1,y:438.1,fontSize:105.6,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:168.6,lineHeight:1.2,rotation:0},
      {id:"sr18-t2",type:"text",content:"&",x:270.9,y:211.2,fontSize:63.0,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:87.6,lineHeight:1.2,rotation:0},
      {id:"sr18-t3",type:"text",content:"ELL",x:162.8,y:294.7,fontSize:42.8,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:191.5,lineHeight:1.2,rotation:0},
      {id:"sr18-t4",type:"text",content:"W",x:18.8,y:225.2,fontSize:105.6,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:168.6,lineHeight:1.2,rotation:0},
      {id:"sr18-t5",type:"text",content:"ARDS",x:133.3,y:116.3,fontSize:42.8,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:191.5,lineHeight:1.2,rotation:0},
      {id:"sr18-t6",type:"text",content:"C",x:60.3,y:32.1,fontSize:108.8,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:76.4,lineHeight:1.2,rotation:0}
    ]},
  { id:"sr19", collection:"swan-lake", name:"Option 3", category:"wishing-well", material:"rigid", availableSizes:["a3"], sizeKey:"a3", background:"#FFFFFF", elements:[
      {id:"sr19-aw0",type:"image",src:"/artwork/Double Swan copy.png?v=1783852885",fit:"fill",x:119.5,y:359.6,width:166.3,height:114.1,rotation:0},
      {id:"sr19-t0",type:"text",content:"&",x:192.7,y:166.7,fontSize:31.2,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:46.6,lineHeight:1.2,rotation:0},
      {id:"sr19-t1",type:"text",content:"Well Wishes",x:16.6,y:240.3,fontSize:44.1,fontId:"mozart-light",italic:false,align:"center",color:"#231f20",width:371.9,lineHeight:1.2,rotation:0},
      {id:"sr19-t2",type:"text",content:"Cards",x:16.6,y:110.7,fontSize:44.1,fontId:"mozart-light",italic:false,align:"center",color:"#231f20",width:371.9,lineHeight:1.2,rotation:0}
    ]},
  { id:"sr20", collection:"swan-lake", name:"Option 1", category:"polaroid-guestbook", material:"rigid", availableSizes:["a3"], sizeKey:"a3", background:"#FFFFFF", elements:[
      {id:"sr20-border",type:"illustration",illustrationId:"border-sr20",illustrationSrc:"/borders/sr20-border.svg?v=1783852885",label:"Border",x:20.0,y:18.6,width:359.9,height:530.8,color:"#000000",rotation:0,stretch:true},
      {id:"sr20-t0",type:"text",content:"S",x:131.1,y:217.7,fontSize:40.4,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:65.5,lineHeight:1.2,rotation:0},
      {id:"sr20-t1",type:"text",content:"&",x:166.4,y:453.9,fontSize:13.6,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:17.2,lineHeight:1.2,rotation:0},
      {id:"sr20-t2",type:"text",content:"J",x:172.6,y:461.1,fontSize:19.9,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:89.6,lineHeight:1.2,rotation:0},
      {id:"sr20-t3",type:"text",content:"M",x:164.1,y:435.5,fontSize:19.9,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:89.6,lineHeight:1.2,rotation:0},
      {id:"sr20-t4",type:"text",content:"UR",x:255.2,y:240.4,fontSize:22.8,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:63.5,lineHeight:1.2,rotation:0},
      {id:"sr20-t5",type:"text",content:"O",x:207.7,y:220.7,fontSize:41.3,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:47.6,lineHeight:1.2,rotation:0},
      {id:"sr20-t6",type:"text",content:"IGN",x:149.5,y:242.2,fontSize:22.8,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:63.5,lineHeight:1.2,rotation:0},
      {id:"sr20-t7",type:"text",content:"LEASE",x:168.2,y:160.9,fontSize:22.8,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:76.4,lineHeight:1.2,rotation:0},
      {id:"sr20-t8",type:"text",content:"P",x:96.8,y:142.8,fontSize:36.1,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:100.0,lineHeight:1.2,rotation:0},
      {id:"sr20-t9",type:"text",content:"UESTBOOK",x:155.1,y:309.3,fontSize:22.8,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:112.4,lineHeight:1.2,rotation:0},
      {id:"sr20-t10",type:"text",content:"G",x:100.3,y:297.9,fontSize:40.4,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:47.6,lineHeight:1.2,rotation:0}
    ]},
  { id:"sr21", collection:"swan-lake", name:"Option 2", category:"polaroid-guestbook", material:"rigid", availableSizes:["a3"], sizeKey:"a3", background:"#FFFFFF", elements:[
      {id:"sr21-r0",type:"image",src:"/raster/sr21-r0.png?v=1783852885",fit:"fill",x:0.0,y:0.0,width:400.0,height:565.7,rotation:0},
      {id:"sr21-t0",type:"text",content:"S",x:69.9,y:245.5,fontSize:81.2,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:131.7,lineHeight:1.2,rotation:0},
      {id:"sr21-t1",type:"text",content:"UR",x:293.8,y:291.1,fontSize:45.8,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:127.7,lineHeight:1.2,rotation:0},
      {id:"sr21-t2",type:"text",content:"O",x:202.5,y:251.7,fontSize:83.1,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:95.8,lineHeight:1.2,rotation:0},
      {id:"sr21-t3",type:"text",content:"IGN",x:102.6,y:294.7,fontSize:45.8,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:127.7,lineHeight:1.2,rotation:0},
      {id:"sr21-t4",type:"text",content:"LEASE",x:136.0,y:131.4,fontSize:45.8,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:153.6,lineHeight:1.2,rotation:0},
      {id:"sr21-t5",type:"text",content:"P",x:-24.7,y:72.6,fontSize:79.3,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:201.0,lineHeight:1.2,rotation:0},
      {id:"sr21-t6",type:"text",content:"UESTBOOK",x:127.1,y:441.6,fontSize:45.8,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:225.9,lineHeight:1.2,rotation:0},
      {id:"sr21-t7",type:"text",content:"G",x:-1.9,y:426.1,fontSize:87.9,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:124.9,lineHeight:1.2,rotation:0}
    ]},
  { id:"sr22", collection:"swan-lake", name:"Option 3", category:"polaroid-guestbook", material:"rigid", availableSizes:["a3"], sizeKey:"a3", background:"#FFFFFF", elements:[
      {id:"sr22-aw0",type:"image",src:"/artwork/Double Swan copy.png?v=1783852885",fit:"fill",x:116.1,y:321.1,width:166.3,height:114.1,rotation:0},
      {id:"sr22-t0",type:"text",content:"Guestbook",x:13.2,y:201.8,fontSize:52.3,fontId:"mozart-light",italic:false,align:"center",color:"#231f20",width:371.9,lineHeight:1.2,rotation:0},
      {id:"sr22-t1",type:"text",content:"PLEASE SIGN OUR",x:13.2,y:133.5,fontSize:21.4,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:371.9,lineHeight:1.2,rotation:0}
    ]},
  { id:"sr23", collection:"swan-lake", name:"Option 1", category:"memorial", material:"rigid", availableSizes:["a3"], sizeKey:"a3", background:"#FFFFFF", elements:[
      {id:"sr23-border",type:"illustration",illustrationId:"border-sr23",illustrationSrc:"/borders/sr23-border.svg?v=1783852885",label:"Border",x:18.8,y:16.8,width:359.9,height:530.8,color:"#000000",rotation:0,stretch:true},
      {id:"sr23-t0",type:"text",content:"y   ",x:248.9,y:172.3,fontSize:32.8,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:78.3,lineHeight:1.2,rotation:0},
      {id:"sr23-t1s0",type:"text",content:"M",x:84.4,y:171.9,fontSize:37.4,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:81.3,lineHeight:1.2,rotation:0},
      {id:"sr23-t1s1",type:"text",content:" E MO R",x:163.8,y:178.3,fontSize:27.7,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:91.0,lineHeight:1.2,rotation:0},
      {id:"sr23-t2s0",type:"text",content:"I",x:86.2,y:105.5,fontSize:37.4,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:58.3,lineHeight:1.2,rotation:0},
      {id:"sr23-t2s1",type:"text",content:"N",x:145.9,y:111.9,fontSize:27.7,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:18.9,lineHeight:1.2,rotation:0},
      {id:"sr23-t2s2",type:"text",content:" L",x:175.9,y:105.5,fontSize:37.4,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:54.1,lineHeight:1.2,rotation:0},
      {id:"sr23-t2s3",type:"text",content:"OVING",x:231.4,y:111.9,fontSize:27.7,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:83.3,lineHeight:1.2,rotation:0},
      {id:"sr23-t3",type:"text",content:"Grandpa Jones\nJohn Michaels\nAmy Richards",x:0.2,y:410.8,fontSize:17.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:399.6,lineHeight:1.59,rotation:0},
      {id:"sr23-t4s0",type:"text",content:"Of those who",x:156.3,y:261.3,fontSize:18.5,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:99.7,lineHeight:1.2,rotation:0},
      {id:"sr23-t4s1",type:"text",content:"couldn’t be here today,",x:121.4,y:288.4,fontSize:18.5,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:164.1,lineHeight:1.2,rotation:0},
      {id:"sr23-t4s2",type:"text",content:"but are forever",x:148.2,y:315.5,fontSize:18.5,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:115.9,lineHeight:1.2,rotation:0},
      {id:"sr23-t4s3",type:"text",content:"in our hearts.",x:139.3,y:343.5,fontSize:18.5,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:128.4,lineHeight:1.2,rotation:0}
    ]},
  { id:"sr24", collection:"swan-lake", name:"Option 2", category:"memorial", material:"rigid", availableSizes:["a3"], sizeKey:"a3", background:"#FFFFFF", elements:[
      {id:"sr24-r0",type:"image",src:"/raster/sr24-r0.png?v=1783852885",fit:"fill",x:0.0,y:0.0,width:400.0,height:565.7,rotation:0},
      {id:"sr24-t0",type:"text",content:"IN LOVING",x:150.1,y:90.9,fontSize:21.4,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:144.4,lineHeight:1.2,rotation:0},
      {id:"sr24-t1",type:"text",content:"Memory",x:-12.8,y:90.6,fontSize:68.4,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:435.3,lineHeight:1.2,rotation:0},
      {id:"sr24-t2",type:"text",content:"Grandpa Jones\nJohn Michaels\nAmy Richards",x:0.1,y:402.5,fontSize:17.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:399.6,lineHeight:1.59,rotation:0},
      {id:"sr24-t3s0",type:"text",content:"Of those who",x:156.2,y:253.0,fontSize:18.5,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:99.7,lineHeight:1.2,rotation:0},
      {id:"sr24-t3s1",type:"text",content:"couldn’t be here today,",x:121.3,y:280.1,fontSize:18.5,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:164.1,lineHeight:1.2,rotation:0},
      {id:"sr24-t3s2",type:"text",content:"but are forever",x:148.0,y:307.2,fontSize:18.5,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:115.9,lineHeight:1.2,rotation:0},
      {id:"sr24-t3s3",type:"text",content:"in our hearts.",x:139.1,y:335.2,fontSize:18.5,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:128.4,lineHeight:1.2,rotation:0}
    ]},
  { id:"sr25", collection:"swan-lake", name:"Option 3", category:"memorial", material:"rigid", availableSizes:["a3"], sizeKey:"a3", background:"#FFFFFF", elements:[
      {id:"sr25-aw0",type:"image",src:"/artwork/Double Swan copy.png?v=1783852885",fit:"fill",x:125.2,y:389.5,width:166.3,height:114.1,rotation:0},
      {id:"sr25-t0",type:"text",content:"In Loving Memory",x:81.3,y:97.9,fontSize:37.4,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:253.7,lineHeight:1.2,rotation:0},
      {id:"sr25-t1",type:"text",content:"Of those who \ncouldn’t be here today,\nbut are forever \nin our hearts.",x:29.9,y:249.5,fontSize:18.5,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:362.8,lineHeight:1.46,rotation:0}
    ]},
  { id:"sr26", collection:"swan-lake", name:"Option 1", category:"menu", material:"rigid", availableSizes:["a4"], sizeKey:"a4", background:"#FFFFFF", elements:[
      {id:"sr26-border",type:"illustration",illustrationId:"border-sr26",illustrationSrc:"/borders/sr26-border.svg?v=1783852885",label:"Border",x:20.4,y:22.5,width:359.9,height:529.9,color:"#000000",rotation:0,stretch:true},
      {id:"sr26-t0",type:"text",content:"A4",x:-179.7,y:53.6,fontSize:49.1,fontId:"jost",italic:false,align:"center",color:"#231f20",width:198.5,lineHeight:1.2,rotation:0},
      {id:"sr26-t1",type:"text",content:"Selection of soft drinks\nSparkling water",x:51.5,y:475.8,fontSize:8.5,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:311.3,lineHeight:1.83,rotation:0},
      {id:"sr26-t2",type:"text",content:"Non-Alcoholic",x:51.5,y:453.1,fontSize:13.4,fontId:"mozart-light",italic:false,align:"center",color:"#231f20",width:311.3,lineHeight:1.2,rotation:0},
      {id:"sr26-t3",type:"text",content:"Great Northern Super Crisp Lager\nCarlton Dry",x:51.5,y:413.0,fontSize:8.5,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:311.3,lineHeight:1.83,rotation:0},
      {id:"sr26-t4",type:"text",content:"Beer",x:51.5,y:390.0,fontSize:13.4,fontId:"mozart-light",italic:false,align:"center",color:"#231f20",width:311.3,lineHeight:1.2,rotation:0},
      {id:"sr26-t5",type:"text",content:"Tolpuddle Vineyard Pinot Noir\nPenfolds Bin 389 Cabernet Shiraz",x:51.5,y:348.1,fontSize:8.5,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:311.3,lineHeight:1.83,rotation:0},
      {id:"sr26-t6",type:"text",content:"Red",x:51.5,y:324.4,fontSize:13.4,fontId:"mozart-light",italic:false,align:"center",color:"#231f20",width:311.3,lineHeight:1.2,rotation:0},
      {id:"sr26-t7",type:"text",content:"Shaw + Smith Sauvignon Blanc\nLeeuwin Estate Art Series Chardonnay",x:51.5,y:286.2,fontSize:8.5,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:311.3,lineHeight:1.83,rotation:0},
      {id:"sr26-t8",type:"text",content:"White",x:51.5,y:266.5,fontSize:13.4,fontId:"mozart-light",italic:false,align:"center",color:"#231f20",width:311.3,lineHeight:1.2,rotation:0},
      {id:"sr26-t9",type:"text",content:"Howard Park NV Petit Jeté\nHouse of Arras Brut Elite Cuvée",x:51.5,y:228.3,fontSize:8.5,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:311.3,lineHeight:1.83,rotation:0},
      {id:"sr26-t10",type:"text",content:"Bubbles",x:51.5,y:203.6,fontSize:13.4,fontId:"mozart-light",italic:false,align:"center",color:"#231f20",width:311.3,lineHeight:1.2,rotation:0},
      {id:"sr26-t11",type:"text",content:"RINK",x:250.8,y:144.5,fontSize:22.3,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:59.0,lineHeight:1.2,rotation:0},
      {id:"sr26-t12",type:"text",content:"O",x:170.8,y:110.1,fontSize:22.3,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:15.3,lineHeight:1.2,rotation:0},
      {id:"sr26-t13",type:"text",content:"D",x:191.3,y:108.7,fontSize:43.7,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:79.4,lineHeight:1.2,rotation:0},
      {id:"sr26-t14",type:"text",content:"T",x:104.8,y:82.1,fontSize:43.7,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:70.9,lineHeight:1.2,rotation:0}
    ]},
  { id:"sr27", collection:"swan-lake", name:"Option 2", category:"menu", material:"rigid", availableSizes:["a4"], sizeKey:"a4", background:"#FFFFFF", elements:[
      {id:"sr27-border",type:"illustration",illustrationId:"border-sr27",illustrationSrc:"/borders/sr27-border.svg?v=1783852885",label:"Border",x:17.3,y:28.9,width:353.0,height:516.2,color:"#000000",rotation:0,stretch:true},
      {id:"sr27-aw0",type:"image",src:"/artwork/Swan with glasses_left_oil.png?v=1783852885",fit:"fill",x:26.2,y:392.1,width:95.3,height:111.1,rotation:0},
      {id:"sr27-aw1",type:"image",src:"/artwork/Swan with champagne bottle_left_oil.png?v=1783852885",fit:"fill",x:207.4,y:169.4,width:79.0,height:86.5,rotation:0},
      {id:"sr27-t0",type:"text",content:"Selection of soft drinks\nSparkling water",x:147.2,y:476.2,fontSize:8.5,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:173.1,lineHeight:1.83,rotation:0},
      {id:"sr27-t1",type:"text",content:"ON - ALCOHOLIC",x:184.5,y:458.0,fontSize:10.5,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:79.4,lineHeight:1.2,rotation:0},
      {id:"sr27-t2",type:"text",content:"N",x:145.0,y:443.7,fontSize:20.6,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:55.9,lineHeight:1.2,rotation:0},
      {id:"sr27-t3",type:"text",content:"Great Northern Super Crisp Lager\nCarlton Dry",x:138.6,y:396.8,fontSize:8.5,fontId:"dubiel",italic:false,align:"right",color:"#231f20",width:173.1,lineHeight:1.83,rotation:0},
      {id:"sr27-t4",type:"text",content:"EER",x:262.9,y:376.4,fontSize:10.5,fontId:"dubiel",italic:false,align:"right",color:"#231f20",width:48.8,lineHeight:1.2,rotation:0},
      {id:"sr27-t5",type:"text",content:"B",x:239.7,y:364.3,fontSize:20.6,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:55.9,lineHeight:1.2,rotation:0},
      {id:"sr27-t6",type:"text",content:"Tolpuddle Vineyard Pinot Noir\nPenfolds Bin 389 Cabernet Shiraz",x:66.6,y:345.5,fontSize:8.5,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:173.1,lineHeight:2.02,rotation:0},
      {id:"sr27-t7",type:"text",content:"ED",x:125.2,y:314.7,fontSize:10.5,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:48.8,lineHeight:1.2,rotation:0},
      {id:"sr27-t8",type:"text",content:"R",x:70.9,y:309.4,fontSize:20.6,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:55.9,lineHeight:1.2,rotation:0},
      {id:"sr27-t9",type:"text",content:"Shaw + Smith Sauvignon Blanc\nLeeuwin Estate Art Series Chardonnay",x:145.3,y:297.0,fontSize:8.5,fontId:"dubiel",italic:false,align:"right",color:"#231f20",width:173.1,lineHeight:1.83,rotation:0},
      {id:"sr27-t10",type:"text",content:"HITE",x:269.6,y:276.6,fontSize:10.5,fontId:"dubiel",italic:false,align:"right",color:"#231f20",width:48.8,lineHeight:1.2,rotation:0},
      {id:"sr27-t11",type:"text",content:"W",x:261.5,y:264.5,fontSize:20.6,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:55.9,lineHeight:1.2,rotation:0},
      {id:"sr27-t12",type:"text",content:"Howard Park NV Petit Jeté\nHouse of Arras Brut Elite Cuvée",x:66.7,y:237.9,fontSize:8.5,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:173.1,lineHeight:1.83,rotation:0},
      {id:"sr27-t13",type:"text",content:"UBBLES",x:125.3,y:207.0,fontSize:10.5,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:48.8,lineHeight:1.2,rotation:0},
      {id:"sr27-t14",type:"text",content:"B",x:70.9,y:201.8,fontSize:20.6,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:55.9,lineHeight:1.2,rotation:0},
      {id:"sr27-t15",type:"text",content:"AR",x:266.9,y:129.9,fontSize:19.8,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:52.5,lineHeight:1.2,rotation:0},
      {id:"sr27-t16",type:"text",content:"HE",x:179.3,y:97.3,fontSize:19.8,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:57.5,lineHeight:1.2,rotation:0},
      {id:"sr27-t17",type:"text",content:"B",x:164.5,y:119.9,fontSize:38.9,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:105.2,lineHeight:1.2,rotation:0},
      {id:"sr27-t18",type:"text",content:"T",x:116.4,y:75.3,fontSize:38.9,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:63.0,lineHeight:1.2,rotation:0}
    ]},
  { id:"sr28", collection:"swan-lake", name:"Option 3", category:"menu", material:"rigid", availableSizes:["a4"], sizeKey:"a4", background:"#FFFFFF", elements:[
      {id:"sr28-aw0",type:"image",src:"/artwork/Swan with glasses_left_oil.png?v=1783852885",fit:"fill",x:242.1,y:426.6,width:108.9,height:120.5,rotation:0},
      {id:"sr28-t0",type:"text",content:"Selection of soft drinks\nSparkling water\nTea + Coffee",x:160.7,y:430.6,fontSize:8.5,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:99.3,lineHeight:1.83,rotation:0},
      {id:"sr28-t1",type:"text",content:"Non  Alcoholic",x:40.8,y:430.5,fontSize:20.6,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:175.6,lineHeight:1.2,rotation:0},
      {id:"sr28-t2",type:"text",content:"Great Northern Super Crisp Lager\nCarlton Dry",x:137.5,y:372.0,fontSize:8.5,fontId:"dubiel",italic:false,align:"right",color:"#231f20",width:114.9,lineHeight:1.83,rotation:0},
      {id:"sr28-t3",type:"text",content:"Beer",x:259.8,y:373.2,fontSize:20.6,fontId:"mozart-light",italic:false,align:"right",color:"#231f20",width:83.6,lineHeight:1.2,rotation:0},
      {id:"sr28-t4",type:"text",content:"Tolpuddle Vineyard Pinot Noir\nPenfolds Bin 389 Cabernet Shiraz",x:125.0,y:313.4,fontSize:8.5,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:121.5,lineHeight:1.83,rotation:0},
      {id:"sr28-t5",type:"text",content:"Red",x:40.7,y:313.6,fontSize:20.6,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:91.9,lineHeight:1.2,rotation:0},
      {id:"sr28-t6",type:"text",content:"Shaw + Smith Sauvignon Blanc\nLeeuwin Estate Art Series Chardonnay",x:98.0,y:252.9,fontSize:8.5,fontId:"dubiel",italic:false,align:"right",color:"#231f20",width:173.1,lineHeight:1.83,rotation:0},
      {id:"sr28-t7",type:"text",content:"White",x:261.1,y:255.8,fontSize:20.6,fontId:"mozart-light",italic:false,align:"right",color:"#231f20",width:80.7,lineHeight:1.2,rotation:0},
      {id:"sr28-t8",type:"text",content:"Howard Park NV Petit Jeté\nHouse of Arras Brut Elite Cuvée",x:159.0,y:190.8,fontSize:8.5,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:121.5,lineHeight:1.83,rotation:0},
      {id:"sr28-t9",type:"text",content:"Bubbles",x:40.8,y:194.6,fontSize:20.6,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:122.3,lineHeight:1.2,rotation:0},
      {id:"sr28-t10",type:"text",content:"Bar",x:137.1,y:113.5,fontSize:42.0,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:217.2,lineHeight:1.2,rotation:0},
      {id:"sr28-t11",type:"text",content:"The",x:85.1,y:65.3,fontSize:42.0,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:160.8,lineHeight:1.2,rotation:0}
    ]},
  { id:"sr29", collection:"swan-lake", name:"Option 1", category:"wishing-well", material:"rigid", availableSizes:["a4"], sizeKey:"a4", background:"#FFFFFF", elements:[
      {id:"sr29-border",type:"illustration",illustrationId:"border-sr29",illustrationSrc:"/borders/sr29-border.svg?v=1783852885",label:"Border",x:20.1,y:17.6,width:359.9,height:529.9,color:"#000000",rotation:0,stretch:true},
      {id:"sr29-t0",type:"text",content:"ISHES",x:221.7,y:406.0,fontSize:31.7,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:110.7,lineHeight:1.2,rotation:0},
      {id:"sr29-t1",type:"text",content:"W",x:145.0,y:361.2,fontSize:61.0,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:97.4,lineHeight:1.2,rotation:0},
      {id:"sr29-t2",type:"text",content:"&",x:242.0,y:230.1,fontSize:36.4,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:50.6,lineHeight:1.2,rotation:0},
      {id:"sr29-t3",type:"text",content:"ELL",x:179.5,y:278.3,fontSize:31.7,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:110.7,lineHeight:1.2,rotation:0},
      {id:"sr29-t4",type:"text",content:"W",x:96.3,y:238.2,fontSize:61.0,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:97.4,lineHeight:1.2,rotation:0},
      {id:"sr29-t5",type:"text",content:"ARDS",x:162.4,y:175.2,fontSize:31.7,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:110.7,lineHeight:1.2,rotation:0},
      {id:"sr29-t6",type:"text",content:"C",x:120.3,y:126.6,fontSize:62.9,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:44.1,lineHeight:1.2,rotation:0}
    ]},
  { id:"sr30", collection:"swan-lake", name:"Option 2", category:"wishing-well", material:"rigid", availableSizes:["a4"], sizeKey:"a4", background:"#FFFFFF", elements:[
      {id:"sr30-r0",type:"image",src:"/raster/sr30-r0.png?v=1783852885",fit:"fill",x:0.0,y:0.0,width:400.0,height:563.8,rotation:0},
      {id:"sr30-t0",type:"text",content:"ISHES",x:263.8,y:487.6,fontSize:42.7,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:192.2,lineHeight:1.2,rotation:0},
      {id:"sr30-t1",type:"text",content:"W",x:103.4,y:436.7,fontSize:105.3,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:169.2,lineHeight:1.2,rotation:0},
      {id:"sr30-t2",type:"text",content:"&",x:271.8,y:210.3,fontSize:62.9,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:87.9,lineHeight:1.2,rotation:0},
      {id:"sr30-t3",type:"text",content:"ELL",x:163.4,y:293.6,fontSize:42.7,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:192.2,lineHeight:1.2,rotation:0},
      {id:"sr30-t4",type:"text",content:"W",x:18.9,y:224.3,fontSize:105.3,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:169.2,lineHeight:1.2,rotation:0},
      {id:"sr30-t5",type:"text",content:"ARDS",x:133.7,y:115.6,fontSize:42.7,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:192.2,lineHeight:1.2,rotation:0},
      {id:"sr30-t6",type:"text",content:"C",x:60.5,y:35.7,fontSize:108.6,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:76.6,lineHeight:1.2,rotation:0}
    ]},
  { id:"sr31", collection:"swan-lake", name:"Option 3", category:"wishing-well", material:"rigid", availableSizes:["a4"], sizeKey:"a4", background:"#FFFFFF", elements:[
      {id:"sr31-aw0",type:"image",src:"/artwork/Double Swan copy.png?v=1783852885",fit:"fill",x:114.6,y:361.4,width:165.5,height:113.6,rotation:0},
      {id:"sr31-t0",type:"text",content:"&",x:187.5,y:169.5,fontSize:31.1,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:46.4,lineHeight:1.2,rotation:0},
      {id:"sr31-t1",type:"text",content:"Well Wishes",x:12.2,y:242.7,fontSize:43.9,fontId:"mozart-light",italic:false,align:"center",color:"#231f20",width:370.2,lineHeight:1.2,rotation:0},
      {id:"sr31-t2",type:"text",content:"Cards",x:12.2,y:113.7,fontSize:43.9,fontId:"mozart-light",italic:false,align:"center",color:"#231f20",width:370.2,lineHeight:1.2,rotation:0}
    ]},
  { id:"sr32", collection:"swan-lake", name:"Option 1", category:"polaroid-guestbook", material:"rigid", availableSizes:["a4"], sizeKey:"a4", background:"#FFFFFF", elements:[
      {id:"sr32-border",type:"illustration",illustrationId:"border-sr32",illustrationSrc:"/borders/sr32-border.svg?v=1783852885",label:"Border",x:20.2,y:18.1,width:359.9,height:529.9,color:"#000000",rotation:0,stretch:true},
      {id:"sr32-t0",type:"text",content:"S",x:131.6,y:217.0,fontSize:40.2,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:65.2,lineHeight:1.2,rotation:0},
      {id:"sr32-t1",type:"text",content:"&",x:166.7,y:452.1,fontSize:13.5,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:17.1,lineHeight:1.2,rotation:0},
      {id:"sr32-t2",type:"text",content:"J",x:172.9,y:459.2,fontSize:19.8,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:89.2,lineHeight:1.2,rotation:0},
      {id:"sr32-t3",type:"text",content:"M",x:164.4,y:433.9,fontSize:19.8,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:89.2,lineHeight:1.2,rotation:0},
      {id:"sr32-t4",type:"text",content:"UR",x:255.1,y:239.6,fontSize:22.7,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:63.2,lineHeight:1.2,rotation:0},
      {id:"sr32-t5",type:"text",content:"O",x:207.8,y:220.1,fontSize:41.1,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:47.4,lineHeight:1.2,rotation:0},
      {id:"sr32-t6",type:"text",content:"IGN",x:149.9,y:241.4,fontSize:22.7,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:63.2,lineHeight:1.2,rotation:0},
      {id:"sr32-t7",type:"text",content:"LEASE",x:168.5,y:160.5,fontSize:22.7,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:76.1,lineHeight:1.2,rotation:0},
      {id:"sr32-t8",type:"text",content:"P",x:97.4,y:142.4,fontSize:35.9,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:99.5,lineHeight:1.2,rotation:0},
      {id:"sr32-t9",type:"text",content:"UESTBOOK",x:155.4,y:308.2,fontSize:22.7,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:111.9,lineHeight:1.2,rotation:0},
      {id:"sr32-t10",type:"text",content:"G",x:101.0,y:296.8,fontSize:40.2,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:47.4,lineHeight:1.2,rotation:0}
    ]},
  { id:"sr33", collection:"swan-lake", name:"Option 2", category:"polaroid-guestbook", material:"rigid", availableSizes:["a4"], sizeKey:"a4", background:"#FFFFFF", elements:[
      {id:"sr33-r0",type:"image",src:"/raster/sr33-r0.png?v=1783852885",fit:"fill",x:0.4,y:0.6,width:398.2,height:563.3,rotation:0},
      {id:"sr33-t0",type:"text",content:"S",x:70.0,y:245.0,fontSize:80.8,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:131.1,lineHeight:1.2,rotation:0},
      {id:"sr33-t1",type:"text",content:"UR",x:292.9,y:290.5,fontSize:45.6,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:127.1,lineHeight:1.2,rotation:0},
      {id:"sr33-t2",type:"text",content:"O",x:202.0,y:251.2,fontSize:82.7,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:95.3,lineHeight:1.2,rotation:0},
      {id:"sr33-t3",type:"text",content:"IGN",x:102.6,y:294.0,fontSize:45.6,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:127.1,lineHeight:1.2,rotation:0},
      {id:"sr33-t4",type:"text",content:"LEASE",x:135.8,y:131.4,fontSize:45.6,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:152.9,lineHeight:1.2,rotation:0},
      {id:"sr33-t5",type:"text",content:"P",x:-24.2,y:72.9,fontSize:79.0,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:200.1,lineHeight:1.2,rotation:0},
      {id:"sr33-t6",type:"text",content:"UESTBOOK",x:127.0,y:440.2,fontSize:45.6,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:224.9,lineHeight:1.2,rotation:0},
      {id:"sr33-t7",type:"text",content:"G",x:-1.5,y:424.8,fontSize:87.5,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:124.4,lineHeight:1.2,rotation:0}
    ]},
  { id:"sr34", collection:"swan-lake", name:"Option 3", category:"polaroid-guestbook", material:"rigid", availableSizes:["a4"], sizeKey:"a4", background:"#FFFFFF", elements:[
      {id:"sr34-aw0",type:"image",src:"/artwork/Double Swan copy.png?v=1783852885",fit:"fill",x:127.4,y:324.5,width:165.5,height:113.6,rotation:0},
      {id:"sr34-t0",type:"text",content:"Guestbook",x:25.0,y:205.7,fontSize:52.0,fontId:"mozart-light",italic:false,align:"center",color:"#231f20",width:370.2,lineHeight:1.2,rotation:0},
      {id:"sr34-t1",type:"text",content:"PLEASE SIGN OUR",x:25.0,y:137.7,fontSize:21.3,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:370.2,lineHeight:1.2,rotation:0}
    ]},
  { id:"sr35", collection:"swan-lake", name:"Option 1", category:"memorial", material:"rigid", availableSizes:["a4"], sizeKey:"a4", background:"#FFFFFF", elements:[
      {id:"sr35-border",type:"illustration",illustrationId:"border-sr35",illustrationSrc:"/borders/sr35-border.svg?v=1783852885",label:"Border",x:18.3,y:18.7,width:359.9,height:529.9,color:"#000000",rotation:0,stretch:true},
      {id:"sr35-t0",type:"text",content:"y   ",x:248.2,y:174.3,fontSize:32.6,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:78.0,lineHeight:1.2,rotation:0},
      {id:"sr35-t1s0",type:"text",content:"M",x:84.4,y:174.0,fontSize:37.2,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:81.7,lineHeight:1.2,rotation:0},
      {id:"sr35-t1s1",type:"text",content:" E MO R",x:163.5,y:180.3,fontSize:27.6,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:91.4,lineHeight:1.2,rotation:0},
      {id:"sr35-t2s0",type:"text",content:"I",x:86.2,y:107.9,fontSize:37.2,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:58.9,lineHeight:1.2,rotation:0},
      {id:"sr35-t2s1",type:"text",content:"N",x:145.7,y:114.2,fontSize:27.6,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:19.6,lineHeight:1.2,rotation:0},
      {id:"sr35-t2s2",type:"text",content:" L",x:175.5,y:107.9,fontSize:37.2,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:54.7,lineHeight:1.2,rotation:0},
      {id:"sr35-t2s3",type:"text",content:"OVING",x:230.7,y:114.2,fontSize:27.6,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:83.7,lineHeight:1.2,rotation:0},
      {id:"sr35-t3",type:"text",content:"Grandpa Jones\nJohn Michaels\nAmy Richards",x:0.6,y:411.7,fontSize:17.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:397.7,lineHeight:1.59,rotation:0},
      {id:"sr35-t4s0",type:"text",content:"Of those who",x:156.0,y:263.0,fontSize:18.4,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:100.1,lineHeight:1.2,rotation:0},
      {id:"sr35-t4s1",type:"text",content:"couldn’t be here today,",x:121.3,y:289.9,fontSize:18.4,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:164.1,lineHeight:1.2,rotation:0},
      {id:"sr35-t4s2",type:"text",content:"but are forever",x:147.9,y:316.9,fontSize:18.4,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:116.2,lineHeight:1.2,rotation:0},
      {id:"sr35-t4s3",type:"text",content:"in our hearts.",x:139.0,y:344.7,fontSize:18.4,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:128.6,lineHeight:1.2,rotation:0}
    ]},
  { id:"sr36", collection:"swan-lake", name:"Option 2", category:"memorial", material:"rigid", availableSizes:["a4"], sizeKey:"a4", background:"#FFFFFF", elements:[
      {id:"sr36-r0",type:"image",src:"/raster/sr36-r0.png?v=1783852885",fit:"fill",x:0.3,y:0.0,width:399.5,height:565.5,rotation:0},
      {id:"sr36-t0",type:"text",content:"IN LOVING",x:150.2,y:90.7,fontSize:21.4,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:144.2,lineHeight:1.2,rotation:0},
      {id:"sr36-t1",type:"text",content:"Memory",x:-12.5,y:90.5,fontSize:68.4,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:434.8,lineHeight:1.2,rotation:0},
      {id:"sr36-t2",type:"text",content:"Grandpa Jones\nJohn Michaels\nAmy Richards",x:0.3,y:402.2,fontSize:17.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:399.1,lineHeight:1.59,rotation:0},
      {id:"sr36-t3s0",type:"text",content:"Of those who",x:156.2,y:252.8,fontSize:18.5,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:100.4,lineHeight:1.2,rotation:0},
      {id:"sr36-t3s1",type:"text",content:"couldn’t be here today,",x:121.4,y:279.9,fontSize:18.5,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:164.7,lineHeight:1.2,rotation:0},
      {id:"sr36-t3s2",type:"text",content:"but are forever",x:148.1,y:307.0,fontSize:18.5,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:116.6,lineHeight:1.2,rotation:0},
      {id:"sr36-t3s3",type:"text",content:"in our hearts.",x:139.2,y:334.9,fontSize:18.5,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:129.0,lineHeight:1.2,rotation:0}
    ]},
  { id:"sr37", collection:"swan-lake", name:"Option 3", category:"memorial", material:"rigid", availableSizes:["a4"], sizeKey:"a4", background:"#FFFFFF", elements:[
      {id:"sr37-aw0",type:"image",src:"/artwork/Double Swan copy.png?v=1783852885",fit:"fill",x:114.5,y:388.8,width:165.5,height:113.6,rotation:0},
      {id:"sr37-t0",type:"text",content:"In Loving Memory",x:70.9,y:98.5,fontSize:37.2,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:252.5,lineHeight:1.2,rotation:0},
      {id:"sr37-t1",type:"text",content:"Of those who \ncouldn’t be here today,\nbut are forever \nin our hearts.",x:19.7,y:249.4,fontSize:18.4,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:361.1,lineHeight:1.46,rotation:0}
    ]},
  { id:"sr38", collection:"swan-lake", name:"Option 1", category:"table-number", material:"rigid", availableSizes:["a5"], sizeKey:"a5", background:"#FFFFFF", elements:[
      {id:"sr38-r0",type:"image",src:"/raster/sr38-r0.png?v=1783852885",fit:"fill",x:0.0,y:0.0,width:400.0,height:567.3,rotation:0},
      {id:"sr38-t0",type:"text",content:"A5",x:-271.3,y:9.9,fontSize:69.6,fontId:"jost",italic:false,align:"center",color:"#231f20",width:281.7,lineHeight:1.2,rotation:0},
      {id:"sr38-t1",type:"text",content:"NE",x:220.9,y:280.8,fontSize:47.0,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:162.6,lineHeight:1.2,rotation:0},
      {id:"sr38-t2",type:"text",content:"O",x:112.8,y:221.9,fontSize:92.0,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:216.6,lineHeight:1.2,rotation:0}
    ]},
  { id:"sr39", collection:"swan-lake", name:"Option 2", category:"table-number", material:"rigid", availableSizes:["a5"], sizeKey:"a5", background:"#FFFFFF", elements:[
      {id:"sr39-t0",type:"text",content:"ONE",x:152.0,y:266.9,fontSize:66.4,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:121.4,lineHeight:1.2,rotation:0},
      {id:"sr39-t1",type:"text",content:"Table",x:91.8,y:201.1,fontSize:53.6,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:216.6,lineHeight:1.2,rotation:0}
    ]},
  { id:"sr40", collection:"swan-lake", name:"Option 3", category:"table-number", material:"rigid", availableSizes:["a5"], sizeKey:"a5", background:"#FFFFFF", elements:[
      {id:"sr40-aw2",type:"image",src:"/artwork/Lake.png?v=1783852885",fit:"fill",x:0.5,y:-0.1,width:399.5,height:567.3,rotation:0},
      {id:"sr40-aw1",type:"image",src:"/artwork/Swan with glasses_no blue.png?v=1783852885",fit:"fill",x:180.8,y:345.8,width:161.9,height:179.2,rotation:0},
      {id:"sr40-aw0",type:"image",src:"/artwork/Swan with champagne no blue.png?v=1783852885",fit:"fill",x:78.5,y:30.1,width:126.9,height:139.6,rotation:0},
      {id:"sr40-t0",type:"text",content:"TABLE",x:217.9,y:263.4,fontSize:16.6,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:61.0,lineHeight:1.2,rotation:0},
      {id:"sr40-t1",type:"text",content:"One",x:108.2,y:258.6,fontSize:68.9,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:170.7,lineHeight:1.2,rotation:0}
    ]},
  { id:"sr41", collection:"swan-lake", name:"Option 1", category:"menu", material:"rigid", availableSizes:["a5"], sizeKey:"a5", background:"#FFFFFF", elements:[
      {id:"sr41-border",type:"illustration",illustrationId:"border-sr41",illustrationSrc:"/borders/sr41-border.svg?v=1783852885",label:"Border",x:19.1,y:18.0,width:361.5,height:531.3,color:"#000000",rotation:0,stretch:true},
      {id:"sr41-t0",type:"text",content:"Selection of soft drinks\nSparkling water",x:51.3,y:471.7,fontSize:8.5,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:310.8,lineHeight:1.83,rotation:0},
      {id:"sr41-t1",type:"text",content:"Non-Alcoholic",x:51.3,y:449.0,fontSize:13.4,fontId:"mozart-light",italic:false,align:"center",color:"#231f20",width:310.8,lineHeight:1.2,rotation:0},
      {id:"sr41-t2",type:"text",content:"Great Northern Super Crisp Lager\nCarlton Dry",x:51.3,y:409.0,fontSize:8.5,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:310.8,lineHeight:1.83,rotation:0},
      {id:"sr41-t3",type:"text",content:"Beer",x:51.3,y:386.1,fontSize:13.4,fontId:"mozart-light",italic:false,align:"center",color:"#231f20",width:310.8,lineHeight:1.2,rotation:0},
      {id:"sr41-t4",type:"text",content:"Tolpuddle Vineyard Pinot Noir\nPenfolds Bin 389 Cabernet Shiraz",x:51.3,y:344.2,fontSize:8.5,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:310.8,lineHeight:1.83,rotation:0},
      {id:"sr41-t5",type:"text",content:"Red",x:51.3,y:320.5,fontSize:13.4,fontId:"mozart-light",italic:false,align:"center",color:"#231f20",width:310.8,lineHeight:1.2,rotation:0},
      {id:"sr41-t6",type:"text",content:"Shaw + Smith Sauvignon Blanc\nLeeuwin Estate Art Series Chardonnay",x:51.3,y:282.4,fontSize:8.5,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:310.8,lineHeight:1.83,rotation:0},
      {id:"sr41-t7",type:"text",content:"White",x:51.3,y:262.7,fontSize:13.4,fontId:"mozart-light",italic:false,align:"center",color:"#231f20",width:310.8,lineHeight:1.2,rotation:0},
      {id:"sr41-t8",type:"text",content:"Howard Park NV Petit Jeté\nHouse of Arras Brut Elite Cuvée",x:51.3,y:224.6,fontSize:8.5,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:310.8,lineHeight:1.83,rotation:0},
      {id:"sr41-t9",type:"text",content:"Bubbles",x:51.3,y:199.9,fontSize:13.4,fontId:"mozart-light",italic:false,align:"center",color:"#231f20",width:310.8,lineHeight:1.2,rotation:0},
      {id:"sr41-t10",type:"text",content:"RINK",x:250.3,y:141.0,fontSize:22.3,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:58.9,lineHeight:1.2,rotation:0},
      {id:"sr41-t11",type:"text",content:"O",x:170.4,y:106.6,fontSize:22.3,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:15.2,lineHeight:1.2,rotation:0},
      {id:"sr41-t12",type:"text",content:"D",x:190.9,y:105.2,fontSize:43.6,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:79.3,lineHeight:1.2,rotation:0},
      {id:"sr41-t13",type:"text",content:"T",x:104.5,y:78.6,fontSize:43.6,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:70.8,lineHeight:1.2,rotation:0}
    ]},
  { id:"sr42", collection:"swan-lake", name:"Option 2", category:"menu", material:"rigid", availableSizes:["a5"], sizeKey:"a5", background:"#FFFFFF", elements:[
      {id:"sr42-border",type:"illustration",illustrationId:"border-sr42",illustrationSrc:"/borders/sr42-border.svg?v=1783852885",label:"Border",x:24.5,y:27.7,width:354.6,height:517.6,color:"#000000",rotation:0,stretch:true},
      {id:"sr42-aw0",type:"image",src:"/artwork/Swan with glasses_left_oil.png?v=1783852885",fit:"fill",x:34.6,y:391.4,width:95.1,height:110.9,rotation:0},
      {id:"sr42-aw1",type:"image",src:"/artwork/Swan with champagne bottle_left_oil.png?v=1783852885",fit:"fill",x:215.4,y:169.1,width:78.9,height:86.4,rotation:0},
      {id:"sr42-t0",type:"text",content:"Selection of soft drinks\nSparkling water",x:155.3,y:475.4,fontSize:8.5,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:172.8,lineHeight:1.83,rotation:0},
      {id:"sr42-t1",type:"text",content:"ON - ALCOHOLIC",x:192.5,y:457.2,fontSize:10.5,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:79.2,lineHeight:1.2,rotation:0},
      {id:"sr42-t2",type:"text",content:"N",x:153.1,y:442.9,fontSize:20.6,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:55.8,lineHeight:1.2,rotation:0},
      {id:"sr42-t3",type:"text",content:"Great Northern Super Crisp Lager\nCarlton Dry",x:146.7,y:396.1,fontSize:8.5,fontId:"dubiel",italic:false,align:"right",color:"#231f20",width:172.8,lineHeight:1.83,rotation:0},
      {id:"sr42-t4",type:"text",content:"EER",x:270.8,y:375.8,fontSize:10.5,fontId:"dubiel",italic:false,align:"right",color:"#231f20",width:48.7,lineHeight:1.2,rotation:0},
      {id:"sr42-t5",type:"text",content:"B",x:247.7,y:363.7,fontSize:20.6,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:55.8,lineHeight:1.2,rotation:0},
      {id:"sr42-t6",type:"text",content:"Tolpuddle Vineyard Pinot Noir\nPenfolds Bin 389 Cabernet Shiraz",x:74.8,y:344.9,fontSize:8.5,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:172.8,lineHeight:2.02,rotation:0},
      {id:"sr42-t7",type:"text",content:"ED",x:133.4,y:314.1,fontSize:10.5,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:48.7,lineHeight:1.2,rotation:0},
      {id:"sr42-t8",type:"text",content:"R",x:79.1,y:308.8,fontSize:20.6,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:55.8,lineHeight:1.2,rotation:0},
      {id:"sr42-t9",type:"text",content:"Shaw + Smith Sauvignon Blanc\nLeeuwin Estate Art Series Chardonnay",x:153.4,y:296.5,fontSize:8.5,fontId:"dubiel",italic:false,align:"right",color:"#231f20",width:172.8,lineHeight:1.83,rotation:0},
      {id:"sr42-t10",type:"text",content:"HITE",x:277.5,y:276.2,fontSize:10.5,fontId:"dubiel",italic:false,align:"right",color:"#231f20",width:48.7,lineHeight:1.2,rotation:0},
      {id:"sr42-t11",type:"text",content:"W",x:269.4,y:264.1,fontSize:20.6,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:55.8,lineHeight:1.2,rotation:0},
      {id:"sr42-t12",type:"text",content:"Howard Park NV Petit Jeté\nHouse of Arras Brut Elite Cuvée",x:74.9,y:237.5,fontSize:8.5,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:172.8,lineHeight:1.83,rotation:0},
      {id:"sr42-t13",type:"text",content:"UBBLES",x:133.5,y:206.7,fontSize:10.5,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:48.7,lineHeight:1.2,rotation:0},
      {id:"sr42-t14",type:"text",content:"B",x:79.2,y:201.4,fontSize:20.6,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:55.8,lineHeight:1.2,rotation:0},
      {id:"sr42-t15",type:"text",content:"AR",x:274.8,y:129.7,fontSize:19.8,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:52.4,lineHeight:1.2,rotation:0},
      {id:"sr42-t16",type:"text",content:"HE",x:187.4,y:97.1,fontSize:19.8,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:57.4,lineHeight:1.2,rotation:0},
      {id:"sr42-t17",type:"text",content:"B",x:172.6,y:119.7,fontSize:38.8,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:105.0,lineHeight:1.2,rotation:0},
      {id:"sr42-t18",type:"text",content:"T",x:124.5,y:75.2,fontSize:38.8,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:62.9,lineHeight:1.2,rotation:0}
    ]},
  { id:"sr43", collection:"swan-lake", name:"Option 3", category:"menu", material:"rigid", availableSizes:["a5"], sizeKey:"a5", background:"#FFFFFF", elements:[
      {id:"sr43-aw0",type:"image",src:"/artwork/Swan with glasses_left_oil.png?v=1783852885",fit:"fill",x:250.1,y:419.6,width:108.7,height:120.3,rotation:0},
      {id:"sr43-t0",type:"text",content:"Selection of soft drinks\nSparkling water\nTea + Coffee",x:168.8,y:423.6,fontSize:8.5,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:99.2,lineHeight:1.83,rotation:0},
      {id:"sr43-t1",type:"text",content:"Non  Alcoholic",x:49.1,y:423.5,fontSize:20.6,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:175.3,lineHeight:1.2,rotation:0},
      {id:"sr43-t2",type:"text",content:"Great Northern Super Crisp Lager\nCarlton Dry",x:145.7,y:365.1,fontSize:8.5,fontId:"dubiel",italic:false,align:"right",color:"#231f20",width:114.7,lineHeight:1.83,rotation:0},
      {id:"sr43-t3",type:"text",content:"Beer",x:267.8,y:366.3,fontSize:20.6,fontId:"mozart-light",italic:false,align:"right",color:"#231f20",width:83.5,lineHeight:1.2,rotation:0},
      {id:"sr43-t4",type:"text",content:"Tolpuddle Vineyard Pinot Noir\nPenfolds Bin 389 Cabernet Shiraz",x:133.2,y:306.6,fontSize:8.5,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:121.3,lineHeight:1.83,rotation:0},
      {id:"sr43-t5",type:"text",content:"Red",x:49.1,y:306.8,fontSize:20.6,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:91.7,lineHeight:1.2,rotation:0},
      {id:"sr43-t6",type:"text",content:"Shaw + Smith Sauvignon Blanc\nLeeuwin Estate Art Series Chardonnay",x:106.3,y:246.2,fontSize:8.5,fontId:"dubiel",italic:false,align:"right",color:"#231f20",width:172.8,lineHeight:1.83,rotation:0},
      {id:"sr43-t7",type:"text",content:"White",x:269.1,y:249.1,fontSize:20.6,fontId:"mozart-light",italic:false,align:"right",color:"#231f20",width:80.5,lineHeight:1.2,rotation:0},
      {id:"sr43-t8",type:"text",content:"Howard Park NV Petit Jeté\nHouse of Arras Brut Elite Cuvée",x:167.2,y:184.2,fontSize:8.5,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:121.3,lineHeight:1.83,rotation:0},
      {id:"sr43-t9",type:"text",content:"Bubbles",x:49.2,y:188.0,fontSize:20.6,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:122.1,lineHeight:1.2,rotation:0},
      {id:"sr43-t10",type:"text",content:"Bar",x:145.3,y:107.1,fontSize:41.9,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:216.8,lineHeight:1.2,rotation:0},
      {id:"sr43-t11",type:"text",content:"The",x:93.4,y:58.9,fontSize:41.9,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:160.5,lineHeight:1.2,rotation:0}
    ]},
  { id:"sr44", collection:"swan-lake", name:"Option 1", category:"wishing-well", material:"rigid", availableSizes:["a5"], sizeKey:"a5", background:"#FFFFFF", elements:[
      {id:"sr44-border",type:"illustration",illustrationId:"border-sr44",illustrationSrc:"/borders/sr44-border.svg?v=1783852885",label:"Border",x:19.4,y:18.0,width:361.5,height:531.3,color:"#000000",rotation:0,stretch:true},
      {id:"sr44-t0",type:"text",content:"ISHES",x:221.7,y:406.9,fontSize:31.6,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:110.5,lineHeight:1.2,rotation:0},
      {id:"sr44-t1",type:"text",content:"W",x:145.1,y:362.1,fontSize:60.9,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:97.3,lineHeight:1.2,rotation:0},
      {id:"sr44-t2",type:"text",content:"&",x:241.9,y:231.2,fontSize:36.4,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:50.5,lineHeight:1.2,rotation:0},
      {id:"sr44-t3",type:"text",content:"ELL",x:179.6,y:279.4,fontSize:31.6,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:110.5,lineHeight:1.2,rotation:0},
      {id:"sr44-t4",type:"text",content:"W",x:96.5,y:239.3,fontSize:60.9,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:97.3,lineHeight:1.2,rotation:0},
      {id:"sr44-t5",type:"text",content:"ARDS",x:162.5,y:176.5,fontSize:31.6,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:110.5,lineHeight:1.2,rotation:0},
      {id:"sr44-t6",type:"text",content:"C",x:120.4,y:127.9,fontSize:62.8,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:44.0,lineHeight:1.2,rotation:0}
    ]},
  { id:"sr45", collection:"swan-lake", name:"Option 2", category:"wishing-well", material:"rigid", availableSizes:["a5"], sizeKey:"a5", background:"#FFFFFF", elements:[
      {id:"sr45-r0",type:"image",src:"/raster/sr45-r0.png?v=1783852885",fit:"fill",x:0.0,y:0.2,width:400.0,height:567.3,rotation:0},
      {id:"sr45-t0",type:"text",content:"ISHES",x:263.3,y:491.5,fontSize:42.9,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:191.6,lineHeight:1.2,rotation:0},
      {id:"sr45-t1",type:"text",content:"W",x:103.4,y:440.3,fontSize:106.0,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:168.7,lineHeight:1.2,rotation:0},
      {id:"sr45-t2",type:"text",content:"&",x:271.3,y:212.6,fontSize:63.3,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:87.6,lineHeight:1.2,rotation:0},
      {id:"sr45-t3",type:"text",content:"ELL",x:163.2,y:296.3,fontSize:42.9,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:191.6,lineHeight:1.2,rotation:0},
      {id:"sr45-t4",type:"text",content:"W",x:19.2,y:226.6,fontSize:106.0,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:168.7,lineHeight:1.2,rotation:0},
      {id:"sr45-t5",type:"text",content:"ARDS",x:133.6,y:117.3,fontSize:42.9,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:191.6,lineHeight:1.2,rotation:0},
      {id:"sr45-t6",type:"text",content:"C",x:60.7,y:36.9,fontSize:109.3,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:76.4,lineHeight:1.2,rotation:0}
    ]},
  { id:"sr46", collection:"swan-lake", name:"Option 3", category:"wishing-well", material:"rigid", availableSizes:["a5"], sizeKey:"a5", background:"#FFFFFF", elements:[
      {id:"sr46-aw0",type:"image",src:"/artwork/Double Swan copy.png?v=1783852885",fit:"fill",x:117.3,y:363.5,width:165.2,height:113.4,rotation:0},
      {id:"sr46-t0",type:"text",content:"&",x:190.0,y:171.9,fontSize:31.0,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:46.3,lineHeight:1.2,rotation:0},
      {id:"sr46-t1",type:"text",content:"Well Wishes",x:15.1,y:245.0,fontSize:43.8,fontId:"mozart-light",italic:false,align:"center",color:"#231f20",width:369.5,lineHeight:1.2,rotation:0},
      {id:"sr46-t2",type:"text",content:"Cards",x:15.1,y:116.2,fontSize:43.8,fontId:"mozart-light",italic:false,align:"center",color:"#231f20",width:369.5,lineHeight:1.2,rotation:0}
    ]},
  { id:"sr47", collection:"swan-lake", name:"Option 1", category:"polaroid-guestbook", material:"rigid", availableSizes:["a5"], sizeKey:"a5", background:"#FFFFFF", elements:[
      {id:"sr47-border",type:"illustration",illustrationId:"border-sr47",illustrationSrc:"/borders/sr47-border.svg?v=1783852885",label:"Border",x:21.1,y:17.7,width:361.5,height:531.3,color:"#000000",rotation:0,stretch:true},
      {id:"sr47-t0",type:"text",content:"S",x:133.4,y:217.4,fontSize:40.1,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:65.1,lineHeight:1.2,rotation:0},
      {id:"sr47-t1",type:"text",content:"&",x:179.9,y:446.4,fontSize:13.5,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:17.0,lineHeight:1.2,rotation:0},
      {id:"sr47-t2",type:"text",content:"J",x:186.0,y:453.6,fontSize:19.8,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:89.1,lineHeight:1.2,rotation:0},
      {id:"sr47-t3",type:"text",content:"M",x:177.6,y:428.2,fontSize:19.8,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:89.1,lineHeight:1.2,rotation:0},
      {id:"sr47-t4",type:"text",content:"UR",x:256.7,y:240.0,fontSize:22.7,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:63.1,lineHeight:1.2,rotation:0},
      {id:"sr47-t5",type:"text",content:"O",x:209.5,y:220.5,fontSize:41.1,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:47.3,lineHeight:1.2,rotation:0},
      {id:"sr47-t6",type:"text",content:"IGN",x:151.7,y:241.8,fontSize:22.7,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:63.1,lineHeight:1.2,rotation:0},
      {id:"sr47-t7",type:"text",content:"LEASE",x:170.2,y:161.0,fontSize:22.7,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:76.0,lineHeight:1.2,rotation:0},
      {id:"sr47-t8",type:"text",content:"P",x:99.3,y:143.0,fontSize:35.9,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:99.3,lineHeight:1.2,rotation:0},
      {id:"sr47-t9",type:"text",content:"UESTBOOK",x:157.2,y:308.5,fontSize:22.7,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:111.7,lineHeight:1.2,rotation:0},
      {id:"sr47-t10",type:"text",content:"G",x:102.8,y:297.2,fontSize:40.1,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:47.3,lineHeight:1.2,rotation:0}
    ]},
  { id:"sr48", collection:"swan-lake", name:"Option 2", category:"polaroid-guestbook", material:"rigid", availableSizes:["a5"], sizeKey:"a5", background:"#FFFFFF", elements:[
      {id:"sr48-r0",type:"image",src:"/raster/sr48-r0.png?v=1783852885",fit:"fill",x:0.6,y:0.5,width:399.4,height:567.1,rotation:0},
      {id:"sr48-t0",type:"text",content:"S",x:72.1,y:249.8,fontSize:83.1,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:134.8,lineHeight:1.2,rotation:0},
      {id:"sr48-t1",type:"text",content:"UR",x:301.3,y:296.6,fontSize:46.9,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:130.7,lineHeight:1.2,rotation:0},
      {id:"sr48-t2",type:"text",content:"O",x:207.9,y:256.2,fontSize:85.0,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:98.0,lineHeight:1.2,rotation:0},
      {id:"sr48-t3",type:"text",content:"IGN",x:105.6,y:300.3,fontSize:46.9,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:130.7,lineHeight:1.2,rotation:0},
      {id:"sr48-t4",type:"text",content:"LEASE",x:139.8,y:133.1,fontSize:46.9,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:157.2,lineHeight:1.2,rotation:0},
      {id:"sr48-t5",type:"text",content:"P",x:-24.7,y:72.9,fontSize:81.2,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:205.7,lineHeight:1.2,rotation:0},
      {id:"sr48-t6",type:"text",content:"UESTBOOK",x:130.7,y:450.5,fontSize:46.9,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:231.2,lineHeight:1.2,rotation:0},
      {id:"sr48-t7",type:"text",content:"G",x:8.5,y:434.7,fontSize:89.9,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:127.8,lineHeight:1.2,rotation:0}
    ]},
  { id:"sr49", collection:"swan-lake", name:"Option 3", category:"polaroid-guestbook", material:"rigid", availableSizes:["a5"], sizeKey:"a5", background:"#FFFFFF", elements:[
      {id:"sr49-aw0",type:"image",src:"/artwork/Double Swan copy.png?v=1783852885",fit:"fill",x:117.1,y:332.3,width:165.2,height:113.4,rotation:0},
      {id:"sr49-t0",type:"text",content:"Guestbook",x:14.9,y:213.8,fontSize:51.9,fontId:"mozart-light",italic:false,align:"center",color:"#231f20",width:369.5,lineHeight:1.2,rotation:0},
      {id:"sr49-t1",type:"text",content:"PLEASE SIGN OUR",x:14.9,y:145.9,fontSize:21.2,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:369.5,lineHeight:1.2,rotation:0}
    ]},
  { id:"sr50", collection:"swan-lake", name:"Option 1", category:"memorial", material:"rigid", availableSizes:["a5"], sizeKey:"a5", background:"#FFFFFF", elements:[
      {id:"sr50-border",type:"illustration",illustrationId:"border-sr50",illustrationSrc:"/borders/sr50-border.svg?v=1783852885",label:"Border",x:18.1,y:18.1,width:361.5,height:531.3,color:"#000000",rotation:0,stretch:true},
      {id:"sr50-t0",type:"text",content:"y   ",x:248.7,y:174.5,fontSize:32.6,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:77.8,lineHeight:1.2,rotation:0},
      {id:"sr50-t1s0",type:"text",content:"M",x:85.2,y:174.2,fontSize:37.1,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:82.7,lineHeight:1.2,rotation:0},
      {id:"sr50-t1s1",type:"text",content:" E MO R",x:164.1,y:180.6,fontSize:27.5,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:92.4,lineHeight:1.2,rotation:0},
      {id:"sr50-t2s0",type:"text",content:"I",x:87.0,y:108.2,fontSize:37.1,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:59.9,lineHeight:1.2,rotation:0},
      {id:"sr50-t2s1",type:"text",content:"N",x:146.4,y:114.6,fontSize:27.5,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:20.7,lineHeight:1.2,rotation:0},
      {id:"sr50-t2s2",type:"text",content:" L",x:176.1,y:108.2,fontSize:37.1,fontId:"mozart-light",italic:false,align:"left",color:"#000000",width:55.7,lineHeight:1.2,rotation:0},
      {id:"sr50-t2s3",type:"text",content:"OVING",x:231.2,y:114.6,fontSize:27.5,fontId:"dubiel",italic:false,align:"left",color:"#000000",width:84.7,lineHeight:1.2,rotation:0},
      {id:"sr50-t3",type:"text",content:"Grandpa Jones\nJohn Michaels\nAmy Richards",x:1.5,y:411.6,fontSize:17.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:397.0,lineHeight:1.59,rotation:0},
      {id:"sr50-t4s0",type:"text",content:"Of those who",x:156.7,y:263.1,fontSize:18.4,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:101.0,lineHeight:1.2,rotation:0},
      {id:"sr50-t4s1",type:"text",content:"couldn’t be here today,",x:122.0,y:290.0,fontSize:18.4,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:165.0,lineHeight:1.2,rotation:0},
      {id:"sr50-t4s2",type:"text",content:"but are forever",x:148.6,y:316.9,fontSize:18.4,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:117.1,lineHeight:1.2,rotation:0},
      {id:"sr50-t4s3",type:"text",content:"in our hearts.",x:139.7,y:344.7,fontSize:18.4,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:129.5,lineHeight:1.2,rotation:0}
    ]},
  { id:"sr51", collection:"swan-lake", name:"Option 2", category:"memorial", material:"rigid", availableSizes:["a5"], sizeKey:"a5", background:"#FFFFFF", elements:[
      {id:"sr51-r0",type:"image",src:"/raster/sr51-r0.png?v=1783852885",fit:"fill",x:1.7,y:0.0,width:398.3,height:564.6,rotation:0},
      {id:"sr51-t0",type:"text",content:"IN LOVING",x:151.4,y:90.6,fontSize:21.3,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:144.0,lineHeight:1.2,rotation:0},
      {id:"sr51-t1",type:"text",content:"Memory",x:-11.0,y:90.4,fontSize:68.3,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:434.0,lineHeight:1.2,rotation:0},
      {id:"sr51-t2",type:"text",content:"Grandpa Jones\nJohn Michaels\nAmy Richards",x:1.8,y:401.6,fontSize:17.0,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:398.4,lineHeight:1.59,rotation:0},
      {id:"sr51-t3s0",type:"text",content:"Of those who",x:157.5,y:252.5,fontSize:18.4,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:101.3,lineHeight:1.2,rotation:0},
      {id:"sr51-t3s1",type:"text",content:"couldn’t be here today,",x:122.7,y:279.5,fontSize:18.4,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:165.5,lineHeight:1.2,rotation:0},
      {id:"sr51-t3s2",type:"text",content:"but are forever",x:149.4,y:306.6,fontSize:18.4,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:117.5,lineHeight:1.2,rotation:0},
      {id:"sr51-t3s3",type:"text",content:"in our hearts.",x:140.5,y:334.5,fontSize:18.4,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:129.9,lineHeight:1.2,rotation:0}
    ]},
  { id:"sr52", collection:"swan-lake", name:"Option 3", category:"memorial", material:"rigid", availableSizes:["a5"], sizeKey:"a5", background:"#FFFFFF", elements:[
      {id:"sr52-aw0",type:"image",src:"/artwork/Double Swan copy.png?v=1783852885",fit:"fill",x:116.2,y:382.2,width:165.2,height:113.4,rotation:0},
      {id:"sr52-t0",type:"text",content:"In Loving Memory",x:72.6,y:92.4,fontSize:37.1,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:252.1,lineHeight:1.2,rotation:0},
      {id:"sr52-t1",type:"text",content:"Of those who \ncouldn’t be here today,\nbut are forever \nin our hearts.",x:21.5,y:243.0,fontSize:18.4,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:360.5,lineHeight:1.46,rotation:0}
    ]},
  // ⟦generated-collection:swan-lake-rigid END⟧
  // ⟦generated-collection:swan-lake-signs-2 START⟧ — auto-managed by splice_templates.py, do not hand-edit
  { id:"sl200", collection:"swan-lake", name:"Option 1", category:"wedding-welcome", availableSizes:["700x3000"], sizeKey:"700x3000", background:"#FFFFFF", elements:[
      {id:"sl200-t0",type:"text",content:"WELCOME TO \nTHE WEDDING OF",x:0.1,y:201.2,fontSize:17.4,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:399.9,lineHeight:1.37,rotation:0},
      {id:"sl200-t1",type:"text",content:"&",x:59.5,y:448.5,fontSize:42.6,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:53.9,lineHeight:1.2,rotation:0},
      {id:"sl200-t2",type:"text",content:"<span style=\"font-feature-settings: &quot;ss02&quot;;\">s</span>",x:287.5,y:506.7,fontSize:44.0,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:38.3,lineHeight:1.2,rotation:0},
      {id:"sl200-t3",type:"text",content:"AME",x:218.0,y:524.2,fontSize:32.0,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:168.8,lineHeight:1.2,rotation:0},
      {id:"sl200-t4",type:"text",content:"ONIQUE",x:181.2,y:408.4,fontSize:32.0,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:110.6,lineHeight:1.2,rotation:0},
      {id:"sl200-t5",type:"text",content:"J",x:132.8,y:466.8,fontSize:62.6,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:113.7,lineHeight:1.2,rotation:0},
      {id:"sl200-t6",type:"text",content:"M",x:38.3,y:368.3,fontSize:62.6,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:147.3,lineHeight:1.2,rotation:0},
      {id:"sl200-t7",type:"text",content:"12 OCTOBER 2026",x:0.1,y:693.2,fontSize:16.3,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:399.9,lineHeight:1.2,rotation:0}
    ]},
  { id:"sl201", collection:"swan-lake", name:"Option 2", category:"wedding-welcome", availableSizes:["700x3000"], sizeKey:"700x3000", background:"#FFFFFF", elements:[
      {id:"sl201-t0",type:"text",content:"WELCOME TO",x:-0.1,y:212.5,fontSize:18.8,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:400.2,lineHeight:1.2,rotation:0},
      {id:"sl201-t1",type:"text",content:"the",x:214.8,y:312.4,fontSize:37.8,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:154.7,lineHeight:1.2,rotation:0},
      {id:"sl201-t2",type:"text",content:"<span style=\"font-feature-settings: &quot;ss02&quot;;\">s</span>",x:309.6,y:371.8,fontSize:36.1,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:74.9,lineHeight:1.2,rotation:0},
      {id:"sl201-t3",type:"text",content:"wedding",x:182.2,y:415.8,fontSize:37.8,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:171.4,lineHeight:1.2,rotation:0},
      {id:"sl201-t4",type:"text",content:"ATTHEW",x:176.2,y:382.4,fontSize:33.6,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:139.2,lineHeight:1.2,rotation:0},
      {id:"sl201-t5",type:"text",content:"M",x:36.4,y:340.3,fontSize:65.8,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:154.7,lineHeight:1.2,rotation:0},
      {id:"sl201-t6",type:"text",content:"12 OCTOBER 2026",x:-0.1,y:582.3,fontSize:17.6,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:400.2,lineHeight:1.2,rotation:0}
    ]},
  { id:"sl202", collection:"swan-lake", name:"Option 3", category:"wedding-welcome", availableSizes:["700x3000"], sizeKey:"700x3000", background:"#FFFFFF", elements:[
      {id:"sl202-aw0",type:"image",src:"/artwork/Cloud Artwork_light_skinny.png?v=1783854787",fit:"fill",x:-0.6,y:-0.0,width:400.6,height:1714.3,rotation:0},
      {id:"sl202-t0",type:"text",content:"&",x:-8.1,y:751.2,fontSize:121.6,fontId:"mozart-light",italic:false,align:"right",color:"#000000",width:163.9,lineHeight:1.2,rotation:0},
      {id:"sl202-t1",type:"text",content:"J",x:-20.7,y:812.8,fontSize:176.2,fontId:"mozart-light",italic:false,align:"right",color:"#000000",width:331.7,lineHeight:1.2,rotation:0},
      {id:"sl202-t2",type:"text",content:"M",x:-15.7,y:587.1,fontSize:171.1,fontId:"mozart-light",italic:false,align:"right",color:"#000000",width:367.7,lineHeight:1.2,rotation:0},
      {id:"sl202-t3",type:"text",content:"to our",x:86.7,y:309.2,fontSize:55.4,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:273.8,lineHeight:1.2,rotation:0},
      {id:"sl202-t4s0",type:"text",content:"W",x:66.5,y:239.7,fontSize:55.4,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:83.5,lineHeight:1.2,rotation:0},
      {id:"sl202-t4s1",type:"text",content:"elcome",x:155.6,y:237.0,fontSize:55.4,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:164.4,lineHeight:1.2,rotation:0},
      {id:"sl202-t5s0",type:"text",content:"F",x:106.6,y:385.2,fontSize:55.4,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:26.8,lineHeight:1.2,rotation:0},
      {id:"sl202-t5s1",type:"text",content:"oreve",x:139.1,y:382.5,fontSize:55.4,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:129.9,lineHeight:1.2,rotation:0},
      {id:"sl202-t5s2",type:"text",content:"<span style=\"font-feature-settings: &quot;ss08&quot;;\">r</span>",x:274.6,y:385.2,fontSize:55.4,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:67.5,lineHeight:1.2,rotation:0}
    ]},
  { id:"sl203", collection:"swan-lake", name:"Option 1", category:"wedding-seating", availableSizes:["700x3000"], sizeKey:"700x3000", background:"#FFFFFF", elements:[
      {id:"sl203-t0",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\nScheana Shae\nJames Kennedy\nSheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\nScheana Shae\nJames Kennedy\n Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\nScheana Shae\nJames Kennedy\n \n ",x:83.6,y:387.2,fontSize:11.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:99.5,lineHeight:1.56,rotation:0},
      {id:"sl203-t1",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\nScheana Shae\nJames Kennedy\nSheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\nScheana Shae\nJames Kennedy\n Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\nScheana Shae\nJames Kennedy\n \n ",x:225.4,y:387.4,fontSize:11.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:99.5,lineHeight:1.56,rotation:0},
      {id:"sl203-t2",type:"text",content:"WO",x:279.0,y:358.6,fontSize:12.8,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:20.5,lineHeight:1.2,rotation:0},
      {id:"sl203-t3",type:"text",content:"T",x:240.7,y:342.6,fontSize:25.0,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:58.9,lineHeight:1.2,rotation:0},
      {id:"sl203-t4",type:"text",content:"NE",x:133.6,y:358.7,fontSize:12.8,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:44.2,lineHeight:1.2,rotation:0},
      {id:"sl203-t5",type:"text",content:"O",x:104.2,y:342.6,fontSize:25.0,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:58.9,lineHeight:1.2,rotation:0},
      {id:"sl203-t6",type:"text",content:"EOPLE",x:270.0,y:258.7,fontSize:23.7,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:81.0,lineHeight:1.2,rotation:0},
      {id:"sl203-t7",type:"text",content:"P",x:187.9,y:224.7,fontSize:46.4,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:104.3,lineHeight:1.2,rotation:0},
      {id:"sl203-t8",type:"text",content:"AVOURITE",x:116.3,y:208.5,fontSize:23.7,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:115.0,lineHeight:1.2,rotation:0},
      {id:"sl203-t9",type:"text",content:"OUR",x:219.3,y:162.4,fontSize:23.7,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:68.6,lineHeight:1.2,rotation:0},
      {id:"sl203-t10",type:"text",content:"F",x:42.3,y:183.1,fontSize:46.4,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:84.6,lineHeight:1.2,rotation:0},
      {id:"sl203-t11",type:"text",content:"O",x:167.6,y:129.8,fontSize:46.4,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:75.2,lineHeight:1.2,rotation:0}
    ]},
  { id:"sl204", collection:"swan-lake", name:"Option 2", category:"wedding-seating", availableSizes:["700x3000"], sizeKey:"700x3000", background:"#FFFFFF", elements:[
      {id:"sl204-t0",type:"text",content:"Twelve",x:265.6,y:948.1,fontSize:17.5,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:72.7,lineHeight:1.2,rotation:0},
      {id:"sl204-t1",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\n ",x:252.6,y:973.5,fontSize:11.3,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:100.5,lineHeight:1.33,rotation:0},
      {id:"sl204-t2",type:"text",content:"Eleven",x:165.0,y:948.0,fontSize:17.5,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:72.7,lineHeight:1.2,rotation:0},
      {id:"sl204-t3",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\n ",x:152.1,y:973.4,fontSize:11.3,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:100.5,lineHeight:1.33,rotation:0},
      {id:"sl204-t4",type:"text",content:"Ten",x:57.2,y:948.1,fontSize:17.5,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:72.7,lineHeight:1.2,rotation:0},
      {id:"sl204-t5",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\n ",x:44.2,y:973.5,fontSize:11.3,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:100.5,lineHeight:1.33,rotation:0},
      {id:"sl204-t6",type:"text",content:"Nine",x:256.5,y:734.3,fontSize:17.5,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:72.7,lineHeight:1.2,rotation:0},
      {id:"sl204-t7",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\n ",x:243.5,y:759.7,fontSize:11.3,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:100.5,lineHeight:1.33,rotation:0},
      {id:"sl204-t8",type:"text",content:"Eight",x:156.0,y:734.2,fontSize:17.5,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:72.7,lineHeight:1.2,rotation:0},
      {id:"sl204-t9",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\n ",x:143.0,y:759.6,fontSize:11.3,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:100.5,lineHeight:1.33,rotation:0},
      {id:"sl204-t10",type:"text",content:"Seven",x:48.1,y:734.3,fontSize:17.5,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:72.7,lineHeight:1.2,rotation:0},
      {id:"sl204-t11",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\n ",x:35.1,y:759.7,fontSize:11.3,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:100.5,lineHeight:1.33,rotation:0},
      {id:"sl204-t12",type:"text",content:"Six",x:262.8,y:524.3,fontSize:17.5,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:72.7,lineHeight:1.2,rotation:0},
      {id:"sl204-t13",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\n ",x:249.9,y:549.7,fontSize:11.3,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:100.5,lineHeight:1.33,rotation:0},
      {id:"sl204-t14",type:"text",content:"Five",x:162.3,y:524.2,fontSize:17.5,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:72.7,lineHeight:1.2,rotation:0},
      {id:"sl204-t15",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\n ",x:149.3,y:549.7,fontSize:11.3,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:100.5,lineHeight:1.33,rotation:0},
      {id:"sl204-t16",type:"text",content:"Four",x:54.4,y:524.4,fontSize:17.5,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:72.7,lineHeight:1.2,rotation:0},
      {id:"sl204-t17",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\n ",x:41.4,y:549.8,fontSize:11.3,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:100.5,lineHeight:1.33,rotation:0},
      {id:"sl204-t18",type:"text",content:"Three",x:259.1,y:314.6,fontSize:17.5,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:72.7,lineHeight:1.2,rotation:0},
      {id:"sl204-t19",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\n ",x:246.1,y:340.0,fontSize:11.3,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:100.5,lineHeight:1.33,rotation:0},
      {id:"sl204-t20",type:"text",content:"Two",x:158.6,y:314.5,fontSize:17.5,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:72.7,lineHeight:1.2,rotation:0},
      {id:"sl204-t21",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\n ",x:145.6,y:339.9,fontSize:11.3,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:100.5,lineHeight:1.33,rotation:0},
      {id:"sl204-t22",type:"text",content:"One",x:50.7,y:314.6,fontSize:17.5,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:72.7,lineHeight:1.2,rotation:0},
      {id:"sl204-t23",type:"text",content:"Sheana Shae \nLisa Vander \nAndy Cohen \nMax Schroder \nTom Schwartz \nNathan Cohen \nKatie Schroder \nJames Kennedy \nLaura Kent \nRaquel Kennedy\n ",x:37.7,y:340.1,fontSize:11.3,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:100.5,lineHeight:1.33,rotation:0},
      {id:"sl204-t24",type:"text",content:"WAITS",x:179.5,y:237.5,fontSize:23.7,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:81.0,lineHeight:1.2,rotation:0},
      {id:"sl204-t25",type:"text",content:"A",x:75.2,y:203.5,fontSize:46.4,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:104.3,lineHeight:1.2,rotation:0},
      {id:"sl204-t26",type:"text",content:"EAT",x:270.1,y:188.1,fontSize:23.7,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:115.0,lineHeight:1.2,rotation:0},
      {id:"sl204-t27",type:"text",content:"OUR",x:212.2,y:146.1,fontSize:23.7,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:68.6,lineHeight:1.2,rotation:0},
      {id:"sl204-t28",type:"text",content:"S",x:202.1,y:168.5,fontSize:46.4,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:84.6,lineHeight:1.2,rotation:0},
      {id:"sl204-t29",type:"text",content:"Y",x:143.2,y:113.5,fontSize:46.4,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:75.2,lineHeight:1.2,rotation:0}
    ]},
  { id:"sl205", collection:"swan-lake", name:"Option 3", category:"wedding-seating", availableSizes:["700x3000"], sizeKey:"700x3000", background:"#FFFFFF", elements:[
      {id:"sl205-t0",type:"text",content:"Z",x:269.4,y:797.6,fontSize:10.9,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:80.2,lineHeight:1.2,rotation:0},
      {id:"sl205-t1",type:"text",content:"Amelia Zhang\nCharlie ",x:271.7,y:818.1,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.38,rotation:0},
      {id:"sl205-t2",type:"text",content:"Y",x:277.2,y:692.6,fontSize:10.9,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:71.3,lineHeight:1.2,rotation:0},
      {id:"sl205-t3",type:"text",content:"Amelia Yates\nJames Young\nEmma York",x:270.6,y:719.2,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.38,rotation:0},
      {id:"sl205-t4",type:"text",content:"W",x:267.1,y:557.0,fontSize:10.9,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:80.2,lineHeight:1.2,rotation:0},
      {id:"sl205-t5",type:"text",content:"Amelia Ward\nJames Watson\nSophia West\nDaniel White\nEmma Williams\nLucas Wilkins",x:269.4,y:576.9,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.38,rotation:0},
      {id:"sl205-t6",type:"text",content:"V",x:266.0,y:434.9,fontSize:10.9,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:80.2,lineHeight:1.2,rotation:0},
      {id:"sl205-t7",type:"text",content:"Olivia Vaughan\nHenry Vickers\nAmelia Vincent\nJames Vance\nSophia Vega",x:268.3,y:454.8,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.38,rotation:0},
      {id:"sl205-t8",type:"text",content:"U",x:265.9,y:306.6,fontSize:10.9,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:80.2,lineHeight:1.2,rotation:0},
      {id:"sl205-t9",type:"text",content:"Emma Underwood\nJames Upton\nSophie Ulrich\nDaniel Underhill\nCharlotte Urban",x:268.2,y:329.6,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.38,rotation:0},
      {id:"sl205-t10",type:"text",content:"T",x:160.1,y:859.3,fontSize:10.9,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:80.2,lineHeight:1.2,rotation:0},
      {id:"sl205-t11",type:"text",content:"William Taylor\nIsla Thompson\nJames Turner",x:162.4,y:878.0,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.38,rotation:0},
      {id:"sl205-t12",type:"text",content:"Q - S",x:159.0,y:718.0,fontSize:10.9,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:80.2,lineHeight:1.2,rotation:0},
      {id:"sl205-t13",type:"text",content:"Oliver Quinn\nEmma Quinn\nLucas Reid\nSophie Rogers\nDaniel Scott\nChloe Stevens",x:161.3,y:740.9,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.38,rotation:0},
      {id:"sl205-t14",type:"text",content:"P",x:157.9,y:580.6,fontSize:10.9,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:80.2,lineHeight:1.2,rotation:0},
      {id:"sl205-t15",type:"text",content:"Ella Parker\nThomas Price\nMia Phillips\nGeorge Porter\nSophie Palmer\nOlivia Parsons",x:160.2,y:600.4,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.38,rotation:0},
      {id:"sl205-t16",type:"text",content:"M - O",x:156.7,y:417.7,fontSize:10.9,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:80.2,lineHeight:1.2,rotation:0},
      {id:"sl205-t17",type:"text",content:"Olivia Martin\nHenry Mitchell\nAva Nelson\nJack Oliver\nEmily Morgan\nJacob O’Brien\nGrace Miller\nThomas Osborne",x:159.0,y:437.6,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.38,rotation:0},
      {id:"sl205-t18",type:"text",content:"J - L",x:156.7,y:306.6,fontSize:10.9,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:80.2,lineHeight:1.2,rotation:0},
      {id:"sl205-t19",type:"text",content:"Ethan Johnson\nAmelia James\nLucas Kone\nSophia Lee",x:159.0,y:326.5,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.38,rotation:0},
      {id:"sl205-t20",type:"text",content:"I",x:42.8,y:810.4,fontSize:10.9,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:80.2,lineHeight:1.2,rotation:0},
      {id:"sl205-t21",type:"text",content:"Jacob Ingram\nLily Irving\nDaniel Isaacs\nSophia Innes\nThomas Irwin\nEmma Ives\nBenjamin Ingram",x:45.1,y:830.9,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.38,rotation:0},
      {id:"sl205-t22",type:"text",content:"G - H",x:41.7,y:692.1,fontSize:10.9,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:80.2,lineHeight:1.2,rotation:0},
      {id:"sl205-t23",type:"text",content:"Samuel Grant\nIsabella Gray\nAlexander Hughes\nCharlotte Hayes",x:44.0,y:718.6,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.38,rotation:0},
      {id:"sl205-t24",type:"text",content:"D - F",x:40.5,y:556.4,fontSize:10.9,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:80.2,lineHeight:1.2,rotation:0},
      {id:"sl205-t25",type:"text",content:"Laura Dawson\nBenjamin Douglas\nChloe Edwards\nPatrick Evans\nGrace Foster \nNathan Fisher",x:42.8,y:576.3,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.38,rotation:0},
      {id:"sl205-t26",type:"text",content:"C",x:39.4,y:434.3,fontSize:10.9,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:80.2,lineHeight:1.2,rotation:0},
      {id:"sl205-t27",type:"text",content:"Daniel Carter\nHannah Collins\nMatthew Clarke\nPhil Clarke\nRoger Clarke",x:41.7,y:454.2,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.38,rotation:0},
      {id:"sl205-t28",type:"text",content:"A - B",x:39.3,y:312.2,fontSize:10.9,fontId:"mozart-light",italic:false,align:"center",color:"#000000",width:80.2,lineHeight:1.2,rotation:0},
      {id:"sl205-t29",type:"text",content:"Emily Andrews\nJames Baxter\nOlivia Bennett\nWilliam Archer\nSophia Barnes ",x:41.6,y:332.0,fontSize:9.1,fontId:"dubiel",italic:false,align:"center",color:"#000000",width:81.0,lineHeight:1.38,rotation:0},
      {id:"sl205-t30",type:"text",content:"e",x:300.7,y:159.7,fontSize:26.2,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:38.8,lineHeight:1.2,rotation:0},
      {id:"sl205-t31",type:"text",content:"First",x:74.0,y:129.5,fontSize:42.5,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:208.9,lineHeight:1.2,rotation:0},
      {id:"sl205-t32",type:"text",content:"then we",x:184.2,y:196.8,fontSize:26.2,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:92.8,lineHeight:1.2,rotation:0},
      {id:"sl205-t33",type:"text",content:"Dance",x:98.1,y:205.5,fontSize:46.4,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:172.2,lineHeight:1.2,rotation:0},
      {id:"sl205-t34",type:"text",content:"we din",x:207.1,y:163.0,fontSize:38.1,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:140.0,lineHeight:1.2,rotation:0}
    ]},
  { id:"sl206", collection:"swan-lake", name:"Option 1", category:"wedding-welcome", availableSizes:["1400x2000"], sizeKey:"1400x2000", background:"#FFFFFF", elements:[
      {id:"sl206-t0",type:"text",content:"WELCOME TO \nTHE WEDDING OF",x:59.3,y:85.2,fontSize:13.0,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:285.7,lineHeight:1.14,rotation:0},
      {id:"sl206-t1",type:"text",content:"&",x:120.2,y:237.7,fontSize:26.3,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:33.2,lineHeight:1.2,rotation:0},
      {id:"sl206-t2",type:"text",content:"<span style=\"font-feature-settings: &quot;ss02&quot;;\">s</span>",x:260.7,y:273.6,fontSize:27.1,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:23.6,lineHeight:1.2,rotation:0},
      {id:"sl206-t3",type:"text",content:"AME",x:217.9,y:284.4,fontSize:19.7,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:104.0,lineHeight:1.2,rotation:0},
      {id:"sl206-t4",type:"text",content:"ONIQUE",x:195.2,y:213.0,fontSize:19.7,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:68.2,lineHeight:1.2,rotation:0},
      {id:"sl206-t5",type:"text",content:"J",x:165.3,y:248.9,fontSize:38.6,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:70.1,lineHeight:1.2,rotation:0},
      {id:"sl206-t6",type:"text",content:"M",x:107.1,y:188.2,fontSize:38.6,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:90.8,lineHeight:1.2,rotation:0},
      {id:"sl206-t7",type:"text",content:"12 OCTOBER 2026",x:59.3,y:388.5,fontSize:13.0,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:285.7,lineHeight:1.2,rotation:0}
    ]},
  { id:"sl207", collection:"swan-lake", name:"Option 2", category:"wedding-welcome", availableSizes:["1400x2000"], sizeKey:"1400x2000", background:"#FFFFFF", elements:[
      {id:"sl207-t0",type:"text",content:"WELCOME TO",x:39.7,y:71.0,fontSize:14.5,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:320.3,lineHeight:1.2,rotation:0},
      {id:"sl207-t1",type:"text",content:"the",x:209.8,y:158.8,fontSize:29.5,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:120.7,lineHeight:1.2,rotation:0},
      {id:"sl207-t2",type:"text",content:"<span style=\"font-feature-settings: &quot;ss02&quot;;\">s</span>",x:283.7,y:205.0,fontSize:28.1,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:58.4,lineHeight:1.2,rotation:0},
      {id:"sl207-t3",type:"text",content:"wedding",x:184.4,y:239.3,fontSize:29.5,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:133.7,lineHeight:1.2,rotation:0},
      {id:"sl207-t4",type:"text",content:"ATTHEW",x:179.7,y:213.3,fontSize:26.2,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:108.5,lineHeight:1.2,rotation:0},
      {id:"sl207-t5",type:"text",content:"M",x:68.4,y:180.5,fontSize:51.3,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:120.7,lineHeight:1.2,rotation:0},
      {id:"sl207-t6",type:"text",content:"12 OCTOBER 2026",x:39.7,y:351.7,fontSize:14.5,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:320.3,lineHeight:1.2,rotation:0}
    ]},
  { id:"sl208", collection:"swan-lake", name:"Option 3", category:"wedding-welcome", availableSizes:["1400x2000"], sizeKey:"1400x2000", background:"#FFFFFF", elements:[
      {id:"sl208-aw0",type:"image",src:"/artwork/Double Swan copy.png?v=1783854787",fit:"fill",x:126.5,y:338.7,width:157.3,height:107.9,rotation:0},
      {id:"sl208-t0",type:"text",content:"12 October 2025",x:76.0,y:292.7,fontSize:13.0,fontId:"mozart-light",italic:false,align:"center",color:"#231f20",width:248.0,lineHeight:1.2,rotation:0},
      {id:"sl208-t1",type:"text",content:"WELCOME TO THE WEDDING OF",x:76.0,y:54.3,fontSize:9.4,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:248.0,lineHeight:1.2,rotation:0},
      {id:"sl208-t2",type:"text",content:"&",x:227.8,y:168.9,fontSize:25.6,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:38.2,lineHeight:1.2,rotation:0},
      {id:"sl208-t3",type:"text",content:"James",x:76.0,y:202.5,fontSize:36.2,fontId:"mozart-light",italic:false,align:"center",color:"#231f20",width:248.0,lineHeight:1.2,rotation:0},
      {id:"sl208-t4",type:"text",content:"Monique",x:76.0,y:114.0,fontSize:36.2,fontId:"mozart-light",italic:false,align:"center",color:"#231f20",width:248.0,lineHeight:1.2,rotation:0}
    ]},
  { id:"sl209", collection:"swan-lake", name:"Option 4", category:"wedding-welcome", availableSizes:["700x3000"], sizeKey:"700x3000", background:"#FFFFFF", elements:[
      {id:"sl209-aw0",type:"image",src:"/artwork/Double Swan copy.png?v=1783854787",fit:"fill",x:94.2,y:622.3,width:219.1,height:150.4,rotation:0},
      {id:"sl209-t0",type:"text",content:"12 October 2025",x:0.7,y:569.5,fontSize:20.2,fontId:"mozart-light",italic:false,align:"center",color:"#231f20",width:399.4,lineHeight:1.2,rotation:0},
      {id:"sl209-t1",type:"text",content:"WELCOME TO THE WEDDING OF",x:0.7,y:226.2,fontSize:16.1,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:399.4,lineHeight:1.2,rotation:0},
      {id:"sl209-t2",type:"text",content:"&",x:251.2,y:385.8,fontSize:36.9,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:53.2,lineHeight:1.2,rotation:0},
      {id:"sl209-t3",type:"text",content:"James",x:0.7,y:432.6,fontSize:56.4,fontId:"mozart-light",italic:false,align:"center",color:"#231f20",width:399.4,lineHeight:1.2,rotation:0},
      {id:"sl209-t4",type:"text",content:"Monique",x:0.7,y:309.4,fontSize:56.4,fontId:"mozart-light",italic:false,align:"center",color:"#231f20",width:399.4,lineHeight:1.2,rotation:0}
    ]},
  { id:"sl210", collection:"swan-lake", name:"Option 4", category:"wedding-welcome", availableSizes:["1400x2000"], sizeKey:"1400x2000", background:"#FFFFFF", elements:[
      {id:"sl210-r0",type:"image",src:"/raster/sl210-r0.png?v=1783854787",fit:"fill",x:0.0,y:0.0,width:399.9,height:571.4,rotation:0},
      {id:"sl210-t0",type:"text",content:"to our",x:83.2,y:104.0,fontSize:25.2,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:124.6,lineHeight:1.2,rotation:0},
      {id:"sl210-t1s0",type:"text",content:"W",x:74.0,y:72.4,fontSize:25.2,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:38.0,lineHeight:1.2,rotation:0},
      {id:"sl210-t1s1",type:"text",content:"elcome",x:114.5,y:71.2,fontSize:25.2,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:74.8,lineHeight:1.2,rotation:0},
      {id:"sl210-t2s0",type:"text",content:"F",x:92.3,y:138.6,fontSize:25.2,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:12.2,lineHeight:1.2,rotation:0},
      {id:"sl210-t2s1",type:"text",content:"oreve",x:107.0,y:137.3,fontSize:25.2,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:59.1,lineHeight:1.2,rotation:0},
      {id:"sl210-t2s2",type:"text",content:"<span style=\"font-feature-settings: &quot;ss08&quot;;\">r</span>",x:168.7,y:138.6,fontSize:25.2,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:30.7,lineHeight:1.2,rotation:0},
      {id:"sl210-t3",type:"text",content:"&",x:232.4,y:289.8,fontSize:87.4,fontId:"mozart-light",italic:false,align:"right",color:"#000000",width:117.8,lineHeight:1.2,rotation:0},
      {id:"sl210-t4",type:"text",content:"J",x:115.1,y:383.0,fontSize:126.6,fontId:"mozart-light",italic:false,align:"right",color:"#000000",width:235.7,lineHeight:1.2,rotation:0},
      {id:"sl210-t5",type:"text",content:"M",x:8.6,y:220.8,fontSize:123.0,fontId:"mozart-light",italic:false,align:"right",color:"#000000",width:265.2,lineHeight:1.2,rotation:0}
    ]},
  // ⟦generated-collection:swan-lake-signs-2 END⟧
  // ⟦generated-collection:swan-lake-signs-3 START⟧ — auto-managed by splice_templates.py, do not hand-edit
  { id:"sl300", collection:"swan-lake", name:"Option 1", category:"wedding-welcome", availableSizes:["1400x3000"], sizeKey:"1400x3000", background:"#FFFFFF", elements:[
      {id:"sl300-t0",type:"text",content:"WELCOME TO \nTHE WEDDING OF",x:59.3,y:93.9,fontSize:13.0,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:285.7,lineHeight:1.14,rotation:0},
      {id:"sl300-t1",type:"text",content:"&",x:120.2,y:246.4,fontSize:26.3,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:33.2,lineHeight:1.2,rotation:0},
      {id:"sl300-t2",type:"text",content:"<span style=\"font-feature-settings: &quot;ss02&quot;;\">s</span>",x:260.7,y:282.3,fontSize:27.1,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:23.6,lineHeight:1.2,rotation:0},
      {id:"sl300-t3",type:"text",content:"AME",x:217.9,y:293.1,fontSize:19.7,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:104.0,lineHeight:1.2,rotation:0},
      {id:"sl300-t4",type:"text",content:"ONIQUE",x:195.2,y:221.7,fontSize:19.7,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:68.2,lineHeight:1.2,rotation:0},
      {id:"sl300-t5",type:"text",content:"J",x:165.3,y:257.6,fontSize:38.6,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:70.1,lineHeight:1.2,rotation:0},
      {id:"sl300-t6",type:"text",content:"M",x:107.1,y:196.9,fontSize:38.6,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:90.8,lineHeight:1.2,rotation:0},
      {id:"sl300-t7",type:"text",content:"12 OCTOBER 2026",x:59.3,y:397.2,fontSize:13.0,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:285.7,lineHeight:1.2,rotation:0}
    ]},
  { id:"sl301", collection:"swan-lake", name:"Option 2", category:"wedding-welcome", availableSizes:["1400x3000"], sizeKey:"1400x3000", background:"#FFFFFF", elements:[
      {id:"sl301-t0",type:"text",content:"WELCOME TO",x:39.7,y:79.7,fontSize:14.5,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:320.3,lineHeight:1.2,rotation:0},
      {id:"sl301-t1",type:"text",content:"the",x:209.8,y:167.4,fontSize:29.5,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:120.7,lineHeight:1.2,rotation:0},
      {id:"sl301-t2",type:"text",content:"<span style=\"font-feature-settings: &quot;ss02&quot;;\">s</span>",x:283.7,y:213.7,fontSize:28.1,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:58.4,lineHeight:1.2,rotation:0},
      {id:"sl301-t3",type:"text",content:"wedding",x:184.4,y:248.0,fontSize:29.5,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:133.7,lineHeight:1.2,rotation:0},
      {id:"sl301-t4",type:"text",content:"ATTHEW",x:179.7,y:222.0,fontSize:26.2,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:108.5,lineHeight:1.2,rotation:0},
      {id:"sl301-t5",type:"text",content:"M",x:68.4,y:189.2,fontSize:51.3,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:120.7,lineHeight:1.2,rotation:0},
      {id:"sl301-t6",type:"text",content:"12 OCTOBER 2026",x:39.7,y:360.4,fontSize:14.5,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:320.3,lineHeight:1.2,rotation:0}
    ]},
  { id:"sl302", collection:"swan-lake", name:"Option 3", category:"wedding-welcome", availableSizes:["1400x3000"], sizeKey:"1400x3000", background:"#FFFFFF", elements:[
      {id:"sl302-aw0",type:"image",src:"/artwork/Double Swan copy.png?v=1783855866",fit:"fill",x:126.5,y:371.1,width:157.3,height:107.9,rotation:0},
      {id:"sl302-t0",type:"text",content:"12 October 2025",x:76.0,y:325.1,fontSize:13.0,fontId:"mozart-light",italic:false,align:"center",color:"#231f20",width:248.0,lineHeight:1.2,rotation:0},
      {id:"sl302-t1",type:"text",content:"WELCOME TO THE WEDDING OF",x:76.0,y:86.7,fontSize:9.4,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:248.0,lineHeight:1.2,rotation:0},
      {id:"sl302-t2",type:"text",content:"&",x:227.8,y:201.3,fontSize:25.6,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:38.2,lineHeight:1.2,rotation:0},
      {id:"sl302-t3",type:"text",content:"James",x:76.0,y:234.9,fontSize:36.2,fontId:"mozart-light",italic:false,align:"center",color:"#231f20",width:248.0,lineHeight:1.2,rotation:0},
      {id:"sl302-t4",type:"text",content:"Monique",x:76.0,y:146.5,fontSize:36.2,fontId:"mozart-light",italic:false,align:"center",color:"#231f20",width:248.0,lineHeight:1.2,rotation:0}
    ]},
  { id:"sl303", collection:"swan-lake", name:"Option 4", category:"wedding-welcome", availableSizes:["1400x3000"], sizeKey:"1400x3000", background:"#FFFFFF", elements:[
      {id:"sl303-r0",type:"image",src:"/raster/sl303-r0.png?v=1783855866",fit:"fill",x:0.0,y:0.0,width:399.9,height:857.1,rotation:0},
      {id:"sl303-t0",type:"text",content:"to our",x:44.2,y:213.3,fontSize:20.8,fontId:"dubiel",italic:false,align:"center",color:"#231f20",width:103.0,lineHeight:1.2,rotation:0},
      {id:"sl303-t1s0",type:"text",content:"W",x:36.6,y:187.1,fontSize:20.8,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:31.5,lineHeight:1.2,rotation:0},
      {id:"sl303-t1s1",type:"text",content:"elcome",x:70.1,y:186.1,fontSize:20.8,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:61.9,lineHeight:1.2,rotation:0},
      {id:"sl303-t2s0",type:"text",content:"F",x:51.7,y:241.9,fontSize:20.8,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:10.2,lineHeight:1.2,rotation:0},
      {id:"sl303-t2s1",type:"text",content:"oreve",x:63.9,y:240.8,fontSize:20.8,fontId:"dubiel",italic:false,align:"left",color:"#231f20",width:48.9,lineHeight:1.2,rotation:0},
      {id:"sl303-t2s2",type:"text",content:"<span style=\"font-feature-settings: &quot;ss08&quot;;\">r</span>",x:114.9,y:241.9,fontSize:20.8,fontId:"mozart-light",italic:false,align:"left",color:"#231f20",width:25.5,lineHeight:1.2,rotation:0},
      {id:"sl303-t3",type:"text",content:"&",x:223.7,y:100.2,fontSize:87.4,fontId:"mozart-light",italic:false,align:"right",color:"#000000",width:117.8,lineHeight:1.2,rotation:0},
      {id:"sl303-t4",type:"text",content:"J",x:106.5,y:193.4,fontSize:126.6,fontId:"mozart-light",italic:false,align:"right",color:"#000000",width:235.7,lineHeight:1.2,rotation:0},
      {id:"sl303-t5",type:"text",content:"M",x:14.6,y:31.2,fontSize:123.0,fontId:"mozart-light",italic:false,align:"right",color:"#000000",width:265.2,lineHeight:1.2,rotation:0}
    ]},
  // ⟦generated-collection:swan-lake-signs-3 END⟧
];

// ─── Default colour palette (nested — each row is one curated palette) ────────
const DEFAULT_PALETTE = [
  // On Ice — brown & blue
  ["#4E3324","#9EC3D6","#6E8FA3","#E6D6C6","#9C8B7A","#F2F2EE"],
  // Café Collection — nude
  ["#CFB3A9","#F1EEEB","#CDC6C3","#A09086","#E4D8CB"],
  // Matcha Aesthetic — dusty & earthy
  ["#DDD3C9","#ECC4C3","#B97D7B","#928E5E","#575527"],
  // Studio Vaia — warm & moody
  ["#C4BAB3","#741717","#8D695D","#603A30","#52130C"],
];

// ─── Linen texture ────────────────────────────────────────────────────────────
function LinenTexture({ opacity=0.18, uid="linen" }) {
  if (opacity <= 0) return null;
  const fid = "linen-" + uid;
  return (
    <svg style={{position:"absolute",inset:0,width:"100%",height:"100%",opacity,pointerEvents:"none"}} xmlns="http://www.w3.org/2000/svg">
      <filter id={fid}>
        <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="4" stitchTiles="stitch"/>
        <feColorMatrix type="saturate" values="0"/>
        <feBlend in="SourceGraphic" mode="multiply"/>
      </filter>
      <rect width="100%" height="100%" filter={`url(#${fid})`}/>
    </svg>
  );
}

// ─── Snap guides ──────────────────────────────────────────────────────────────
function SnapGuides({ guideX, guideY, guideXKind, guideYKind, cw, ch }) {
  if (guideX === null && guideY === null) return null;
  // Canvas-centre snaps render bright pink; element-to-element snaps render purple.
  const colorX = guideXKind === "canvas" ? "#E91E63" : "#6A4FB6";
  const colorY = guideYKind === "canvas" ? "#E91E63" : "#6A4FB6";
  return (
    <svg style={{position:"absolute",inset:0,width:cw,height:ch,pointerEvents:"none",zIndex:99}} viewBox={`0 0 ${cw} ${ch}`}>
      {guideX !== null && <line x1={guideX} y1={0} x2={guideX} y2={ch} stroke={colorX} strokeWidth="1.2" strokeDasharray="5,3" opacity="0.95"/>}
      {guideY !== null && <line x1={0} y1={guideY} x2={cw} y2={guideY} stroke={colorY} strokeWidth="1.2" strokeDasharray="5,3" opacity="0.95"/>}
    </svg>
  );
}

// ─── Handles ──────────────────────────────────────────────────────────────────
function RotationHandle({ onMouseDown }) {
  return (
    <div onMouseDown={onMouseDown} title="Drag to rotate"
      style={{position:"absolute",bottom:-30,left:"50%",transform:"translateX(-50%)",
        width:18,height:18,borderRadius:"50%",background:"#fff",
        border:"1.5px solid rgba(58,48,40,0.85)",
        cursor:"crosshair",zIndex:21,display:"flex",alignItems:"center",justifyContent:"center",
        boxSizing:"border-box",boxShadow:"0 1px 3px rgba(0,0,0,0.18)"}}>
      <span style={{fontSize:11,color:"rgba(58,48,40,0.85)",lineHeight:1,userSelect:"none"}}>↻</span>
    </div>
  );
}

// Double-headed diagonal arrow — reads instantly as "drag to resize"
function ResizeArrowIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 9 9" style={{pointerEvents:"none"}}>
      <path d="M2 7 L7 2 M7 2 H4.4 M7 2 V4.6 M2 7 H4.6 M2 7 V4.4"
        stroke="rgba(58,48,40,0.9)" strokeWidth="1.2" fill="none"
        strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function ResizeHandle({ onMouseDown }) {
  return (
    <div onMouseDown={onMouseDown} title="Drag to resize"
      style={{position:"absolute",top:-7,right:-7,width:16,height:16,
        background:"#fff",borderRadius:2,cursor:"nesw-resize",zIndex:20,
        border:"1.5px solid rgba(58,48,40,0.85)",boxSizing:"border-box",
        boxShadow:"0 1px 3px rgba(0,0,0,0.18)",
        display:"flex",alignItems:"center",justifyContent:"center"}}>
      <ResizeArrowIcon/>
    </div>
  );
}

// ─── Curved text (SVG textPath along a circular arc) ─────────────────────────
// The bend is defined by how far the TEXT ITSELF wraps around a circle:
// 180° = a full semicircle, regardless of the text box width. The radius is
// derived from the measured text length, and the SVG is sized tightly to the
// arc so the bounding box hugs the visible text.
function CurvedText({ el, font }) {
  const fs = el.fontSize || 22;
  const text = (el.content || "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  const measureRef = useRef(null);
  const [measured, setMeasured] = useState(0);
  useEffect(() => {
    const m = () => { try { setMeasured(measureRef.current?.getComputedTextLength() || 0); } catch {} };
    m();
    document.fonts?.ready?.then(m);   // re-measure once webfonts finish loading
  }, [text, fs, el.letterSpacing, font.family, el.italic]);

  const L = measured || text.length * fs * 0.55;          // path length of text
  const A = Math.min(355, Math.abs(el.curve)) * Math.PI / 180;
  const up = el.curve > 0;
  const R = Math.max(L / A, fs);                          // radius from text length
  const h2 = A / 2;
  const halfW = R * Math.sin(Math.min(h2, Math.PI / 2)); // widest extent of the arc
  const pad = fs * 1.25;
  const cx = halfW + pad;
  const endsDrop = R - R * Math.cos(h2);                 // endpoint depth below apex
  const svgW = 2 * halfW + 2 * pad;
  const svgH = endsDrop + 2 * pad;
  // circle centre: apex sits at y=pad (up) or bottom (down)
  const cy = up ? R + pad : (svgH - pad) - R;
  const sy = up ? 1 : -1;                                // vertical mirror for bow-down
  const p1x = cx - R * Math.sin(h2), p2x = cx + R * Math.sin(h2);
  const py  = cy - sy * R * Math.cos(h2);
  const d = `M ${p1x} ${py} A ${R} ${R} 0 ${A > Math.PI ? 1 : 0} ${up ? 1 : 0} ${p2x} ${py}`;
  const pathId = "curvepath-" + el.id;
  const textStyle = {fontFamily:font.family,fontSize:fs,fill:el.color,
    letterSpacing:el.letterSpacing?`${el.letterSpacing}px`:undefined,
    fontStyle:el.italic?"italic":"normal"};
  return (
    <svg width={svgW} height={svgH} viewBox={`0 0 ${svgW} ${svgH}`}
      style={{display:"block",overflow:"visible",opacity:el.opacity ?? 1}}>
      <defs><path id={pathId} d={d} fill="none"/></defs>
      {/* invisible straight copy used to measure the text's real length */}
      <text ref={measureRef} x="0" y="-9999" visibility="hidden" style={textStyle}>{text}</text>
      <text style={textStyle}>
        <textPath href={`#${pathId}`} startOffset="50%" textAnchor="middle">{text}</textPath>
      </text>
    </svg>
  );
}

// ─── Compact font dropdown ────────────────────────────────────────────────────
function FontDropdown({ value, onChange, onUpload }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);
  const fonts = getAllFonts();
  const current = fonts.find(f => f.id === value) || fonts[0];
  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div ref={boxRef} style={{position:"relative",marginBottom:8}}>
      <div style={{fontSize:10,letterSpacing:2,color:"#9A8F85",marginBottom:2}}>FONT</div>
      <button onClick={() => setOpen(o => !o)}
        style={{width:"100%",textAlign:"left",padding:"8px 12px",borderRadius:8,
          border:"1px solid rgba(180,165,150,0.45)",background:"rgba(255,255,255,0.85)",
          cursor:"pointer",fontFamily:current.family,fontSize:15,color:"#3A3028",
          display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{current.label}</span>
        <span style={{fontSize:9,color:"#9A8F85",fontFamily:"Georgia,serif",flexShrink:0,marginLeft:8}}>▼</span>
      </button>
      {open && (
        <div style={{position:"absolute",top:"100%",left:0,right:0,zIndex:300,marginTop:4,
          background:"#FDFBF8",border:"1px solid rgba(180,165,150,0.45)",borderRadius:10,
          boxShadow:"0 12px 40px rgba(0,0,0,0.16)",maxHeight:280,overflowY:"auto",padding:4}}>
          {fonts.map(f => (
            <button key={f.id} onClick={() => { onChange(f.id); setOpen(false); }}
              style={{width:"100%",textAlign:"left",padding:"7px 10px",borderRadius:6,border:"none",
                background:value===f.id?"rgba(138,123,108,0.15)":"transparent",
                cursor:"pointer",fontFamily:f.family,fontSize:15,color:"#3A3028",
                display:"flex",alignItems:"center",gap:6}}
              onMouseEnter={e => { if (value!==f.id) e.currentTarget.style.background="rgba(138,123,108,0.08)"; }}
              onMouseLeave={e => { if (value!==f.id) e.currentTarget.style.background="transparent"; }}>
              {f.id.startsWith("custom-") && (
                <span style={{fontSize:8,background:"rgba(138,123,108,0.2)",color:"#6B5E52",
                  padding:"1px 5px",borderRadius:3,letterSpacing:1,flexShrink:0,fontFamily:"Georgia,serif"}}>CUSTOM</span>
              )}
              {f.label}
            </button>
          ))}
          <button onClick={() => { setOpen(false); onUpload?.(); }}
            style={{width:"100%",textAlign:"left",padding:"7px 10px",borderRadius:6,
              border:"1px dashed rgba(138,123,108,0.4)",background:"transparent",
              cursor:"pointer",fontSize:11,color:"#8A7B6C",fontFamily:"Georgia,serif",
              letterSpacing:0.5,marginTop:4,boxSizing:"border-box"}}>
            + Upload your own font
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Colour picker ────────────────────────────────────────────────────────────
function ColourPicker({ value, onChange, palette, onAddToPalette }) {
  const [draft, setDraft] = useState(value || "#3A3028");
  const prevValue = useRef(value);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (prevValue.current !== value && /^#[0-9A-Fa-f]{6}$/.test(value || "")) {
      setDraft(value);
    }
    prevValue.current = value;
  }, [value]);

  const handleSave = () => {
    if (!/^#[0-9A-Fa-f]{6}$/.test(draft.trim())) return;
    onAddToPalette(draft.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div style={{marginBottom:18}}>
      <div style={{fontSize:10,letterSpacing:2,color:"#9A8F85",marginBottom:8}}>COLOUR</div>
      <div style={{display:"flex",flexDirection:"column",gap:5,marginBottom:10}}>
        {palette.map((row, ri) => (
          <div key={ri} style={{display:"flex",gap:7}}>
            {row.map((hex, i) => (
              <button key={i} onClick={() => { onChange(hex); setDraft(hex); }} title={hex}
                style={{width:26,height:26,borderRadius:"50%",border:"none",background:hex,cursor:"pointer",flexShrink:0,
                  boxShadow:value===hex?"0 0 0 2px #fff,0 0 0 3.5px #8A7B6C":"0 1px 4px rgba(0,0,0,0.18)",
                  transform:value===hex?"scale(1.15)":"scale(1)",transition:"all 0.15s"}}/>
            ))}
          </div>
        ))}
      </div>
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        <label style={{position:"relative",cursor:"pointer",flexShrink:0}}>
          <div style={{width:32,height:32,borderRadius:6,background:draft,border:"1px solid rgba(138,123,108,0.4)",boxShadow:"0 1px 4px rgba(0,0,0,0.12)"}}/>
          <input type="color" value={/^#[0-9A-Fa-f]{6}$/.test(draft) ? draft : "#3A3028"}
            onChange={e => { setDraft(e.target.value); onChange(e.target.value); prevValue.current = e.target.value; }}
            style={{opacity:0,position:"absolute",inset:0,width:"100%",height:"100%",cursor:"pointer"}}/>
        </label>
        <input value={draft} maxLength={7}
          onChange={e => { setDraft(e.target.value); if (/^#[0-9A-Fa-f]{6}$/.test(e.target.value)) onChange(e.target.value); }}
          style={{flex:1,padding:"5px 8px",fontSize:11,fontFamily:"monospace",
            border:"1px solid rgba(180,165,150,0.4)",borderRadius:6,
            background:"rgba(255,255,255,0.7)",color:"#3A3028",outline:"none"}}/>
        <button onClick={handleSave}
          style={{padding:"5px 10px",fontSize:10,letterSpacing:1,flexShrink:0,
            border:"1px solid rgba(138,123,108,0.4)",borderRadius:6,
            background:saved?"rgba(74,103,65,0.15)":"transparent",
            cursor:"pointer",color:saved?"#4A6741":"#6B5E52",fontFamily:"Georgia,serif",
            transition:"all 0.2s",whiteSpace:"nowrap"}}>
          {saved ? "✓ Saved" : "+ Save"}
        </button>
      </div>
    </div>
  );
}

// ─── Background colour picker ─────────────────────────────────────────────────
function BgColourPicker({ value, onChange, onSaveToPalette }) {
  const [draft, setDraft] = useState(value || "#F2EDE4");
  const [saved, setSaved] = useState(false);
  const lastExt = useRef(value);

  useEffect(() => {
    if (value !== lastExt.current) { setDraft(value); lastExt.current = value; }
  }, [value]);

  const handleSave = () => {
    if (!/^#[0-9A-Fa-f]{6}$/.test(draft.trim())) return;
    onSaveToPalette(draft.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div style={{display:"flex",alignItems:"center",gap:8}}>
      <label style={{position:"relative",cursor:"pointer",flexShrink:0}}>
        <div style={{width:32,height:32,borderRadius:6,background:draft,border:"1px solid rgba(138,123,108,0.4)",boxShadow:"0 1px 4px rgba(0,0,0,0.12)"}}/>
        <input type="color" value={/^#[0-9A-Fa-f]{6}$/.test(draft) ? draft : "#F2EDE4"}
          onChange={e => { setDraft(e.target.value); lastExt.current = e.target.value; onChange(e.target.value); }}
          style={{opacity:0,position:"absolute",inset:0,width:"100%",height:"100%",cursor:"pointer"}}/>
      </label>
      <input value={draft} maxLength={7}
        onChange={e => { setDraft(e.target.value); if (/^#[0-9A-Fa-f]{6}$/.test(e.target.value)) { lastExt.current = e.target.value; onChange(e.target.value); } }}
        style={{flex:1,padding:"5px 8px",fontSize:11,fontFamily:"monospace",
          border:"1px solid rgba(180,165,150,0.4)",borderRadius:6,
          background:"rgba(255,255,255,0.7)",color:"#3A3028",outline:"none"}}/>
      <button onClick={handleSave}
        style={{padding:"5px 8px",fontSize:10,flexShrink:0,whiteSpace:"nowrap",
          border:"1px solid rgba(138,123,108,0.4)",borderRadius:6,
          background:saved?"rgba(74,103,65,0.15)":"transparent",
          cursor:"pointer",color:saved?"#4A6741":"#6B5E52",fontFamily:"Georgia,serif",transition:"all 0.2s"}}>
        {saved ? "✓ Saved" : "+ Save"}
      </button>
    </div>
  );
}

// While a glyph alternate is being applied, selection reports are suppressed so
// the programmatic selection restore doesn't re-open / re-snapshot the picker.
let _glyphApplyGuard = 0;

// ─── Glyph alternate picker popup ───────────────────────────────────────────────
// Measures every feature variant off-screen and only shows the ones that actually
// produce a different glyph for the selected text — clicking a box that looked
// identical and "did nothing" was the old behaviour's biggest annoyance.
function GlyphAltPopup({ font, text, x, y, features, onPick }) {
  const [distinct, setDistinct] = useState(null); // null = measuring
  useEffect(() => {
    let alive = true;
    // Preferred path: exact alternates from the font's own GSUB table
    // (font-alternates.json, generated at build time). Guarantees the SAME
    // set Illustrator shows — nothing missing, no duplicate boxes.
    const base = font.file ? font.file.split("?")[0].split("/").pop() : null;
    const exact = _fontAltMap && base && _fontAltMap[base] && text.length === 1
      ? _fontAltMap[base][text]
      : null;
    let candidates;
    if (exact) {
      candidates = exact.map((css, i) => ({ css, tip: `Alternate ${i + 1}` }));
    } else {
      // Fallback (uploaded fonts / multi-char selections): enumerate candidates;
      // duplicates are pruned by measurement below. Features like aalt/swsh/salt
      // hold MULTIPLE alternates per glyph, selected by index.
      const INDEXED = { aalt: 24, swsh: 8, salt: 8 };
      candidates = [];
      for (const f of features) {
        if (INDEXED[f.tag]) {
          for (let n = 1; n <= INDEXED[f.tag]; n++)
            candidates.push({ css: `"${f.tag}" ${n}`, tip: `${f.tip} ${n}` });
        } else {
          candidates.push({ css: `"${f.tag}" 1`, tip: f.tip });
        }
      }
    }
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;left:-99999px;top:0;visibility:hidden;font-size:100px;white-space:pre;";
    host.style.fontFamily = font.family;
    document.body.appendChild(host);
    const mk = (css) => {
      const s = document.createElement("span");
      s.style.display = "inline-block";
      if (css) s.style.fontFeatureSettings = css;
      s.textContent = text;
      host.appendChild(s);
      return s;
    };
    const orig = mk(null);
    const spans = candidates.map(c => [c, mk(c.css)]);
    document.fonts.ready.then(() => {
      if (!alive) { host.remove(); return; }
      // em = advance width relative to font size, used to scale big swash
      // variants DOWN so they fit their preview box instead of being cropped.
      const em = (s) => s.getBoundingClientRect().width / 100;
      const key = (s) => { const r = s.getBoundingClientRect(); return `${Math.round(r.width*8)}:${Math.round(r.height*8)}`; };
      const origEm = em(orig);
      let out;
      if (exact) {
        out = spans.map(([c, s]) => ({ ...c, em: em(s) }));
      } else {
        const seen = new Set([key(orig)]);
        out = [];
        for (const [c, s] of spans) {
          const k = key(s);
          if (!seen.has(k)) { seen.add(k); out.push({ ...c, em: em(s) }); }
        }
      }
      host.remove();
      setDistinct({ origEm, items: out });
    });
    return () => { alive = false; host.remove(); };
  }, [font.family, text, features.map(f => f.tag).join()]); // eslint-disable-line react-hooks/exhaustive-deps

  if (distinct !== null && distinct.items.length === 0) return null; // no real alternates
  const cell = 74, cols = 5;
  const popupW = cols * (cell + 6) + 24;
  const left = Math.min(Math.max(8, x - 12), window.innerWidth - popupW - 8);
  const top  = y + 10;
  const box = (css, tip, isOrig, em) => {
    // Scale so the glyph's full advance (swash included) fits the box.
    const fs = Math.max(11, Math.min(30, Math.floor((cell - 14) / Math.max(em || 0.6, 0.6))));
    return (
      <button key={css || "orig"} onMouseDown={e => e.preventDefault()} onClick={() => onPick(css)} title={tip}
        style={{width:cell,height:cell,borderRadius:8,cursor:"pointer",
          border:isOrig ? "2px solid rgba(138,123,108,0.7)" : "1px solid rgba(180,165,150,0.35)",
          background:isOrig ? "rgba(138,123,108,0.1)" : "#fff",
          display:"flex",alignItems:"center",justifyContent:"center",
          fontSize:fs,lineHeight:1,fontFamily:font.family,color:"#1A1610",
          overflow:"hidden",flexShrink:0,
        }}>
        <span style={{fontFeatureSettings: css || "normal",whiteSpace:"pre"}}>{text}</span>
      </button>
    );
  };
  return (
    <div
      onMouseDown={e => e.preventDefault()} // keep focus in contentEditable
      style={{
        position:"fixed", left, top, zIndex:3000, width:popupW,
        maxHeight:340, overflowY:"auto",
        background:"rgba(252,249,245,0.98)",
        border:"1px solid rgba(180,165,150,0.45)",
        borderRadius:10, padding:12,
        boxShadow:"0 12px 40px rgba(0,0,0,0.18)",
        fontFamily:"Georgia,serif",
      }}>
      <div style={{fontSize:9,letterSpacing:2,color:"#9A8F85",marginBottom:10,fontFamily:"Georgia,serif"}}>
        ALTERNATES FOR &ldquo;{text}&rdquo;
      </div>
      {distinct === null ? (
        <div style={{fontSize:10,color:"#B0A496",padding:"10px 0"}}>Loading alternates…</div>
      ) : (
        <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
          {box(null, "Original", true, distinct.origEm)}
          {distinct.items.map(({ css, tip, em }) => box(css, tip, false, em))}
        </div>
      )}
      <div style={{fontSize:9,color:"#B0A496",marginTop:9,lineHeight:1.5}}>
        Tap any alternate to replace your selection · first box = original
      </div>
    </div>
  );
}

// ─── Numeric stepper row (was a slider — Kate prefers up/down arrows) ──────────
function SliderRow({ label, value, min, max, step=1, format, onChange }) {
  const [draft, setDraft] = useState(null); // string while the user is typing
  const clamp = v => Math.min(max, Math.max(min, v));
  const bump  = dir => onChange(clamp(parseFloat(((parseFloat(value) || 0) + dir * step).toFixed(3))));
  const commitDraft = () => {
    if (draft !== null) {
      const v = parseFloat(draft);
      if (!isNaN(v)) onChange(clamp(parseFloat(v.toFixed(3))));
    }
    setDraft(null);
  };
  const arrowBtn = (glyph, dir, disabled) => (
    <button onMouseDown={e => e.preventDefault()} onClick={() => !disabled && bump(dir)}
      tabIndex={-1}
      style={{border:"none",background:"none",cursor:disabled?"default":"pointer",padding:"0 6px",
        height:13,lineHeight:"11px",fontSize:8,color:disabled?"#D8CFC4":"#6B5E52",display:"block"}}>
      {glyph}
    </button>
  );
  return (
    <div style={{marginBottom:8,display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
      <div style={{fontSize:10,letterSpacing:2,color:"#9A8F85",whiteSpace:"nowrap"}}>
        {label}{format ? <span style={{letterSpacing:0.5,color:"#B9AD9F"}}> — {format(value)}</span> : null}
      </div>
      <div style={{display:"flex",alignItems:"center",flexShrink:0,
        border:"1px solid rgba(180,165,150,0.5)",borderRadius:6,background:"#FFFDFA"}}>
        <input
          value={draft ?? (Math.round((parseFloat(value) || 0) * 100) / 100)}
          onChange={e => setDraft(e.target.value)}
          onBlur={commitDraft}
          onKeyDown={e => {
            if (e.key === "Enter") { commitDraft(); e.currentTarget.blur(); }
            else if (e.key === "ArrowUp")   { e.preventDefault(); commitDraft(); bump(1); }
            else if (e.key === "ArrowDown") { e.preventDefault(); commitDraft(); bump(-1); }
            e.stopPropagation();
          }}
          style={{width:46,border:"none",background:"none",outline:"none",textAlign:"center",
            fontSize:11.5,color:"#3A3028",fontFamily:"Georgia,serif",padding:"4px 0"}}/>
        <div style={{display:"flex",flexDirection:"column",borderLeft:"1px solid rgba(180,165,150,0.35)"}}>
          {arrowBtn("▲", 1,  value >= max)}
          {arrowBtn("▼", -1, value <= min)}
        </div>
      </div>
    </div>
  );
}

// ─── Text scale handle (drag right edge to resize font proportionally) ─────────
function TextScaleHandle({ el, onChange, onCommit, scale }) {
  const handleMouseDown = (e) => {
    e.stopPropagation(); e.preventDefault();
    const startX  = e.clientX;
    const startY  = e.clientY;
    const startW  = el.width || 340;
    const startFs = el.fontSize || 22;
    const startXPos = el.x;
    // Rendered text width (layout px = canvas units; unaffected by transforms).
    // Needed to keep the VISIBLE text anchored to its top-left corner while
    // resizing: centre/right-aligned text re-positions inside its container
    // as the container grows, so we compensate x by the alignment offset.
    const wrapper = e.currentTarget.closest("[data-bbox-id]");
    const tW0 = wrapper ? wrapper.offsetWidth : startW;
    const k = (el.align === "right") ? 1 : (el.align === "left") ? 0 : 0.5;
    const off0 = Math.max(0, (startW - tW0) * k);
    const move = (ev) => {
      // Use the larger of horizontal/vertical drag so the diagonal corner
      // handle feels natural in either direction.
      const dx = (ev.clientX - startX) / scale;
      const dy = (ev.clientY - startY) / scale;
      const delta = Math.abs(dx) > Math.abs(dy) ? dx : dy;
      const nw    = Math.max(30, startW + delta);
      // Font size scales proportionally with box width
      const ratio = nw / startW;
      const nfs   = Math.max(6, Math.round(startFs * ratio));
      onChange({ width: Math.round(nw), fontSize: nfs,
                 x: Math.round((startXPos + off0 * (1 - ratio)) * 10) / 10 });
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      onCommit();
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };
  return (
    <div onMouseDown={handleMouseDown} title="Drag to resize text"
      style={{position:"absolute",top:-7,right:-7,width:16,height:16,
        background:"#fff",borderRadius:2,cursor:"nesw-resize",zIndex:22,
        border:"1.5px solid rgba(58,48,40,0.85)",boxSizing:"border-box",
        boxShadow:"0 1px 3px rgba(0,0,0,0.18)",
        display:"flex",alignItems:"center",justifyContent:"center"}}>
      <ResizeArrowIcon/>
    </div>
  );
}

// ─── Canvas element ───────────────────────────────────────────────────────────
function CanvasElement({ el, selected, multiSelect, onSelect, onAddToSelection, onChange, onSnap, onSnapEnd, onCommit, onMultiDragStart, onContextMenu, scale, onEditStart, onEditEnd, onEditSelect }) {
  const handleContextMenu = (e) => {
    if (!onContextMenu) return;
    e.preventDefault(); e.stopPropagation();
    onContextMenu(el.id, e.clientX, e.clientY);
  };
  const [dragging, setDragging] = useState(false);
  const [editing,  setEditing]  = useState(false);
  const dragStart = useRef(null);
  const textRef   = useRef(null);
  const font = getAllFonts().find(f => f.id === el.fontId) || FONTS[0];
  const lh   = el.lineHeight || 1.35;
  const rot  = el.rotation || 0;

  useEffect(() => {
    if (editing && textRef.current) {
      // Restore content — switching away from dangerouslySetInnerHTML clears the div.
      // Use innerHTML so styled spans (per-character OT features) survive round-trips.
      textRef.current.innerHTML = el.content.includes("<")
        ? el.content
        : el.content.replace(/\n/g, "<br>");
      textRef.current.focus();
      // Place cursor at end
      const range = document.createRange();
      const sel = window.getSelection();
      range.selectNodeContents(textRef.current);
      range.collapse(false);
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  // While editing, also watch document-level selectionchange. Relying on the
  // div's own mouseup/keyup misses selections whose mouse-release lands OUTSIDE
  // the element (easy with single-letter monogram elements, and how Firefox
  // users typically drag-select) — the picker then never appears. Debounced so
  // it fires once the selection settles; the picker's own onMouseDown
  // preventDefault keeps picker clicks from collapsing the selection first.
  useEffect(() => {
    if (!editing) return;
    let t = null;
    const onSelChange = () => {
      clearTimeout(t);
      t = setTimeout(() => reportEditSelection(), 120);
    };
    document.addEventListener("selectionchange", onSelChange);
    return () => { clearTimeout(t); document.removeEventListener("selectionchange", onSelChange); };
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  // Called on mouseup/keyup inside the contenteditable — reports current selection
  // to the parent so it can show the glyph picker.  Runs AFTER the browser has
  // settled the selection, avoiding the selectionchange-on-picker-click race.
  const reportEditSelection = () => {
    if (!textRef.current) return;
    if (Date.now() < _glyphApplyGuard) return; // mid-apply — don't disturb the picker

    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.rangeCount > 0 && textRef.current.contains(sel.anchorNode)) {
      try {
        const rect = sel.getRangeAt(0).getBoundingClientRect();
        const text = sel.toString().trim();
        if (text) { onEditSelect?.({ x: rect.left, y: rect.bottom, text }); return; }
      } catch { /* ignored */ }
    }
    onEditSelect?.(null);
  };

  const handleMouseDown = (e) => {
    if (editing) return;
    e.stopPropagation(); e.preventDefault();
    onSelect(el.id, e.shiftKey); // pass shift key for additive selection
    if (el.locked) return; // locked: select-only, no drag/resize
    dragStart.current = { mx:e.clientX, my:e.clientY, ex:el.x, ey:el.y, moved:false, openEdit: el.type === "text" && !e.shiftKey };
    setDragging(true);
  };

  useEffect(() => {
    if (!dragging) return;
    const move = (e) => {
      if (Math.abs(e.clientX - dragStart.current.mx) > 4 || Math.abs(e.clientY - dragStart.current.my) > 4) {
        dragStart.current.moved = true;
        dragStart.current.openEdit = false;
      }
      if (!dragStart.current.moved) return;
      const dx = (e.clientX - dragStart.current.mx) / scale;
      const dy = (e.clientY - dragStart.current.my) / scale;
      const { startPositions } = dragStart.current;
      if (startPositions && startPositions.length > 1) {
        // Multi-drag: move all selected elements using their snapshotted start positions
        const rawX = dragStart.current.ex + dx;
        const rawY = dragStart.current.ey + dy;
        const w = el.width || 100, h = el.height || el.fontSize || 20;
        const snapped = onSnap(rawX, rawY, w, h, el.id);
        const snapDx = snapped.x - dragStart.current.ex;
        const snapDy = snapped.y - dragStart.current.ey;
        onChange({ multiDrag: true, startPositions, dx: snapDx, dy: snapDy });
      } else {
        const rawX = dragStart.current.ex + dx, rawY = dragStart.current.ey + dy;
        const w = el.width || 100, h = el.height || el.fontSize || 20;
        const snapped = onSnap(rawX, rawY, w, h, el.id);
        onChange({ x: snapped.x, y: snapped.y });
      }
    };
    const up = () => {
      setDragging(false); onSnapEnd(); onCommit();
      if (dragStart.current?.openEdit && !dragStart.current?.moved) { setEditing(true); onEditStart?.(el.id); }
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
  }, [dragging, scale, onChange, onSnap, onSnapEnd, onCommit, el]);

  const handleResizeMouseDown = (e) => {
    e.stopPropagation(); e.preventDefault();
    const startX = e.clientX, startW = el.width;
    const ratio = (el.height || el.width) / el.width;
    const move = (ev) => { const dw = (ev.clientX - startX) / scale; onChange({ width: Math.max(30, startW + dw), height: Math.max(30, startW + dw) * ratio }); };
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); onCommit(); };
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
  };

  const handleRotateMouseDown = (e) => {
    e.stopPropagation(); e.preventDefault();
    // Use the actual on-screen bounding rect of the visible element so the
    // rotation pivot always matches the centre the CSS transform-origin
    // rotates around — works for any width / text alignment.
    const visibleEl = e.currentTarget.parentElement;
    const r = visibleEl.getBoundingClientRect();
    const cx = r.left + r.width  / 2;
    const cy = r.top  + r.height / 2;
    const startAngle = Math.atan2(e.clientY - cy, e.clientX - cx) * 180 / Math.PI;
    const startRot = rot;
    const move = (ev) => {
      const angle = Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180 / Math.PI;
      let delta = angle - startAngle + startRot;
      const snaps = [0, 45, 90, 135, 180, -135, -90, -45];
      for (const s of snaps) { if (Math.abs(((delta % 360) + 360) % 360 - ((s + 360) % 360)) < 4) { delta = s; break; } }
      onChange({ rotation: Math.round(delta) });
    };
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); onCommit(); };
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
  };

  const sel  = { outline: selected ? "1.5px dashed rgba(138,123,108,0.75)" : "none", outlineOffset: 3 };
  const grab = { cursor: dragging ? "grabbing" : "grab", userSelect: "none" };
  const rotStyle = rot ? { transform: `rotate(${rot}deg)`, transformOrigin: "center center" } : {};

  const otFeatures = el.openType || [];
  const textStyle = {
    opacity: el.opacity ?? 1,
    fontFamily: font.family, fontSize: el.fontSize, color: el.color,
    textAlign: el.align || "center", fontStyle: el.italic ? "italic" : "normal",
    letterSpacing: el.letterSpacing ? `${el.letterSpacing}px` : undefined,
    lineHeight: lh,
    WebkitTextStrokeWidth: el.strokeWidth ? `${el.strokeWidth}px` : undefined,
    WebkitTextStrokeColor: el.strokeWidth ? (el.strokeColor || el.color) : undefined,
    paintOrder: "stroke fill",
    fontFeatureSettings: otFeatures.length ? otFeatures.map(f => `"${f}" 1`).join(", ") : undefined,
  };

  if (el.type === "divider") return (
    <div onMouseDown={handleMouseDown} onClick={e => { e.stopPropagation(); onSelect(el.id); }} onContextMenu={handleContextMenu}
      data-bbox-id={el.id}
      style={{position:"absolute",left:el.x,top:el.y,width:el.width,padding:"8px 0",...sel,cursor:"move",...rotStyle}}>
      <div style={{height:1,background:"rgba(90,74,60,0.25)"}}/>
    </div>
  );

  if (el.type === "image") return (
    <div onMouseDown={handleMouseDown} onClick={e => { e.stopPropagation(); onSelect(el.id); }} onContextMenu={handleContextMenu}
      data-bbox-id={el.id}
      style={{position:"absolute",left:el.x,top:el.y,width:el.width,height:el.height,...sel,...grab,...rotStyle}}>
      <img src={el.src} alt="" draggable={false}
        style={{width:"100%",height:"100%",objectFit:el.fit || "contain",borderRadius:2,display:"block",pointerEvents:"none",opacity:el.opacity ?? 1}}/>
      {selected && !multiSelect && !el.locked && <><RotationHandle onMouseDown={handleRotateMouseDown}/><ResizeHandle onMouseDown={handleResizeMouseDown}/></>}
    </div>
  );

  if (el.type === "illustration") return (
    <div onMouseDown={handleMouseDown} onClick={e => { e.stopPropagation(); onSelect(el.id); }} onContextMenu={handleContextMenu}
      data-bbox-id={el.id}
      style={{position:"absolute",left:el.x,top:el.y,width:el.width,height:el.height,...sel,...grab,...rotStyle,
        display:"flex",alignItems:"center",justifyContent:"center",opacity:el.opacity ?? 1}}>
      {el.illustrationSrc
        ? <CustomIllustration src={el.illustrationSrc} width={el.width} height={el.height} color={el.color || "#9A8F85"} stretch={!!el.stretch}/>
        : <IllustrationThumb type={el.illustrationId} size={Math.min(el.width, el.height)} color={el.color || "#9A8F85"}/>
      }
      {selected && !multiSelect && !el.locked && <><RotationHandle onMouseDown={handleRotateMouseDown}/><ResizeHandle onMouseDown={handleResizeMouseDown}/></>}
    </div>
  );

  // TEXT — contentEditable so editing looks identical to display, no size jump
  const handleContentKeyDown = (e) => {
    if (e.key === "Escape") { textRef.current?.blur(); }
    e.stopPropagation();
  };

  return (
    <div
      style={{position:"absolute",left:el.x,top:el.y,
        width: el.width || 340,
        overflow:"visible",
        background:"transparent",
        pointerEvents:"none",
        borderRadius:2,
        textAlign: el.align || "center",
      }}>
      {/* Wrapper that hugs text width — this is the actual hit area.
          Rotation is applied here (not the outer 340-wide container) so the
          pivot is the centre of the visible text, not the container.
          width:max-content ensures the hit area matches the rendered glyph
          width exactly, regardless of font loading timing — more reliable than
          display:inline-block alone inside a text-align:center container. */}
      <div
        onMouseDown={handleMouseDown}
        onContextMenu={handleContextMenu}
        data-bbox-id={el.id}
        style={{position:"relative", display:"inline-block",
          width: "max-content",
          cursor: dragging ? "grabbing" : "grab", userSelect:"none",
          pointerEvents:"auto",
          outline: (selected && !editing) ? "1.5px dashed rgba(138,123,108,0.75)" : "none",
          outlineOffset: 3,
          ...rotStyle,
        }}>
        {(el.curve && !editing) ? (
          // Curved display — editing (double-click) temporarily shows the
          // text straight, then re-curves on blur
          <CurvedText el={el} font={font}/>
        ) : (
        <div
          ref={textRef}
          contentEditable={editing}
          suppressContentEditableWarning
          // Uncontrolled: don't pass content as children while editing —
          // let browser own the DOM. Only sync back on blur.
          dangerouslySetInnerHTML={editing ? undefined : { __html: el.content.includes("<") ? el.content : el.content.replace(/\n/g,"<br/>") }}
          onBlur={e => { onChange({ content: e.currentTarget.innerHTML }); setEditing(false); onEditEnd?.(); onEditSelect?.(null); onCommit(); }}
          onKeyDown={handleContentKeyDown}
          onKeyUp={reportEditSelection}
          onMouseUp={reportEditSelection}
          onClick={e => e.stopPropagation()}
          style={{
            ...textStyle,
            display:"inline-block",
            whiteSpace:"nowrap",
            minHeight: el.fontSize,
            outline: editing ? "1px dashed rgba(138,123,108,0.6)" : "none",
            outlineOffset: 2,
            cursor: editing ? "text" : "inherit",
            userSelect: editing ? "text" : "none",
          }}
        />
        )}
        {selected && !multiSelect && !el.locked && (
          <>
            <RotationHandle onMouseDown={handleRotateMouseDown}/>
            <TextScaleHandle el={el} onChange={onChange} onCommit={onCommit} scale={scale}/>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Illustration library panel ───────────────────────────────────────────────
function IllustrationLibrary({ onAdd, onClose }) {
  const [cat, setCat] = useState(CUSTOM_ILLUSTRATION_LIBRARY[0].category);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  // While searching, look across every category; otherwise show the active one
  const items = q
    ? CUSTOM_ILLUSTRATION_LIBRARY.flatMap(c =>
        c.items.filter(i => i.label.toLowerCase().includes(q) || c.category.toLowerCase().includes(q))
          .map(i => ({ ...i, _cat: c.category })))
    : (CUSTOM_ILLUSTRATION_LIBRARY.find(c => c.category === cat) || CUSTOM_ILLUSTRATION_LIBRARY[0]).items;
  return (
    <div style={{position:"absolute",top:0,bottom:0,left:80,width:320,zIndex:200,
      background:"rgba(252,249,245,0.98)",backdropFilter:"blur(16px)",
      borderRight:"1px solid rgba(180,165,150,0.3)",boxShadow:"8px 0 40px rgba(0,0,0,0.08)",
      display:"flex",flexDirection:"column"}}>
      {/* header */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",
        padding:"14px 16px 10px",flexShrink:0}}>
        <div style={{fontSize:10,letterSpacing:3,color:"#9A8F85",fontFamily:"Georgia,serif"}}>ILLUSTRATIONS</div>
        <button onClick={onClose}
          style={{background:"none",border:"none",cursor:"pointer",color:"#9A8F85",fontSize:20,lineHeight:1,padding:"0 4px"}}>
          ×
        </button>
      </div>
      {/* search */}
      <div style={{padding:"0 16px 10px",flexShrink:0}}>
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search illustrations…"
          style={{width:"100%",boxSizing:"border-box",padding:"9px 12px",fontSize:12,
            fontFamily:"Georgia,serif",color:"#3A3028",
            border:"1px solid rgba(180,165,150,0.45)",borderRadius:20,outline:"none",
            background:"rgba(255,255,255,0.85)"}}/>
      </div>
      {/* category chips */}
      {!q && (
        <div style={{display:"flex",flexWrap:"wrap",gap:5,padding:"0 16px 12px",flexShrink:0}}>
          {CUSTOM_ILLUSTRATION_LIBRARY.map(c => (
            <button key={c.category} onClick={() => setCat(c.category)}
              style={{padding:"4px 10px",fontSize:9,letterSpacing:0.8,borderRadius:14,
                border:cat===c.category?"1px solid rgba(138,123,108,0.7)":"1px solid rgba(180,165,150,0.35)",
                background:cat===c.category?"rgba(138,123,108,0.15)":"transparent",
                cursor:"pointer",color:cat===c.category?"#3A3028":"#9A8F85",
                fontFamily:"Georgia,serif",whiteSpace:"nowrap",transition:"all 0.15s"}}>
              {c.category}
            </button>
          ))}
        </div>
      )}
      {/* two-column thumbnail grid */}
      <div style={{flex:1,overflowY:"auto",padding:"2px 16px 16px"}}>
        {q && items.length === 0 && (
          <div style={{fontSize:11,color:"#9A8F85",textAlign:"center",marginTop:24,fontFamily:"Georgia,serif"}}>
            No illustrations match “{query}”.
          </div>
        )}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          {items.map(item => (
            <button key={(item._cat || cat) + item.id} onClick={() => onAdd(item)}
              title="Click to add to your design"
              style={{display:"flex",flexDirection:"column",alignItems:"center",gap:6,
                padding:"14px 8px 10px",background:"rgba(255,255,255,0.7)",
                border:"1px solid rgba(180,165,150,0.3)",borderRadius:10,cursor:"pointer",
                transition:"all 0.15s",fontFamily:"Georgia,serif"}}
              onMouseEnter={e => { e.currentTarget.style.background="rgba(138,123,108,0.12)"; e.currentTarget.style.borderColor="rgba(138,123,108,0.5)"; }}
              onMouseLeave={e => { e.currentTarget.style.background="rgba(255,255,255,0.7)"; e.currentTarget.style.borderColor="rgba(180,165,150,0.3)"; }}>
              <CustomIllustration src={`/illustrations/${item.file}`} size={84} color="#8A7B6C"/>
              <span style={{fontSize:10,color:"#6B5E52",letterSpacing:0.4,textAlign:"center",lineHeight:1.3}}>
                {item.label}
                {q && <span style={{display:"block",fontSize:8,color:"#B9AD9F",letterSpacing:0.8,marginTop:2}}>{item._cat?.toUpperCase()}</span>}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Tips panel (bottom-left helper) ──────────────────────────────────────────
const EDITOR_TIPS = [
  "Trouble selecting an element because another one is in the way? Temporarily hide the blocking layer — hit the eye button next to it in the Layers panel, then click it again to bring it back.",
  "Nudge the selected element with the arrow keys — hold Shift for bigger steps.",
  "Click text once to edit the wording; click anywhere else to finish.",
  "Shift+click elements to select several at once, then drag or resize them together.",
  "Made a mistake? Ctrl+Z (Cmd+Z on Mac) undoes your last change.",
  "The ⤢ handle at the top-right corner resizes; the ↻ handle below rotates.",
];
function TipsPanel() {
  const [open, setOpen] = useState(false);
  return (
    <div style={{position:"absolute",left:14,bottom:14,zIndex:55,fontFamily:"Georgia,serif",maxWidth:320}}>
      {open && (
        <div style={{marginBottom:8,padding:"14px 16px",background:"rgba(252,249,245,0.97)",
          border:"1px solid rgba(180,165,150,0.4)",borderRadius:12,
          boxShadow:"0 8px 32px rgba(0,0,0,0.14)"}}>
          <div style={{fontSize:10,letterSpacing:2,color:"#9A8F85",marginBottom:8}}>HANDY TIPS</div>
          <ul style={{margin:0,padding:"0 0 0 16px",display:"flex",flexDirection:"column",gap:8}}>
            {EDITOR_TIPS.map((t, i) => (
              <li key={i} style={{fontSize:11.5,color:"#5A4C40",lineHeight:1.55}}>{t}</li>
            ))}
          </ul>
        </div>
      )}
      <button onClick={() => setOpen(o => !o)}
        style={{display:"flex",alignItems:"center",gap:6,padding:"7px 14px",
          background:"rgba(252,249,245,0.96)",border:"1px solid rgba(180,165,150,0.4)",
          borderRadius:20,cursor:"pointer",boxShadow:"0 3px 16px rgba(0,0,0,0.1)",
          fontSize:11,letterSpacing:0.5,color:"#6B5E52",fontFamily:"Georgia,serif"}}>
        💡 {open ? "Hide tips" : "Tips"}
      </button>
    </div>
  );
}

// ─── Guest list modal (variable data → one page per guest) ────────────────────
// Spreadsheet-style grid: copy rows straight from Excel / Google Sheets and
// paste — tab-separated columns and multiple rows fill the grid automatically.
const GUEST_COLS = [
  "Line 1 — Names",
  "Line 2 — House / unit # and street",
  "Line 3 — Suburb, state, postcode",
  "Line 4 — Country (if outside Australia)",
];
function GuestListModal({ textEls, onApply, onClose }) {
  // Auto-detect the address block: the text element holding the sample guest
  // details. Headings ("Please Deliver To", stamp notes, etc.) never qualify.
  const skipPat = /deliver|stamp|kindly|return|rsvp|special delivery/i;
  const addrPat = /street|road|avenue|lane|rue|\d{4}|nsw|vic|qld|example/i;
  const candidates = textEls.filter(e => !skipPat.test(e.content || ""));
  const target =
    candidates.find(e => addrPat.test(e.content || "")) ||
    candidates.find(e => /\n|<br/i.test(e.content || "")) ||
    candidates[candidates.length - 1];
  const emptyRow = () => ["", "", "", ""];
  const [rows, setRows] = useState([emptyRow(), emptyRow(), emptyRow()]);

  const setCell = (r, c, v) =>
    setRows(rs => rs.map((row, ri) => ri === r ? row.map((cv, ci) => ci === c ? v : cv) : row));

  const handlePaste = (r, c, e) => {
    const txt = e.clipboardData?.getData("text/plain") || "";
    if (!txt.includes("\t") && !txt.includes("\n")) return;    // single value → normal typing
    e.preventDefault();
    let grid = txt.replace(/\r/g, "").split("\n").map(l => l.split("\t"));
    while (grid.length && grid[grid.length - 1].every(v => !v.trim())) grid.pop();
    // drop a copied header row ("Line 1 - Names" etc.)
    if (grid.length && /line\s*1|^names?$/i.test(grid[0][0] || "")) grid = grid.slice(1);
    setRows(rs => {
      const out = rs.map(row => [...row]);
      grid.forEach((g, gr) => {
        const rr = r + gr;
        while (out.length <= rr) out.push(emptyRow());
        g.forEach((val, gc) => { const cc = c + gc; if (cc < 4) out[rr][cc] = val.trim(); });
      });
      return out;
    });
  };

  const guests = rows.filter(row => row.some(v => v.trim())).map(row => ({
    lines: row.map(s => (s || "").trim()),
  }));
  const preview = (s) => (s || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 34);
  const selStyle = {width:"100%",boxSizing:"border-box",padding:"8px 10px",fontSize:12,fontFamily:"Georgia,serif",
    border:"1px solid rgba(180,165,150,0.5)",borderRadius:8,background:"rgba(255,255,255,0.9)",color:"#3A3028",marginBottom:10};
  const cellInput = {width:"100%",boxSizing:"border-box",border:"none",outline:"none",padding:"7px 9px",
    fontSize:12,fontFamily:"Georgia,serif",color:"#3A3028",background:"transparent"};
  return (
    <div style={{position:"fixed",inset:0,zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",
      background:"rgba(58,48,40,0.45)",backdropFilter:"blur(8px)"}}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{background:"#FAF7F3",borderRadius:16,padding:"32px 32px 26px",width:760,maxWidth:"94vw",
        maxHeight:"86vh",overflowY:"auto",boxShadow:"0 24px 80px rgba(0,0,0,0.2)",fontFamily:"Georgia,serif"}}>
        <div style={{fontSize:11,letterSpacing:3,color:"#9A8F85",marginBottom:6}}>GUEST LIST</div>
        <div style={{fontSize:13,color:"#6B5E52",lineHeight:1.7,marginBottom:14}}>
          Copy your guest list straight from your spreadsheet and paste it into the first cell —
          rows and columns fill in automatically. A page is created for every guest.
        </div>
        <div style={{border:"1px solid rgba(180,165,150,0.5)",borderRadius:10,overflow:"hidden",
          background:"rgba(255,255,255,0.9)",marginBottom:6}}>
          <table style={{width:"100%",borderCollapse:"collapse",tableLayout:"fixed"}}>
            <thead>
              <tr>
                {GUEST_COLS.map((h, i) => (
                  <th key={i} style={{textAlign:"left",padding:"8px 9px",fontSize:9.5,letterSpacing:0.6,
                    color:"#6B5E52",fontWeight:"normal",background:"rgba(138,123,108,0.12)",
                    borderBottom:"1px solid rgba(180,165,150,0.45)",
                    borderRight:i<3?"1px solid rgba(180,165,150,0.3)":"none",
                    width:i===0?"24%":i===3?"20%":"28%"}}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r}>
                  {row.map((val, c) => (
                    <td key={c} style={{padding:0,borderBottom:r<rows.length-1?"1px solid rgba(180,165,150,0.25)":"none",
                      borderRight:c<3?"1px solid rgba(180,165,150,0.25)":"none"}}>
                      <input value={val}
                        onChange={e => setCell(r, c, e.target.value)}
                        onPaste={e => handlePaste(r, c, e)}
                        placeholder={r===0&&c===0?"John and Linda Smith":r===0&&c===1?"12 Jones Street":r===0&&c===2?"Sydney, NSW, 2000":""}
                        style={cellInput}/>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{display:"flex",gap:14,marginBottom:14}}>
          <button onClick={() => setRows(rs => [...rs, emptyRow()])}
            style={{border:"none",background:"none",cursor:"pointer",fontSize:11,color:"#6B5E52",
              fontFamily:"Georgia,serif",padding:0}}>+ Add row</button>
          <button onClick={() => setRows([emptyRow(), emptyRow(), emptyRow()])}
            style={{border:"none",background:"none",cursor:"pointer",fontSize:11,color:"#B05A5A",
              fontFamily:"Georgia,serif",padding:0}}>Clear all</button>
        </div>
        <div style={{fontSize:11,color:"#8A7B6C",lineHeight:1.6,marginBottom:12,
          background:"rgba(138,123,108,0.08)",padding:"8px 12px",borderRadius:8}}>
          Lines 1–4 fill the address block{target ? <> (currently “{preview(target.content)}…”)</> : ""}.
          Everything else on the envelope — “Please Deliver To”, stamps, artwork — stays as designed.
        </div>
        <div style={{display:"flex",gap:10,marginTop:8}}>
          <button onClick={() => guests.length && target && onApply(guests, target.id)}
            disabled={!guests.length || !target}
            style={{flex:1,padding:"11px 0",fontSize:12,letterSpacing:1.5,border:"none",borderRadius:8,
              background:guests.length && target ? "#3A3028" : "rgba(58,48,40,0.3)",color:"#F5F0E8",
              cursor:guests.length && target ? "pointer" : "default",fontFamily:"Georgia,serif"}}>
            CREATE {guests.length || ""} PAGE{guests.length === 1 ? "" : "S"}
          </button>
          <button onClick={onClose}
            style={{padding:"11px 18px",fontSize:12,letterSpacing:1,border:"1px solid rgba(180,165,150,0.5)",
              borderRadius:8,background:"transparent",color:"#6B5E52",cursor:"pointer",fontFamily:"Georgia,serif"}}>
            Cancel
          </button>
        </div>
        {guests.length > 0 && (
          <div style={{fontSize:10,color:"#9A8F85",marginTop:10}}>
            {guests.length} guest{guests.length===1?"":"s"} detected — first: “{guests[0].lines[0]}”
          </div>
        )}
        <div style={{fontSize:11,color:"#8A7B6C",lineHeight:1.6,marginTop:14,paddingTop:12,
          borderTop:"1px solid rgba(180,165,150,0.3)"}}>
          <strong style={{fontWeight:"normal",color:"#6B5E52",letterSpacing:0.5}}>Tip:</strong>{" "}
          want to change the layout after inserting your guest list? Make the change on
          page 1, then re-insert your guest list here — it rebuilds every page from
          page 1's layout (starting again).
        </div>
      </div>
    </div>
  );
}

// ─── Save / Account modal ─────────────────────────────────────────────────────
function SaveModal({ onClose, onSave, existingEmail }) {
  const [email,    setEmail]    = useState(existingEmail || "");
  const [name,     setName]     = useState("");
  const [password, setPassword] = useState("");
  const [mode,     setMode]     = useState("save");
  const [done,     setDone]     = useState(false);
  const [err,      setErr]      = useState("");

  const inputStyle = {
    width:"100%", padding:"10px 12px", fontSize:13, fontFamily:"Georgia,serif",
    border:"1px solid rgba(180,165,150,0.5)", borderRadius:8,
    background:"rgba(255,255,255,0.85)", color:"#3A3028", outline:"none",
    boxSizing:"border-box", marginBottom:12,
  };

  const handleSubmit = () => {
    setErr("");
    if (!email || !email.includes("@")) { setErr("Please enter a valid email address."); return; }
    if (mode === "save" && !name) { setErr("Please enter your name."); return; }
    try { localStorage.setItem("linenStudio_user", JSON.stringify({ email, name: name || "Guest" })); } catch(e) {}
    onSave(email, name);
    setDone(true);
  };

  return (
    <div style={{position:"fixed",inset:0,zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",
      background:"rgba(58,48,40,0.45)",backdropFilter:"blur(8px)"}}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{background:"#FAF7F3",borderRadius:16,padding:"40px 36px",width:400,maxWidth:"90vw",
        boxShadow:"0 24px 80px rgba(0,0,0,0.2)",position:"relative",fontFamily:"Georgia,serif"}}>
        <button onClick={onClose}
          style={{position:"absolute",top:16,right:20,background:"none",border:"none",
            cursor:"pointer",fontSize:20,color:"#9A8F85",lineHeight:1}}>×</button>
        {done ? (
          <div style={{textAlign:"center",padding:"20px 0"}}>
            <div style={{fontSize:32,marginBottom:16}}>✦</div>
            <div style={{fontSize:20,color:"#3A3028",marginBottom:10}}>Design saved!</div>
            <div style={{fontSize:13,color:"#9A8F85",lineHeight:1.7,marginBottom:24}}>
              We've saved your design to your account.<br/>
              Come back any time to keep editing.
            </div>
            <button onClick={onClose}
              style={{background:"#3A3028",color:"#F5F0E8",border:"none",borderRadius:8,
                padding:"12px 32px",fontSize:12,letterSpacing:2,cursor:"pointer",fontFamily:"Georgia,serif"}}>
              CONTINUE EDITING
            </button>
          </div>
        ) : (
          <>
            <div style={{fontSize:10,letterSpacing:3,color:"#9A8F85",marginBottom:6}}>LINEN STUDIO</div>
            <div style={{fontSize:24,color:"#3A3028",marginBottom:6,fontWeight:"normal"}}>
              {mode === "save" ? "Save your design" : "Sign in"}
            </div>
            <div style={{fontSize:13,color:"#9A8F85",lineHeight:1.65,marginBottom:24}}>
              {mode === "save"
                ? "Create a free account to save your design and come back any time."
                : "Welcome back. Sign in to load your saved design."}
            </div>
            <div style={{display:"flex",gap:0,marginBottom:20,border:"1px solid rgba(180,165,150,0.4)",borderRadius:8,overflow:"hidden"}}>
              {[{id:"save",label:"Create account"},{id:"signin",label:"Sign in"}].map(t => (
                <button key={t.id} onClick={() => { setMode(t.id); setErr(""); }}
                  style={{flex:1,padding:"9px 0",fontSize:11,letterSpacing:1,border:"none",
                    background:mode===t.id?"rgba(138,123,108,0.15)":"transparent",
                    cursor:"pointer",color:mode===t.id?"#3A3028":"#9A8F85",
                    fontFamily:"Georgia,serif",transition:"all 0.15s"}}>
                  {t.label.toUpperCase()}
                </button>
              ))}
            </div>
            {mode === "save" && (
              <input placeholder="Your name" value={name} onChange={e => setName(e.target.value)} style={inputStyle}/>
            )}
            <input placeholder="Email address" value={email} onChange={e => setEmail(e.target.value)} type="email" style={inputStyle}/>
            <input placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} type="password" style={{...inputStyle, marginBottom:0}}/>
            {err && <div style={{fontSize:11,color:"#C07070",marginTop:8}}>{err}</div>}
            <button onClick={handleSubmit}
              style={{width:"100%",marginTop:16,padding:"13px 0",background:"#3A3028",color:"#F5F0E8",
                border:"none",borderRadius:8,fontSize:11,letterSpacing:2,cursor:"pointer",
                fontFamily:"Georgia,serif"}}
              onMouseEnter={e => e.target.style.background="#5A4A3C"}
              onMouseLeave={e => e.target.style.background="#3A3028"}>
              {mode === "save" ? "SAVE DESIGN" : "SIGN IN & LOAD DESIGN"}
            </button>
            <div style={{marginTop:16,fontSize:11,color:"#B0A496",textAlign:"center",lineHeight:1.6}}>
              We'll never share your email or send spam.
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Group bounding box — shown when multiple elements selected ───────────────
function GroupBoundingBox({ selectedIds, elements, scale, cw, ch, onGroupResize, onGroupDragStart }) {
  // Fallback bounds from element data — used on first render before DOM measurement.
  const sel = (elements || []).filter(e => selectedIds.includes(e.id));
  let fbMinX = Infinity, fbMinY = Infinity, fbMaxX = -Infinity, fbMaxY = -Infinity;
  sel.forEach(el => {
    const w = el.width || 100;
    const h = el.height || el.fontSize || 20;
    fbMinX = Math.min(fbMinX, el.x);
    fbMinY = Math.min(fbMinY, el.y);
    fbMaxX = Math.max(fbMaxX, el.x + w);
    fbMaxY = Math.max(fbMaxY, el.y + h);
  });

  // Measure actual rendered bounds of each selected element's visible div.
  // This is the only way to get tight bounds around text (since the text's
  // container is much wider than the rendered glyphs).
  const [measured, setMeasured] = useState(null);
  useLayoutEffect(() => {
    if (selectedIds.length < 2) { setMeasured(null); return; }
    const canvas = document.querySelector('[data-canvas-root]');
    if (!canvas) return;
    const canvasRect = canvas.getBoundingClientRect();
    let mnX = Infinity, mnY = Infinity, mxX = -Infinity, mxY = -Infinity;
    let count = 0;
    for (const id of selectedIds) {
      const node = canvas.querySelector(`[data-bbox-id="${String(id).replace(/"/g, '\\"')}"]`);
      if (!node) continue;
      const r = node.getBoundingClientRect();
      const s = scale || 1;
      const x1 = (r.left   - canvasRect.left) / s;
      const y1 = (r.top    - canvasRect.top ) / s;
      const x2 = (r.right  - canvasRect.left) / s;
      const y2 = (r.bottom - canvasRect.top ) / s;
      mnX = Math.min(mnX, x1); mnY = Math.min(mnY, y1);
      mxX = Math.max(mxX, x2); mxY = Math.max(mxY, y2);
      count++;
    }
    if (!count) return;
    const next = { minX: mnX, minY: mnY, maxX: mxX, maxY: mxY };
    setMeasured(prev => {
      if (prev &&
          Math.abs(prev.minX - next.minX) < 0.5 &&
          Math.abs(prev.minY - next.minY) < 0.5 &&
          Math.abs(prev.maxX - next.maxX) < 0.5 &&
          Math.abs(prev.maxY - next.maxY) < 0.5) {
        return prev;
      }
      return next;
    });
  }, [selectedIds, elements, scale]);

  if (selectedIds.length < 2 || !sel.length) return null;

  const b = measured || { minX: fbMinX, minY: fbMinY, maxX: fbMaxX, maxY: fbMaxY };
  const minX = b.minX, minY = b.minY, maxX = b.maxX, maxY = b.maxY;
  const bw = maxX - minX, bh = maxY - minY;
  const PAD = 8;
  const HANDLE = 14;       // visible square handle (Canva-style)
  const HANDLE_HALF = HANDLE / 2;

  // Clamp the bbox so it (and its corner handle) stay inside the canvas.
  // The handle hangs half-outside the bbox corner, so we leave HANDLE_HALF
  // of breathing room on each side.
  const safeLeft   = Math.max(HANDLE_HALF, minX - PAD);
  const safeTop    = Math.max(HANDLE_HALF, minY - PAD);
  const safeRight  = Math.min((cw || Infinity) - HANDLE_HALF, maxX + PAD);
  const safeBottom = Math.min((ch || Infinity) - HANDLE_HALF, maxY + PAD);
  const boxLeft   = safeLeft;
  const boxTop    = safeTop;
  const boxWidth  = Math.max(0, safeRight  - safeLeft);
  const boxHeight = Math.max(0, safeBottom - safeTop);

  const handleResizeMouseDown = (e) => {
    e.stopPropagation(); e.preventDefault();
    const startX   = e.clientX;
    const startW   = bw, startH = bh;
    const startMinX = minX, startMinY = minY;
    // Snapshot original element states
    const origEls = sel.map(el => ({ ...el }));

    const move = (ev) => {
      const dx    = (ev.clientX - startX) / scale;
      const newW  = Math.max(40, startW + dx);
      const ratio = newW / startW;
      onGroupResize(origEls, startMinX, startMinY, ratio, false);
    };
    const up = (ev) => {
      const dx    = (ev.clientX - startX) / scale;
      const newW  = Math.max(40, startW + dx);
      const ratio = newW / startW;
      onGroupResize(origEls, startMinX, startMinY, ratio, true);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return (
    <div style={{
      position: "absolute",
      left:   boxLeft,
      top:    boxTop,
      width:  boxWidth,
      height: boxHeight,
      border: "1.5px solid rgba(58,48,40,0.85)",
      borderRadius: 2,
      pointerEvents: "none",
      zIndex: 120,
    }}>
      {/* Transparent drag area covers whole bbox for group move */}
      <div
        onMouseDown={(e) => onGroupDragStart(e, { minX, minY, w: maxX - minX, h: maxY - minY })}
        style={{
          position: "absolute", inset: 0,
          cursor: "grab", pointerEvents: "auto",
          background: "transparent", zIndex: 121,
        }}
      />
      {/* Canva-style corner handles — small white squares at all 4 corners.
          Only the top-right is interactive (resize); the others are
          purely visual so users immediately recognise it as a bounding box. */}
      {[
        { top: -HANDLE_HALF, left: -HANDLE_HALF, cursor: "default",   interactive: false },
        { top: -HANDLE_HALF, right: -HANDLE_HALF, cursor: "nesw-resize", interactive: true },
        { bottom: -HANDLE_HALF, left: -HANDLE_HALF, cursor: "default",interactive: false },
        { bottom: -HANDLE_HALF, right: -HANDLE_HALF, cursor: "default", interactive: false },
      ].map((pos, i) => (
        <div
          key={i}
          onMouseDown={pos.interactive ? handleResizeMouseDown : undefined}
          style={{
            position: "absolute",
            top: pos.top, left: pos.left, right: pos.right, bottom: pos.bottom,
            width: HANDLE, height: HANDLE, borderRadius: 2,
            background: "#fff",
            border: "1.5px solid rgba(58,48,40,0.85)",
            cursor: pos.cursor,
            pointerEvents: pos.interactive ? "auto" : "none",
            zIndex: 130,
            boxShadow: "0 1px 3px rgba(0,0,0,0.18)",
            boxSizing: "border-box",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          {pos.interactive && <ResizeArrowIcon/>}
        </div>
      ))}
    </div>
  );
}

// ─── Gallery template preview — miniature render of the real template ─────────
function TemplatePreview({ tmpl }) {
  const { cw, ch } = canvasDims(tmpl.sizeKey);
  const ref = useRef(null);
  const [k, setK] = useState(0);
  useEffect(() => {
    const measure = () => { if (ref.current) setK(ref.current.clientWidth / cw); };
    measure();
    const obs = new ResizeObserver(measure);
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, [cw]);
  return (
    <div ref={ref} style={{position:"absolute",inset:0,overflow:"hidden"}}>
      {k > 0 && (
        <div style={{position:"absolute",top:0,left:0,width:cw,height:ch,
          transform:`scale(${k})`,transformOrigin:"top left",background:tmpl.background}}>
          {(tmpl.elements || []).map(el => {
            if (el.hidden) return null;
            const rot = { opacity: el.opacity ?? 1,
              ...(el.rotation ? { transform:`rotate(${el.rotation}deg)`, transformOrigin:"center center" } : {}) };
            if (el.type === "image") return (
              <img key={el.id} src={el.src} alt="" draggable={false}
                style={{position:"absolute",left:el.x,top:el.y,width:el.width,height:el.height,objectFit:el.fit || "contain",...rot}}/>
            );
            if (el.type === "illustration") return (
              <div key={el.id} style={{position:"absolute",left:el.x,top:el.y,width:el.width,height:el.height,...rot}}>
                <CustomIllustration src={el.illustrationSrc} width={el.width} height={el.height}
                  color={el.color || "#9A8F85"} stretch={!!el.stretch}/>
              </div>
            );
            if (el.type === "text") {
              const font = getAllFonts().find(f => f.id === el.fontId) || FONTS[0];
              if (el.curve) return (
                <div key={el.id} style={{position:"absolute",left:el.x,top:el.y,width:el.width,...rot}}>
                  <CurvedText el={el} font={font}/>
                </div>
              );
              return (
                <div key={el.id}
                  dangerouslySetInnerHTML={{ __html: (el.content || "").includes("<") ? el.content : (el.content || "").replace(/\n/g, "<br/>") }}
                  style={{position:"absolute",left:el.x,top:el.y,width:el.width,
                    fontFamily:font.family,fontSize:el.fontSize,color:el.color,
                    textAlign:el.align||"center",fontStyle:el.italic?"italic":"normal",
                    lineHeight:el.lineHeight||1.2,
                    letterSpacing:el.letterSpacing?`${el.letterSpacing}px`:undefined,...rot}}/>
              );
            }
            if (el.type === "divider") return (
              <div key={el.id} style={{position:"absolute",left:el.x,top:el.y,width:el.width,...rot}}>
                <div style={{height:1,background:"rgba(90,74,60,0.25)"}}/>
              </div>
            );
            return null;
          })}
        </div>
      )}
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function LinenSignEditor() {
  const [urlParams]        = useState(() => getUrlParams());
  const [stage,            setStage]            = useState(() =>
    urlParams.template ? "loading"
      : (urlParams.size || urlParams.type || urlParams.variant) ? "gallery" : "groups"
  );
  const [pickedGroup,      setPickedGroup]      = useState(null);
  const [pickedType,       setPickedType]       = useState(null);
  const [pickedCollection, setPickedCollection] = useState(null);
  const [pickedSize,       setPickedSize]       = useState(null);
  const [template,         setTemplate]         = useState(null);
  const [selectedIds,      setSelectedIds]      = useState([]); // multi-select
  // Convenience: primary selected element is first in array
  const selectedId = selectedIds[0] ?? null;
  const setSelectedId = (id) => setSelectedIds(id ? [id] : []);
  const [exportMsg,        setExportMsg]        = useState(null);
  const [showLibrary,      setShowLibrary]      = useState(false);
  const [showShapes,       setShowShapes]       = useState(false);
  const [showSaveModal,    setShowSaveModal]    = useState(false);
  const [showLoadJsonModal, setShowLoadJsonModal] = useState(false);
  const [loadJsonText,      setLoadJsonText]      = useState("");
  const [loadJsonErr,       setLoadJsonErr]       = useState("");
  const [userEmail,        setUserEmail]        = useState(() => { try { return JSON.parse(localStorage.getItem("linenStudio_user") || "{}").email || ""; } catch { return ""; } });
  const [savedPulse,       setSavedPulse]       = useState(false);
  const [scale,            setScale]            = useState(1);
  const [zoom,             setZoom]             = useState(1);
  const [contextMenu,      setContextMenu]      = useState(null); // {x, y, ids: [...]} in viewport coords
  const [bgColour,         setBgColour]         = useState("#F2EDE4");
  const [palette,          setPalette]          = useState(DEFAULT_PALETTE);
  const [customFonts,      setCustomFonts]      = useState([]);
  const [guideX,           setGuideX]           = useState(null);
  const [guideXKind,       setGuideXKind]       = useState(null);
  const [guideYKind,       setGuideYKind]       = useState(null);
  const [guideY,           setGuideY]           = useState(null);
  const [staged,           _setStaged]          = useState(null);
  const [marquee,          setMarquee]          = useState(null); // {x,y,w,h} in internal coords
  const [showLinenTexture, setShowLinenTexture] = useState(true);
  const [pages,            setPages]            = useState([{ id: "pg-1", elements: null }]); // multi-page designs (envelopes, menus)
  const [pageIdx,          setPageIdx]          = useState(0);
  const [showGuestModal,   setShowGuestModal]   = useState(false);
  const [editingId,        setEditingId]        = useState(null); // which element is in text-edit mode
  const [glyphPicker,      setGlyphPicker]      = useState(null); // {x,y,text} floating alternate picker

  const canvasRef          = useRef(null);
  const fileRef            = useRef(null);
  const fontFileRef        = useRef(null);
  const savedRangeRef      = useRef(null); // snapshot of selection when glyph picker opens
  const elementsRef        = useRef([]);
  const groupDragRef       = useRef(null); // stores {startPositions, mx, my} for group drag
  const fitRef             = useRef(1);    // mirrors the computed fit scale
  const ignoreNextCapture  = useRef(false); // skip one capture cycle after synthetic re-dispatch

  const { present: elements, set: setElements, undo, redo, canUndo, canRedo, reset: resetElements } = useUndoRedo([]);

  useEffect(() => { _runtimeFonts = customFonts; }, [customFonts]);
  elementsRef.current = elements;

  // setStaged wrapper backed by a ref so the *latest* staged value is always
  // readable synchronously (stagedRef.current), even for commits scheduled in
  // the same tick as a setStaged call. Previously commitStaged read the latest
  // value inside a setState updater and called setElements from within it —
  // an impure updater that React StrictMode double-invokes in dev, committing
  // twice per action (which corrupted the undo history and crashed the editor).
  const stagedRef = useRef(null);
  const setStaged = useCallback((next) => {
    const val = typeof next === "function" ? next(stagedRef.current) : next;
    stagedRef.current = val;
    _setStaged(val);
  }, []);

  const displayElements = staged ?? elements ?? [];

  const commitStaged = useCallback(() => {
    const latest = stagedRef.current;
    if (latest) setElements(latest);
    setStaged(null);
  }, [setElements, setStaged]);

  const updateElementStaged = useCallback((id, patch) => {
    setStaged(prev => {
      const base = prev ?? elementsRef.current ?? [];
      return base.map(el => el.id === id ? { ...el, ...patch } : el);
    });
  }, [setStaged]);

  // Load Google Fonts
  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?${FONTS.map(f => `family=${f.url}`).join("&")}&display=swap`;
    document.head.appendChild(link);
    loadBrandFonts();
  }, []);

  // Measure canvas scale
  useEffect(() => {
    if (!canvasRef.current) return;
    const measure = () => {
      const rect = canvasRef.current?.getBoundingClientRect();
      const { cw } = canvasDims(template?.sizeKey);
      if (rect) setScale(rect.width / cw);
    };
    measure();
    const obs = new ResizeObserver(measure);
    if (canvasRef.current) obs.observe(canvasRef.current);
    return () => obs.disconnect();
  }, [stage, template]);

  // Keyboard shortcuts
  useEffect(() => {
    if (stage !== "editor") return;
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); setStaged(null); }
      if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.shiftKey && e.key === "z"))) { e.preventDefault(); redo(); }
      if ((e.key === "Delete" || e.key === "Backspace") && document.activeElement.tagName !== "TEXTAREA" && document.activeElement.tagName !== "INPUT") {
        if (selectedIds.length) { setElements(els => els.filter(el => !selectedIds.includes(el.id))); setSelectedIds([]); }
      }
      // Arrow keys nudge the selected element(s): 1 unit, Shift = 10 units
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
        const ae = document.activeElement;
        if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.tagName === "SELECT" || ae.isContentEditable)) return;
        if (!selectedIds.length) return;
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp"   ? -step : e.key === "ArrowDown"  ? step : 0;
        setElements(els => els.map(el => selectedIds.includes(el.id) && !el.locked
          ? { ...el, x: Math.round((el.x + dx) * 10) / 10, y: Math.round((el.y + dy) * 10) / 10 }
          : el));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stage, selectedId, selectedIds, undo, redo, setElements]);

  // glyphPicker is now driven by onEditSelect callbacks from CanvasElement
  // (mouseup/keyup inside the contenteditable), rather than a document-level
  // selectionchange listener.  This avoids the race where mousedown on a picker
  // button collapses the selection before the click event fires.

  // `css` is a full font-feature-settings value like '"ss13" 1' or '"aalt" 3',
  // or null to restore the original glyphs.
  const applyGlyphFeature = useCallback((css) => {
    if (!editingId) return;
    _glyphApplyGuard = Date.now() + 500; // suppress selection reports during apply
    const textEl = document.querySelector(`[data-bbox-id="${editingId}"] [contenteditable]`);
    if (!textEl) return;

    // By the time the button click fires, mousedown has already cleared the live
    // selection.  Use the range we snapshotted when the picker opened instead.
    const range = savedRangeRef.current;
    if (!range) return;

    // Re-apply the saved range so DOM mutation methods work correctly
    const sel = window.getSelection();
    if (sel) { sel.removeAllRanges(); sel.addRange(range); }

    if (css) {
      const span = document.createElement("span");
      span.style.fontFeatureSettings = css;
      try { range.surroundContents(span); }
      catch { const frag = range.extractContents(); span.appendChild(frag); range.insertNode(span); }
    } else {
      // "Original" — unwrap any existing feature spans around the selection
      const frag = range.extractContents();
      frag.querySelectorAll("span[style*=font-feature]").forEach(s => {
        s.replaceWith(...s.childNodes);
      });
      range.insertNode(frag);
    }
    updateElementStaged(editingId, { content: textEl.innerHTML });
    setGlyphPicker(null);
  }, [editingId, updateElementStaged]);

  const openTemplate = (tmpl) => {
    if (tmpl.placeholder) return;
    setTemplate(tmpl);
    resetElements(JSON.parse(JSON.stringify(tmpl.elements)));
    setStaged(null);
    setBgColour(tmpl.background);
    setSelectedId(null);
    setShowLibrary(false);
    setPages([{ id: "pg-1", elements: null }]);
    setPageIdx(0);
    setStage("editor");
  };

  // Preview mode: the default body margin leaves a white ring around the
  // canvas when the app is embedded small (suite mock-up iframes). Kill it.
  useEffect(() => {
    if (urlParams.preview) document.body.style.margin = "0";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Deep link: ?template=sw12 opens that design straight into the editor ───
  // Design-first entry. Ad and email links point at one design, not a gallery.
  // Falls back to normal browsing if the id is unknown.
  useEffect(() => {
    if (!urlParams.template) return;
    const tmpl = TEMPLATES.find(t => t.id === urlParams.template);
    if (tmpl && !tmpl.placeholder) {
      openTemplate(tmpl);
      // Locked paper colour (coloured card stock / envelope paper): the
      // canvas background is the paper, not a design choice.
      if (urlParams.bg && urlParams.lockbg) setBgColour("#" + urlParams.bg);
    }
    else setStage("groups");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Multi-page (envelopes, menus…) ─────────────────────────────────────────
  // The active page's elements live in the undo-managed `elements`; inactive
  // pages are snapshotted in `pages`. Undo history resets on page switch.
  const multiPageEnabled = ["envelope-front","envelope-back","envelope-liner","menu"].includes(template?.category);
  const clone = (v) => JSON.parse(JSON.stringify(v));

  const gotoPage = (i) => {
    if (i === pageIdx || i < 0 || i >= pages.length) return;
    const snapshot = elementsRef.current;
    const target = pages[i].elements || snapshot;
    setPages(p => p.map((pg, k) => k === pageIdx ? { ...pg, elements: snapshot } : pg));
    resetElements(clone(target));
    setStaged(null); setSelectedIds([]); setPageIdx(i);
  };

  const addPage = () => {
    const snapshot = elementsRef.current;
    setPages(p => [...p.map((pg, k) => k === pageIdx ? { ...pg, elements: snapshot } : pg),
                   { id: "pg-" + Date.now(), elements: clone(snapshot) }]);
    resetElements(clone(snapshot));
    setStaged(null); setSelectedIds([]); setPageIdx(pages.length);
  };

  const deletePage = () => {
    if (pages.length <= 1) return;
    const rest = pages.filter((_, k) => k !== pageIdx);
    const ni = Math.max(0, pageIdx - 1);
    setPages(rest);
    resetElements(clone(rest[ni].elements || elementsRef.current));
    setStaged(null); setSelectedIds([]); setPageIdx(ni);
  };

  // All pages with the active one refreshed — used for save / cart payloads
  const allPages = () => pages.map((pg, i) =>
    ({ id: pg.id, elements: i === pageIdx ? elementsRef.current : (pg.elements || elementsRef.current) }));

  // Guest list → one page per guest. The guest's lines (1-4) replace the
  // address block only; headings like "Please Deliver To" are left untouched.
  const applyGuestList = (guests, targetId) => {
    if (!guests.length || !targetId) return;
    // always rebuild from PAGE 1's layout (matches the tip in the modal),
    // regardless of which page is open when the list is re-inserted
    const base = pageIdx === 0 ? elementsRef.current : (pages[0]?.elements || elementsRef.current);
    const safe = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const newPages = guests.map((g, i) => ({
      id: "pg-guest-" + i,
      elements: clone(base.map(el =>
        (el.type === "text" && el.id === targetId)
          ? { ...el, content: safe(g.lines.filter(Boolean).join("\n")) }
          : el
      )),
    }));
    setPages(newPages);
    setPageIdx(0);
    resetElements(clone(newPages[0].elements));
    setStaged(null); setSelectedIds([]);
    setShowGuestModal(false);
  };

  const handleSnap = useCallback((rawX, rawY, w, h, draggingId) => {
    const { cw, ch } = canvasDims(template?.sizeKey);
    const base = staged ?? elementsRef.current ?? [];
    const { xLines, yLines } = getSnapLines(base, draggingId, cw, ch);
    const result = applySnap(rawX, rawY, w, h, xLines, yLines);
    setGuideX(result.guideX); setGuideY(result.guideY);
    setGuideXKind(result.guideXKind); setGuideYKind(result.guideYKind);
    return { x: result.x, y: result.y };
  }, [staged, template]);

  const handleSnapEnd = useCallback(() => {
    setGuideX(null); setGuideY(null);
    setGuideXKind(null); setGuideYKind(null);
  }, []);

  const selectedEl = displayElements.find(e => e.id === selectedId);

  const addText = () => {
    const el = { id:`el-${Date.now()}`, type:"text", content:"New text",
      x:100, y:150, fontSize:22, fontId:"cormorant", italic:false, align:"center",
      color:"#3A3028", width:120, lineHeight:1.35, rotation:0 };
    setElements(els => [...els, el]); setSelectedId(el.id);
  };

  const deleteSelected = () => {
    if (!selectedIds.length) return;
    // Work from displayElements (staged ?? committed) so marquee selections work
    const base = staged ?? elementsRef.current ?? [];
    const remaining = base.filter(e => !selectedIds.includes(e.id));
    setStaged(null);
    setElements(remaining);
    setSelectedIds([]);
  };

  const duplicateSelected = () => {
    if (!selectedIds.length) return;
    const copies = selectedIds.map((id, i) => {
      const el = displayElements.find(e => e.id === id);
      if (!el) return null;
      return { ...JSON.parse(JSON.stringify(el)), id:`el-${Date.now()+i}`, x:el.x+16, y:el.y+16 };
    }).filter(Boolean);
    setElements(els => [...els, ...copies]);
    setSelectedIds(copies.map(c => c.id));
  };

  // Duplicate a specific list of ids (used by the right-click menu).
  const duplicateIds = (ids) => {
    if (!ids || !ids.length) return;
    const base = elementsRef.current ?? [];
    const copies = ids.map((id, i) => {
      const el = base.find(e => e.id === id);
      if (!el) return null;
      return { ...JSON.parse(JSON.stringify(el)), id:`el-${Date.now()+i}`, x:el.x+16, y:el.y+16 };
    }).filter(Boolean);
    setElements(els => [...els, ...copies]);
    setSelectedIds(copies.map(c => c.id));
  };

  const deleteIds = (ids) => {
    if (!ids || !ids.length) return;
    setElements(els => els.filter(el => !ids.includes(el.id)));
    setSelectedIds([]);
  };

  // Z-order: end of the array renders on top.
  const bringToFront = (ids) => {
    if (!ids || !ids.length) return;
    setElements(els => {
      const top  = els.filter(e =>  ids.includes(e.id));
      const rest = els.filter(e => !ids.includes(e.id));
      return [...rest, ...top];
    });
  };
  const sendToBack = (ids) => {
    if (!ids || !ids.length) return;
    setElements(els => {
      const back = els.filter(e =>  ids.includes(e.id));
      const rest = els.filter(e => !ids.includes(e.id));
      return [...back, ...rest];
    });
  };
  const moveOneUp = (id) => {
    setElements(els => {
      const i = els.findIndex(e => e.id === id);
      if (i < 0 || i === els.length - 1) return els;
      const copy = els.slice();
      [copy[i], copy[i + 1]] = [copy[i + 1], copy[i]];
      return copy;
    });
  };
  const moveOneDown = (id) => {
    setElements(els => {
      const i = els.findIndex(e => e.id === id);
      if (i <= 0) return els;
      const copy = els.slice();
      [copy[i], copy[i - 1]] = [copy[i - 1], copy[i]];
      return copy;
    });
  };

  const toggleHidden = (id) => {
    setElements(els => els.map(e => e.id === id ? { ...e, hidden: !e.hidden } : e));
  };
  const toggleLocked = (id) => {
    setElements(els => els.map(e => e.id === id ? { ...e, locked: !e.locked } : e));
  };

  const openContextMenu = (clientX, clientY, elementId) => {
    // If right-clicking an element that isn't already in selection, change
    // selection to just that element so the menu actions target it.
    const targetIds = (elementId && selectedIds.includes(elementId))
      ? selectedIds
      : (elementId ? [elementId] : selectedIds);
    if (elementId && !selectedIds.includes(elementId)) setSelectedIds([elementId]);
    setContextMenu({ x: clientX, y: clientY, ids: targetIds });
  };

  const handlePhotoUpload = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const maxW = 320, maxH = 400;
        const ratio = img.naturalWidth / img.naturalHeight;
        let w = Math.min(img.naturalWidth, maxW);
        let h = w / ratio;
        if (h > maxH) { h = maxH; w = h * ratio; }
        w = Math.round(w); h = Math.round(h);
        const el = { id:`img-${Date.now()}`, type:"image", src:ev.target.result,
          x:Math.round((INTERNAL_W - w) / 2), y:80, width:w, height:h, rotation:0 };
        setElements(els => [...els, el]); setSelectedId(el.id);
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file); e.target.value = "";
  };

  const handleFontUpload = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const raw = file.name.replace(/\.(ttf|otf|woff|woff2)$/i, "").replace(/[-_]/g, " ");
    const label = raw.charAt(0).toUpperCase() + raw.slice(1);
    const id = `custom-${Date.now()}`;
    const family = `CustomFont_${id}`;
    // Probe GSUB features from raw binary (TTF/OTF only; WOFF ignored gracefully)
    const bufReader = new FileReader();
    bufReader.onload = (ev) => { _probeFontFromBuffer(id, ev.target.result); };
    bufReader.readAsArrayBuffer(file);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target.result;
      const apply = () => {
        const style = document.createElement("style");
        style.textContent = `@font-face{font-family:'${family}';src:url('${dataUrl}');}`;
        document.head.appendChild(style);
        setTimeout(() => {
          setCustomFonts(cf => [...cf, { id, label, family }]);
          if (selectedId) setElements(els => els.map(el => el.id === selectedId ? { ...el, fontId: id } : el));
        }, 200);
      };
      const face = new FontFace(family, `url(${dataUrl})`);
      face.load().then(loaded => { document.fonts.add(loaded); apply(); }).catch(apply);
    };
    reader.readAsDataURL(file); e.target.value = "";
  };

  const addIllustration = (item) => {
    const isCustom = !!item.file;
    const el = { id:`ill-${Date.now()}`, type:"illustration",
      illustrationId: isCustom ? null : item.svg,
      illustrationSrc: isCustom ? `/illustrations/${item.file}` : null,
      label:item.label, x:130, y:100, width:140, height:140, color:"#9A8F85", rotation:0 };
    setElements(els => [...els, el]); setSelectedId(el.id);
  };

  const addShape = (item) => {
    const vbH = item.vbH || 100; // shape SVG viewBox height (per 100 wide)
    const el = { id:`shape-${Date.now()}`, type:"illustration", illustrationId:null,
      illustrationSrc:`/shapes/${item.file}`, label:item.label,
      x:130, y:120, width:120, height:Math.max(6, 120 * vbH / 100),
      color:"#3A3028", rotation:0, stretch:true };
    setElements(els => [...els, el]); setSelectedId(el.id); setShowShapes(false);
  };

  const addToPalette = (hex) => {
    if (!hex || !/^#[0-9A-Fa-f]{6}$/.test(hex)) return;
    setPalette(rows => {
      const flat = rows.flat();
      if (flat.includes(hex)) return rows;
      // Append to last row (user's custom additions)
      const next = rows.map(r => [...r]);
      next[next.length - 1] = [...next[next.length - 1], hex];
      return next;
    });
  };

  const updateEl = (patch) => setElements(els => els.map(el => selectedIds.includes(el.id) ? { ...el, ...patch } : el));

  const handleGroupDragStart = useCallback((e, measuredBbox) => {
    e.stopPropagation(); e.preventDefault();
    // Snapshot positions of all selected elements at drag start
    const sel = (elementsRef.current ?? []).filter(el => selectedIds.includes(el.id));
    const startPositions = sel.map(el => ({ id: el.id, x: el.x, y: el.y }));
    if (!sel.length) return;

    // Use the DOM-measured bbox passed from GroupBoundingBox when available —
    // it reflects the actual rendered text width rather than the wider container
    // box (el.width), giving accurate centre/edge snap alignment.
    let groupMinX, groupMinY, groupW, groupH;
    if (measuredBbox) {
      groupMinX = measuredBbox.minX;
      groupMinY = measuredBbox.minY;
      groupW    = measuredBbox.w;
      groupH    = measuredBbox.h;
    } else {
      // Fallback: compute from element data
      let gMaxX = -Infinity, gMaxY = -Infinity;
      groupMinX = Infinity; groupMinY = Infinity;
      sel.forEach(el => {
        const w = el.width || 100, h = el.height || el.fontSize || 20;
        groupMinX = Math.min(groupMinX, el.x);
        groupMinY = Math.min(groupMinY, el.y);
        gMaxX = Math.max(gMaxX, el.x + w);
        gMaxY = Math.max(gMaxY, el.y + h);
      });
      groupW = gMaxX - groupMinX;
      groupH = gMaxY - groupMinY;
    }

    const startMx = e.clientX, startMy = e.clientY;
    const selIds = selectedIds.slice();

    const move = (ev) => {
      const dx = (ev.clientX - startMx) / fitRef.current;
      const dy = (ev.clientY - startMy) / fitRef.current;
      // Snap the group bbox as if it were a single element. All selected
      // elements are excluded from the snap-target list so they only snap to
      // canvas guides + other unselected elements.
      const rawX = groupMinX + dx, rawY = groupMinY + dy;
      const snapped = handleSnap(rawX, rawY, groupW, groupH, selIds);
      const snapDx = snapped.x - groupMinX;
      const snapDy = snapped.y - groupMinY;
      groupDragRef.current = { lastDx: snapDx, lastDy: snapDy };
      const base = elementsRef.current ?? [];
      setStaged(base.map(el => {
        const sp = startPositions.find(s => s.id === el.id);
        if (!sp) return el;
        return { ...el, x: sp.x + snapDx, y: sp.y + snapDy };
      }));
    };
    const up = () => {
      const dx = groupDragRef.current?.lastDx ?? 0;
      const dy = groupDragRef.current?.lastDy ?? 0;
      const base = elementsRef.current ?? [];
      setStaged(null);
      setElements(base.map(el => {
        const sp = startPositions.find(s => s.id === el.id);
        if (!sp) return el;
        return { ...el, x: sp.x + dx, y: sp.y + dy };
      }));
      groupDragRef.current = null;
      handleSnapEnd();
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }, [selectedIds, setElements, handleSnap, handleSnapEnd]);

  const handleGroupResize = useCallback((origEls, groupX, groupY, ratio, commit) => {
    if (!origEls || !origEls.length) return;
    const base = elementsRef.current ?? [];
    const next = base.map(el => {
      const orig = origEls.find(o => o.id === el.id);
      if (!orig) return el;
      const relX = orig.x - groupX;
      const relY = orig.y - groupY;
      const updates = {
        x: Math.round(groupX + relX * ratio),
        y: Math.round(groupY + relY * ratio),
        width:  orig.width  ? Math.max(20, Math.round(orig.width  * ratio)) : el.width,
        height: orig.height ? Math.max(10, Math.round(orig.height * ratio)) : el.height,
      };
      if (el.type === "text" && orig.fontSize) {
        updates.fontSize = Math.max(6, Math.round(orig.fontSize * ratio));
      }
      return { ...el, ...updates };
    });
    if (commit) {
      setStaged(null);
      setElements(next);
    } else {
      setStaged(next);
    }
  }, [setElements]);

  // ── SIZES (landing page) ─────────────────────────────────────────────────
  // Shared page chrome for the browse stages
  const BrowseHeader = ({ crumbs, title, sub }) => (
    <div style={{padding:"40px 40px 24px",borderBottom:"1px solid rgba(180,165,150,0.25)"}}>
      {crumbs && (
        <div style={{display:"flex",gap:6,marginBottom:10,fontSize:11,color:"#9A8F85",letterSpacing:1,flexWrap:"wrap"}}>
          {crumbs.map((c, i) => (
            <span key={i}>
              <span onClick={c.go} style={{cursor:"pointer"}}>{c.label}</span>
              {i < crumbs.length - 1 && <span style={{margin:"0 4px",opacity:0.6}}>/</span>}
            </span>
          ))}
        </div>
      )}
      <div style={{fontSize:10,letterSpacing:4,color:"#9A8F85",marginBottom:6}}>BESPOKE LINEN SIGNS</div>
      <div style={{fontSize:32,color:"#3A3028",fontWeight:"normal"}}>{title}</div>
      {sub && <div style={{fontSize:14,color:"#9A8F85",marginTop:10,maxWidth:520}}>{sub}</div>}
    </div>
  );
  const cardHover = {
    onMouseEnter: e => { e.currentTarget.style.transform="translateY(-3px)"; e.currentTarget.style.boxShadow="0 8px 32px rgba(0,0,0,0.12)"; },
    onMouseLeave: e => { e.currentTarget.style.transform="none"; e.currentTarget.style.boxShadow="0 2px 20px rgba(0,0,0,0.06)"; },
  };

  // ── LOADING (deep link resolving) ────────────────────────────────────────
  if (stage === "loading") {
    return (
      <div style={{minHeight:"100vh",background:"#F7F3EE",fontFamily:"Georgia,serif",
        display:"flex",alignItems:"center",justifyContent:"center",color:"#8A7B6C",
        fontSize:13,letterSpacing:2}}>
        OPENING YOUR DESIGN…
      </div>
    );
  }

  // ── GROUPS (landing page) ────────────────────────────────────────────────
  if (stage === "groups") {
    return (
      <div style={{minHeight:"100vh",background:"#F7F3EE",fontFamily:"Georgia,serif"}}>
        <BrowseHeader title="What are you creating?" sub="Choose a product to get started."/>
        <div style={{padding:"32px 40px",display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(230px, 1fr))",gap:20,alignItems:"start"}}>
          {Object.entries(PRODUCT_GROUPS).map(([key, g]) => {
            const count = g.types.reduce((n, t) => n + templatesForGroupType(key, t).length, 0);
            return (
              <div key={key} onClick={() => { setPickedGroup(key); setPickedType(null); setPickedCollection(null); setPickedSize(null); setStage("types"); }}
                style={{cursor:"pointer",padding:"16px 16px 24px",background:"#fff",borderRadius:8,
                  boxShadow:"0 2px 20px rgba(0,0,0,0.06)",transition:"transform 0.2s, box-shadow 0.2s"}}
                {...cardHover}>
                <BrowseImage src={`/browse/group-${key}.jpg`} ratio="4/3"/>
                <div style={{fontSize:18,color:"#3A3028",letterSpacing:0.5,marginTop:14}}>{g.label}</div>
                <div style={{fontSize:12,color:"#9A8F85",marginTop:8,lineHeight:1.6}}>{g.blurb}</div>
                <div style={{fontSize:9,color:"#9A8F85",letterSpacing:1.5,marginTop:12}}>
                  {count > 0 ? `${count} TEMPLATE${count!==1?"S":""}` : "COMING SOON"}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{padding:"0 40px 40px"}}>
          <span onClick={() => { setPickedGroup(null); setPickedType(null); setPickedCollection(null); setPickedSize(null); setStage("gallery"); }}
            style={{cursor:"pointer",fontSize:12,letterSpacing:2,color:"#6B5E52",
              borderBottom:"1px solid rgba(138,123,108,0.5)",paddingBottom:2}}>
            VIEW ALL TEMPLATES ON ONE PAGE →
          </span>
        </div>
      </div>
    );
  }

  // ── TYPES (within a product group) ───────────────────────────────────────
  if (stage === "types") {
    const group = PRODUCT_GROUPS[pickedGroup] || PRODUCT_GROUPS.fabric;
    return (
      <div style={{minHeight:"100vh",background:"#F7F3EE",fontFamily:"Georgia,serif"}}>
        <BrowseHeader
          crumbs={[{ label:"← All Products", go:() => setStage("groups") }]}
          title={group.label}
          sub={`Choose your ${pickedGroup === "invitations" ? "stationery" : "sign"} type.`}/>
        <div style={{padding:"32px 40px",display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(210px, 1fr))",gap:16,alignItems:"start"}}>
          {group.types.map((typeKey) => {
            const count = templatesForGroupType(pickedGroup, typeKey).length;
            const soon = count === 0;
            return (
              <div key={typeKey}
                onClick={soon ? undefined : () => { setPickedType(typeKey); setPickedCollection(null); setPickedSize(null); setStage("collections"); }}
                style={{cursor:soon?"default":"pointer",padding:"14px 14px 20px",background:soon?"rgba(255,255,255,0.45)":"#fff",borderRadius:8,
                  opacity:soon?0.55:1,
                  boxShadow:"0 2px 20px rgba(0,0,0,0.06)",transition:"transform 0.2s, box-shadow 0.2s"}}
                {...(soon ? {} : cardHover)}>
                <BrowseImage src={`/browse/type-${typeKey}.jpg`} ratio="4/3"/>
                <div style={{fontSize:14,color:"#3A3028",letterSpacing:0.5,marginTop:12}}>{SIGN_TYPES[typeKey]?.label || typeKey}</div>
                <div style={{fontSize:9,color:"#9A8F85",letterSpacing:1.5,marginTop:8}}>
                  {soon ? "COMING SOON" : `${count} TEMPLATE${count!==1?"S":""}`}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── COLLECTIONS (design collection within a type) ────────────────────────
  if (stage === "collections") {
    const group = PRODUCT_GROUPS[pickedGroup];
    const entries = Object.entries(COLLECTIONS).filter(([key, c]) =>
      c.main || templatesForGroupType(pickedGroup, pickedType, key).length > 0
    );
    return (
      <div style={{minHeight:"100vh",background:"#F7F3EE",fontFamily:"Georgia,serif"}}>
        <BrowseHeader
          crumbs={[
            { label:"All Products",  go:() => setStage("groups") },
            { label:group?.label || "Products", go:() => setStage("types") },
            { label:SIGN_TYPES[pickedType]?.label || pickedType, go:() => setStage("types") },
          ]}
          title="Choose your design collection"
          sub="Each collection carries its style across signage, stationery and invitations."/>
        <div style={{padding:"32px 40px",display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(210px, 1fr))",gap:16,alignItems:"start"}}>
          {entries.map(([key, c]) => {
            const count = templatesForGroupType(pickedGroup, pickedType, key).length;
            const soon = count === 0;
            return (
              <div key={key}
                onClick={soon ? undefined : () => { setPickedCollection(key); setPickedSize(null); setStage("sizes"); }}
                style={{cursor:soon?"default":"pointer",padding:"14px 14px 20px",background:soon?"rgba(255,255,255,0.45)":"#fff",borderRadius:8,
                  opacity:soon?0.55:1,
                  boxShadow:"0 2px 20px rgba(0,0,0,0.06)",transition:"transform 0.2s, box-shadow 0.2s"}}
                {...(soon ? {} : cardHover)}>
                <BrowseImage src={`/browse/collection-${key}.jpg`} ratio="4/3"/>
                <div style={{fontSize:15,color:"#3A3028",letterSpacing:0.5,marginTop:12}}>{c.label}</div>
                <div style={{fontSize:9,color:"#9A8F85",letterSpacing:1.5,marginTop:8}}>
                  {soon ? "COMING SOON" : `${count} DESIGN${count!==1?"S":""}`}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── SIZES ────────────────────────────────────────────────────────────────
  if (stage === "sizes") {
    const group = pickedGroup ? PRODUCT_GROUPS[pickedGroup] : null;
    const sizeKeys = group ? group.sizes : Object.keys(SIZES);
    const countFor = (key) => TEMPLATES.filter(t =>
      (!pickedType || t.category === pickedType) &&
      (!pickedCollection || t.collection === pickedCollection) &&
      (!t.availableSizes || t.availableSizes.includes(key))
    ).length;
    const crumbs = group
      ? [
          { label:"All Products", go:() => setStage("groups") },
          { label:group.label,    go:() => setStage("types")  },
          ...(pickedType ? [{ label:SIGN_TYPES[pickedType]?.label || pickedType, go:() => setStage("collections") }] : []),
          ...(pickedCollection ? [{ label:COLLECTIONS[pickedCollection]?.label || pickedCollection, go:() => setStage("collections") }] : []),
        ]
      : null;
    return (
      <div style={{minHeight:"100vh",background:"#F7F3EE",fontFamily:"Georgia,serif"}}>
        <BrowseHeader crumbs={crumbs} title="Choose your size"
          sub={group ? `Sizes available for ${(SIGN_TYPES[pickedType]?.label || group.label).toLowerCase()}.` : "Pick a sign size to browse its templates."}/>
        <div style={{padding:"32px 40px",display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(160px, 1fr))",gap:20,alignItems:"start"}}>
          {sizeKeys.map((key) => {
            const s = SIZES[key];
            if (!s) return null;
            const count = countFor(key);
            const empty = count === 0;
            if (group && empty) return null; // only offer sizes the collection actually has
            return (
              <div key={key} onClick={empty ? undefined : () => { setPickedSize(key); setStage("gallery"); }}
                style={{cursor:empty?"default":"pointer",display:"flex",flexDirection:"column",gap:10,alignItems:"center",
                  padding:"16px 14px 20px",background:empty?"rgba(255,255,255,0.45)":"#fff",borderRadius:8,opacity:empty?0.55:1,
                  boxShadow:"0 2px 20px rgba(0,0,0,0.06)",transition:"transform 0.2s, box-shadow 0.2s"}}
                {...(empty ? {} : cardHover)}>
                <BrowseImage src={`/browse/size-${key}.jpg`} ratio="4/3"
                  fallback={
                    <div style={{height:78,display:"flex",alignItems:"center",justifyContent:"center"}}>
                      <div style={{width:Math.max(40, 70 * s.w / Math.max(s.w,s.h)),height:Math.max(40, 70 * s.h / Math.max(s.w,s.h)),
                        background:"#E9E2D8",border:"1px solid rgba(180,165,150,0.35)",borderRadius:4}}/>
                    </div>
                  }/>
                <div style={{fontSize:13,color:"#3A3028",letterSpacing:0.5}}>{s.label}</div>
                <div style={{fontSize:9,color:"#9A8F85",letterSpacing:1}}>{empty ? "coming soon" : `${count} template${count!==1?"s":""}`}</div>
              </div>
            );
          })}
          {!group && (
            <div onClick={() => { setPickedSize(null); setStage("gallery"); }}
              style={{cursor:"pointer",display:"flex",flexDirection:"column",gap:10,alignItems:"center",justifyContent:"center",
                padding:"24px 16px",background:"transparent",border:"1px dashed #C5B9AC",borderRadius:8,color:"#9A8F85",fontSize:12,letterSpacing:1}}>
              View all templates →
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── GALLERY ──────────────────────────────────────────────────────────────
  if (stage === "gallery") {
    const filterType = urlParams.type || pickedType;
    const filterColl = urlParams.collection || pickedCollection;
    const filterSize = urlParams.size || pickedSize;
    const signLabel  = filterType ? (SIGN_TYPES[filterType]?.label || filterType) : null;
    const collLabel  = filterColl ? (COLLECTIONS[filterColl]?.label || filterColl) : null;
    const sizeLabel  = filterSize ? (SIZES[filterSize]?.label || filterSize) : null;
    const lockedSize = filterSize && SIZES[filterSize] ? filterSize : null;

    const galleryGroup = PRODUCT_GROUPS[urlParams.group || pickedGroup] || null;
    let matched = TEMPLATES.filter(t => {
      const typeOk = !filterType || t.category === filterType;
      const collOk = !filterColl || t.collection === filterColl;
      const sizeOk = !filterSize || !t.availableSizes || t.availableSizes.includes(filterSize);
      // material gate only applies when browsing within a product group
      const matOk = !galleryGroup || !filterType ||
        (galleryGroup.material ? t.material === galleryGroup.material : !t.material);
      return typeOk && collOk && sizeOk && matOk;
    });
    if (lockedSize) matched = matched.map(t => ({ ...t, sizeKey: lockedSize }));

    const showAll = !filterType && !filterColl && !filterSize;
    const gallerySlots = showAll ? matched.filter(t => !t.placeholder) : matched;

    return (
      <div style={{minHeight:"100vh",background:"#F7F3EE",fontFamily:"Georgia,serif"}}>
        <div style={{padding:"40px 40px 24px",borderBottom:"1px solid rgba(180,165,150,0.25)"}}>
          {!urlParams.size && !urlParams.type && (
            <div style={{display:"flex",gap:6,fontSize:11,color:"#9A8F85",letterSpacing:1,marginBottom:10,flexWrap:"wrap"}}>
              <span onClick={() => setStage("groups")} style={{cursor:"pointer"}}>All Products</span>
              {pickedGroup && PRODUCT_GROUPS[pickedGroup] && (
                <><span style={{opacity:0.6}}>/</span>
                <span onClick={() => setStage("types")} style={{cursor:"pointer"}}>{PRODUCT_GROUPS[pickedGroup].label}</span></>
              )}
              {pickedCollection && COLLECTIONS[pickedCollection] && (
                <><span style={{opacity:0.6}}>/</span>
                <span onClick={() => setStage("collections")} style={{cursor:"pointer"}}>{COLLECTIONS[pickedCollection].label}</span></>
              )}
              {!showAll && (<>
                <span style={{opacity:0.6}}>/</span>
                <span onClick={() => setStage("sizes")} style={{cursor:"pointer"}}>Sizes</span>
              </>)}
            </div>
          )}
          <div style={{fontSize:10,letterSpacing:4,color:"#9A8F85",marginBottom:6}}>BESPOKE LINEN SIGNS</div>
          <div style={{fontSize:32,color:"#3A3028",fontWeight:"normal"}}>{signLabel || (showAll ? "All Templates" : "Choose Your Design")}</div>
          {collLabel && (
            <div style={{fontSize:15,letterSpacing:3,color:"#9A8F85",marginTop:10}}>{collLabel.toUpperCase()} COLLECTION</div>
          )}
          {sizeLabel && (
            <div style={{fontSize:15,color:"#9A8F85",marginTop:6}}>Size {sizeLabel}</div>
          )}
          <div style={{fontSize:14,color:"#9A8F85",marginTop:10,maxWidth:500}}>
            {filterType
              ? `${matched.length} design${matched.length !== 1 ? "s" : ""} available. Select one to personalise.`
              : "Select a template, then personalise every detail."}
          </div>
        </div>
        <div style={{padding:"32px 40px",display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(130px, 1fr))",gap:20,alignItems:"start"}}>
          {gallerySlots.map((tmpl) => {
            const s = SIZES[tmpl.sizeKey] || SIZES["700x2000"];
            return (
              <div key={tmpl.id} style={{display:"flex",flexDirection:"column",gap:8}}>
                <div onClick={() => openTemplate(tmpl)}
                  style={{background:tmpl.background,borderRadius:8,aspectRatio:`${s.w}/${s.h}`,
                    cursor:"pointer",position:"relative",overflow:"hidden",
                    boxShadow:"0 2px 20px rgba(0,0,0,0.08)",transition:"transform 0.2s, box-shadow 0.2s"}}
                  onMouseEnter={e => { e.currentTarget.style.transform="translateY(-3px)"; e.currentTarget.style.boxShadow="0 8px 32px rgba(0,0,0,0.14)"; }}
                  onMouseLeave={e => { e.currentTarget.style.transform="none"; e.currentTarget.style.boxShadow="0 2px 20px rgba(0,0,0,0.08)"; }}>
                  <TemplatePreview tmpl={tmpl}/>
                  <LinenTexture uid={tmpl.id}/>
                </div>
                <div>
                  <div style={{fontSize:12,color:"#3A3028",letterSpacing:0.5,lineHeight:1.4}}>{tmpl.name}</div>
                  {showAll && (
                    <div style={{fontSize:9.5,color:"#9A8F85",letterSpacing:0.5,marginTop:3,lineHeight:1.4}}>
                      {(SIGN_TYPES[tmpl.category]?.label || tmpl.category)} · {(SIZES[tmpl.sizeKey]?.label || tmpl.sizeKey)}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── EDITOR ────────────────────────────────────────────────────────────────
  // Compute linen texture opacity — reduce for very light/white backgrounds
  // Parse bg colour brightness to decide texture strength
  const linenOpacity = (() => {
    try {
      const hex = bgColour.replace("#","");
      const r = parseInt(hex.slice(0,2),16), g = parseInt(hex.slice(2,4),16), b = parseInt(hex.slice(4,6),16);
      const brightness = (r*299 + g*587 + b*114) / 1000; // 0-255
      // Locked paper colour (coloured stock / envelope) or preview bg
      // override: the background IS the paper — no fabric texture on it.
      if (urlParams.lockbg || (urlParams.preview && urlParams.bg)) return 0;
      if (!showLinenTexture) return 0;    // user toggled off
      if (brightness > 220) return 0;    // near-white: no texture
      if (brightness > 200) return 0.08; // light: subtle texture
      return 0.18;                        // normal
    } catch { return 0.18; }
  })();

  const { cw, ch } = canvasDims(template?.sizeKey);
  // Preview mode (?preview=1): canvas only, scaled to fill the viewport,
  // chrome hidden, no interaction. Used by the flow demo's suite mock-up
  // and the future watermarked-preview feature.
  const isPreview = urlParams.preview;
  const maxH = typeof window !== "undefined" ? window.innerHeight - 120 : 700;
  const winW = typeof window !== "undefined" ? window.innerWidth : 800;
  // Preview fills its window edge to edge (cover, not contain): the embedding
  // page sizes the frame to the template's aspect, so designs print full bleed
  // with at most a pixel or two clipped by rounding.
  const winH = typeof window !== "undefined" ? window.innerHeight : 700;
  const baseFit = isPreview
    ? Math.max(winH / ch, winW / cw)
    : Math.min(maxH / ch, 460 / cw, 1);
  const fit  = baseFit * zoom;
  fitRef.current = fit; // keep ref in sync so callbacks can read it
  const dispW = Math.round(cw * fit), dispH = Math.round(ch * fit);
  const zoomPct = Math.round(zoom * 100);

  return (
    <div style={{height:"100vh",background:isPreview?(urlParams.bg?"#"+urlParams.bg:"#FFFFFF"):"#F7F3EE",fontFamily:"Georgia,serif",display:"flex",flexDirection:"column",overflow:"hidden"}}>

      {/* Top bar */}
      <div style={{display:isPreview?"none":"flex",alignItems:"center",justifyContent:"space-between",
        padding:"10px 20px",background:"rgba(255,255,255,0.78)",backdropFilter:"blur(12px)",
        borderBottom:"1px solid rgba(180,165,150,0.25)",flexShrink:0,zIndex:50}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <button onClick={() => setStage("gallery")}
            style={{background:"none",border:"none",cursor:"pointer",color:"#9A8F85",fontSize:12,letterSpacing:1,padding:0}}>
            ← All Designs
          </button>
          <div style={{width:1,height:16,background:"rgba(180,165,150,0.4)"}}/>
          <div style={{fontSize:13,color:"#3A3028"}}>{template?.name}</div>
          <div style={{fontSize:10,color:"#9A8F85",letterSpacing:1,background:"rgba(180,165,150,0.15)",padding:"3px 8px",borderRadius:10}}>
            {(SIZES[template?.sizeKey] || SIZES["700x2000"]).label}
          </div>
          {urlParams.type && (
            <div style={{fontSize:10,color:"#8A7B6C",letterSpacing:1,background:"rgba(138,123,108,0.1)",padding:"3px 8px",borderRadius:10}}>
              {SIGN_TYPES[urlParams.type]?.label || urlParams.type}
            </div>
          )}
          <div style={{display:"flex",gap:4,marginLeft:4}}>
            {[
              { label:"↩ Undo", action:() => { undo(); setStaged(null); }, disabled:!canUndo, tip:"Ctrl+Z" },
              { label:"↪ Redo", action:() => { redo(); setStaged(null); }, disabled:!canRedo, tip:"Ctrl+Y" },
            ].map(btn => (
              <button key={btn.label} onClick={btn.action} disabled={btn.disabled} title={btn.tip}
                style={{padding:"5px 10px",fontSize:10,letterSpacing:1,
                  border:"1px solid rgba(180,165,150,0.3)",borderRadius:6,
                  background:"transparent",cursor:btn.disabled?"not-allowed":"pointer",
                  color:btn.disabled?"#C5B9AC":"#6B5E52",fontFamily:"Georgia,serif"}}>
                {btn.label}
              </button>
            ))}
          </div>
          {/* Duplicate & Delete — only shown when something is selected */}
          {selectedIds.length > 0 && (
            <div style={{display:"flex",gap:4,marginLeft:4}}>
              <button onClick={duplicateSelected} title="Duplicate"
                style={{padding:"5px 10px",fontSize:10,letterSpacing:1,
                  border:"1px solid rgba(180,165,150,0.3)",borderRadius:6,
                  background:"transparent",cursor:"pointer",
                  color:"#6B5E52",fontFamily:"Georgia,serif"}}>
                ⧉ Duplicate
              </button>
              <button onClick={deleteSelected} title="Delete"
                style={{padding:"5px 10px",fontSize:10,letterSpacing:1,
                  border:"1px solid rgba(180,80,80,0.3)",borderRadius:6,
                  background:"transparent",cursor:"pointer",
                  color:"#C07070",fontFamily:"Georgia,serif"}}>
                ✕ Delete
              </button>
            </div>
          )}
          {/* Zoom controls */}
          <div style={{display:"flex",alignItems:"center",gap:2,marginLeft:8,
            border:"1px solid rgba(180,165,150,0.3)",borderRadius:6,padding:2}}>
            <button onClick={() => setZoom(z => Math.max(0.25, +(z - 0.1).toFixed(2)))}
              title="Zoom out (Ctrl+−)"
              style={{padding:"3px 8px",fontSize:13,lineHeight:1,
                border:"none",background:"transparent",cursor:"pointer",color:"#6B5E52",
                fontFamily:"Georgia,serif"}}>−</button>
            <button onClick={() => setZoom(1)} title="Reset zoom (Ctrl+0)"
              style={{padding:"3px 8px",fontSize:10,letterSpacing:0.5,minWidth:42,
                border:"none",background:"transparent",cursor:"pointer",color:"#6B5E52",
                fontFamily:"Georgia,serif"}}>{zoomPct}%</button>
            <button onClick={() => setZoom(z => Math.min(4, +(z + 0.1).toFixed(2)))}
              title="Zoom in (Ctrl+=)"
              style={{padding:"3px 8px",fontSize:13,lineHeight:1,
                border:"none",background:"transparent",cursor:"pointer",color:"#6B5E52",
                fontFamily:"Georgia,serif"}}>+</button>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          {urlParams.dev && (
            <button
              onClick={() => {
                const json = JSON.stringify(displayElements, null, 2);
                navigator.clipboard.writeText(json).then(() => {
                  alert("Template JSON copied to clipboard!\n\nPaste it into your chat with Claude to update the template.");
                }).catch(() => {
                  // Fallback: open in a new tab as a data URI
                  const win = window.open();
                  win.document.write("<pre style='font-size:12px;padding:16px'>" + json.replace(/</g,"&lt;") + "</pre>");
                });
              }}
              style={{padding:"9px 14px",fontSize:11,letterSpacing:1,
                background:"rgba(74,103,65,0.12)",border:"1px solid rgba(74,103,65,0.5)",
                borderRadius:6,cursor:"pointer",color:"#4A6741",fontFamily:"Georgia,serif"}}>
              📋 Copy Template JSON
            </button>
          )}
          <button onClick={() => setShowSaveModal(true)}
            style={{display:"flex",alignItems:"center",gap:6,padding:"9px 16px",
              background:savedPulse?"rgba(74,103,65,0.15)":"rgba(255,255,255,0.7)",
              border:"1px solid rgba(138,123,108,0.4)",borderRadius:6,cursor:"pointer",
              fontSize:11,letterSpacing:1,color:savedPulse?"#4A6741":"#6B5E52",
              fontFamily:"Georgia,serif",transition:"all 0.2s"}}>
            <span style={{fontSize:13}}>💾</span>
            {userEmail ? "SAVED ✓" : "SAVE DESIGN"}
          </button>
          <button onClick={() => {
              const variantId = urlParams.variant;
              if (!variantId) {
                setExportMsg("Missing variant — please return to the product page and click Customise Your Sign.");
                setTimeout(() => setExportMsg(null), 6000);
                return;
              }
              const designPayload = {
                templateId:   template?.id,
                templateName: template?.name,
                sizeKey:      template?.sizeKey,
                background:   bgColour,
                elements:     elements,
                ...(multiPageEnabled && pages.length > 1 ? { pages: allPages() } : {}),
              };
              const sizeLabel = SIZES[template?.sizeKey]?.label || template?.sizeKey || "";
              const summary   = (template?.name || "Custom Design") + (sizeLabel ? " (" + sizeLabel + ")" : "");
              try {
                window.parent.postMessage({
                  type:    "linenSignAddToCart",
                  variant: variantId,
                  design:  JSON.stringify(designPayload),
                  summary: summary,
                }, "*");
                setExportMsg("Adding to cart…");
              } catch (e) {
                setExportMsg("Could not send to cart: " + (e.message || "unknown error"));
                setTimeout(() => setExportMsg(null), 6000);
              }
            }}
            style={{background:"#3A3028",color:"#F5F0E8",border:"none",borderRadius:6,
              padding:"10px 24px",fontSize:11,letterSpacing:2,cursor:"pointer",fontFamily:"Georgia,serif"}}
            onMouseEnter={e => e.target.style.background="#5A4A3C"}
            onMouseLeave={e => e.target.style.background="#3A3028"}>
            ADD TO CART
          </button>
          <button onClick={()=>{
              const j=JSON.stringify({id:template.id,name:template.name,category:template.category,availableSizes:template.availableSizes,sizeKey:template.sizeKey,background:bgColour,elements:elements,
                ...(multiPageEnabled && pages.length > 1 ? { pages: allPages() } : {})},null,2);
              navigator.clipboard.writeText(j);
              alert('Design JSON copied to clipboard!');
            }} style={{padding:"9px 16px",fontSize:11,letterSpacing:1,border:"1px solid #4A6741",borderRadius:6,background:"rgba(74,103,65,0.15)",cursor:"pointer",color:"#4A6741",fontFamily:"Georgia,serif"}}>
              ⬇ Save JSON
            </button>
          <button onClick={() => { setLoadJsonText(""); setLoadJsonErr(""); setShowLoadJsonModal(true); }}
            style={{padding:"9px 16px",fontSize:11,letterSpacing:1,border:"1px solid #8B6F47",borderRadius:6,background:"rgba(139,111,71,0.12)",cursor:"pointer",color:"#8B6F47",fontFamily:"Georgia,serif"}}>
            ⬆ Load JSON
          </button>
        </div>
      </div>

      {exportMsg && (
        <div style={{background:"#4A6741",color:"#F5F0E8",padding:"9px 20px",fontSize:12,textAlign:"center",flexShrink:0}}>
          ✓ {exportMsg}
        </div>
      )}

      <div style={{display:"flex",flex:1,overflow:"hidden",position:"relative"}}>

        {/* Left toolbar */}
        <div style={{width:72,background:"rgba(255,255,255,0.55)",borderRight:"1px solid rgba(180,165,150,0.2)",
          display:isPreview?"none":"flex",flexDirection:"column",alignItems:"center",padding:"16px 0",gap:2,flexShrink:0,zIndex:10}}>
          {[
            { icon:"T",  sublabel:"Add Text",     action:addText,                                          active:false },
            { icon:"✾",  sublabel:"Illustrations",action:() => { setShowLibrary(l => !l); setShowShapes(false); setSelectedId(null); }, active:showLibrary },
            { icon:"◆",  sublabel:"Shapes",       action:() => { setShowShapes(s => !s); setShowLibrary(false); setSelectedId(null); }, active:showShapes },
            { icon:"🖼", sublabel:"Upload Image",  action:() => fileRef.current?.click(),                  active:false },
          ].map(btn => (
            <div key={btn.sublabel} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:3,marginBottom:6}}>
              <button onClick={btn.action} title={btn.sublabel} disabled={btn.disabled}
                style={{width:44,height:44,borderRadius:8,
                  border:btn.active?"1px solid rgba(138,123,108,0.7)":"1px solid rgba(180,165,150,0.3)",
                  background:btn.active?"rgba(138,123,108,0.15)":"transparent",
                  cursor:btn.disabled?"not-allowed":"pointer",
                  fontSize:btn.icon==="T"?15:btn.icon==="⧉"?18:17,
                  color:btn.disabled?"#C5B9AC":"#3A3028",
                  display:"flex",alignItems:"center",justifyContent:"center",
                  fontFamily:"Georgia,serif",transition:"all 0.15s"}}
                onMouseEnter={e => { if (!btn.disabled && !btn.active) e.currentTarget.style.background="rgba(138,123,108,0.1)"; }}
                onMouseLeave={e => { if (!btn.active) e.currentTarget.style.background="transparent"; }}>
                {btn.icon}
              </button>
              <span style={{fontSize:8,letterSpacing:0.5,color:btn.disabled?"#C5B9AC":"#9A8F85",
                fontFamily:"Georgia,serif",textAlign:"center",lineHeight:1.2}}>
                {btn.sublabel}
              </span>
            </div>
          ))}
          <input ref={fileRef} type="file" accept="image/*" onChange={handlePhotoUpload} style={{display:"none"}}/>
          <input ref={fontFileRef} type="file" accept=".ttf,.otf,.woff,.woff2" onChange={handleFontUpload} style={{display:"none"}}/>
        </div>

        {/* Shapes popover */}
        {showShapes && (
          <div style={{position:"absolute",left:80,top:16,zIndex:45,width:228,
            background:"rgba(252,249,245,0.98)",border:"1px solid rgba(180,165,150,0.4)",
            borderRadius:12,boxShadow:"0 12px 48px rgba(0,0,0,0.16)",padding:14,fontFamily:"Georgia,serif"}}>
            <div style={{fontSize:10,letterSpacing:2,color:"#9A8F85",marginBottom:10}}>SHAPES</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
              {[
                { file:"square.svg",      label:"Square" },
                { file:"circle.svg",      label:"Circle" },
                { file:"triangle.svg",    label:"Triangle" },
                { file:"diamond.svg",     label:"Diamond" },
                { file:"star.svg",        label:"Star" },
                { file:"heart.svg",       label:"Heart" },
                { file:"hexagon.svg",     label:"Hexagon" },
                { file:"arch.svg",        label:"Arch" },
                { file:"half-circle.svg", label:"Half Circle", vbH:50 },
                { file:"line.svg",        label:"Line",        vbH:4 },
              ].map(item => (
                <button key={item.file} onClick={() => addShape(item)} title={item.label}
                  style={{border:"1px solid rgba(180,165,150,0.3)",borderRadius:8,background:"#FFFDFA",
                    cursor:"pointer",padding:8,display:"flex",flexDirection:"column",alignItems:"center",gap:5}}
                  onMouseEnter={e => e.currentTarget.style.background="rgba(138,123,108,0.1)"}
                  onMouseLeave={e => e.currentTarget.style.background="#FFFDFA"}>
                  <div style={{width:34,height:34,display:"flex",alignItems:"center",justifyContent:"center"}}>
                    <CustomIllustration src={`/shapes/${item.file}`} width={34} height={item.vbH===4?6:34*(item.vbH||100)/100} color="#6B5E52" stretch={item.vbH===4}/>
                  </div>
                  <span style={{fontSize:8,letterSpacing:0.5,color:"#9A8F85"}}>{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Canvas */}
        {/* NOTE: canvas is centred via margin:auto on the child (not align/justify
            center on this flex parent) — centred flex children that overflow a
            scroll container clip off the top/left with no way to scroll to them. */}
        <div style={{flex:1,display:"flex",padding:isPreview?0:"16px 24px",overflow:isPreview?"hidden":"auto",position:"relative",pointerEvents:isPreview?"none":undefined}}>
          {!isPreview && <TipsPanel/>}
          {/* ── Pages bar (multi-page products: envelopes, menus) ── */}
          {multiPageEnabled && !isPreview && (
            <div style={{position:"absolute",bottom:14,left:"50%",transform:"translateX(-50%)",zIndex:60,
              display:"flex",alignItems:"center",gap:10,padding:"8px 14px",
              background:"rgba(252,249,245,0.96)",border:"1px solid rgba(180,165,150,0.4)",
              borderRadius:24,boxShadow:"0 4px 24px rgba(0,0,0,0.12)",fontFamily:"Georgia,serif"}}>
              <button onClick={() => gotoPage(pageIdx - 1)} disabled={pageIdx === 0}
                style={{border:"none",background:"none",cursor:pageIdx===0?"default":"pointer",
                  fontSize:15,color:pageIdx===0?"#C9BEB2":"#6B5E52",padding:"0 2px"}}>‹</button>
              <span style={{fontSize:11,letterSpacing:1,color:"#3A3028",whiteSpace:"nowrap"}}>
                Page {pageIdx + 1} / {pages.length}
              </span>
              <button onClick={() => gotoPage(pageIdx + 1)} disabled={pageIdx >= pages.length - 1}
                style={{border:"none",background:"none",cursor:pageIdx>=pages.length-1?"default":"pointer",
                  fontSize:15,color:pageIdx>=pages.length-1?"#C9BEB2":"#6B5E52",padding:"0 2px"}}>›</button>
              <span style={{width:1,height:16,background:"rgba(180,165,150,0.4)"}}/>
              <button onClick={addPage} title="Duplicate this page as a new page"
                style={{border:"none",background:"none",cursor:"pointer",fontSize:11,letterSpacing:0.5,
                  color:"#6B5E52",fontFamily:"Georgia,serif",whiteSpace:"nowrap"}}>+ Add page</button>
              {pages.length > 1 && (
                <button onClick={deletePage} title="Delete this page"
                  style={{border:"none",background:"none",cursor:"pointer",fontSize:11,color:"#B05A5A",
                    fontFamily:"Georgia,serif"}}>Delete</button>
              )}
              <span style={{width:1,height:16,background:"rgba(180,165,150,0.4)"}}/>
              <button onClick={() => setShowGuestModal(true)} title="Paste a guest list — one page is created per guest"
                style={{border:"1px solid rgba(138,123,108,0.5)",background:"rgba(138,123,108,0.1)",
                  cursor:"pointer",fontSize:11,letterSpacing:0.5,color:"#3A3028",borderRadius:14,
                  padding:"4px 12px",fontFamily:"Georgia,serif",whiteSpace:"nowrap"}}>
                ✉ Guest list…
              </button>
            </div>
          )}
          <div ref={canvasRef}
            data-canvas-root
            style={{width:dispW,height:dispH,margin:"auto",flexShrink:0,position:"relative",overflow:"hidden",
              background:(isPreview && urlParams.bg) ? "#"+urlParams.bg : bgColour,
              boxShadow:isPreview?"none":"0 8px 60px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.08)",
              borderRadius:isPreview?0:4}}>
            <div
              style={{position:"absolute",inset:0,transform:`scale(${fit})`,transformOrigin:"top left",width:cw,height:ch,
                cursor:marquee?"crosshair":"default"}}
              onMouseDownCapture={e => {
                // ── Geometric hit-testing (capture phase) ─────────────────────
                // CSS pointer-events can mis-target overlapping script-font glyphs
                // because the CSS layout box ≠ visual ink bounds. We use
                // getBoundingClientRect on each element's data-bbox-id node to
                // find the topmost element that geometrically contains the click,
                // then redirect the event if CSS would have targeted the wrong one.
                if (ignoreNextCapture.current) { ignoreNextCapture.current = false; return; }
                if (e.button !== 0) return;
                // Don't intercept clicks inside an active contentEditable (text selection)
                if (e.target?.isContentEditable || e.target?.closest?.('[contenteditable]')) return;

                const cx = e.clientX, cy = e.clientY;
                const currentEls = elementsRef.current ?? [];

                // Walk in reverse DOM order (last = highest z) to find topmost hit
                let geomHitId = null;
                for (let i = currentEls.length - 1; i >= 0; i--) {
                  const el = currentEls[i];
                  if (el.hidden) continue;
                  const node = document.querySelector(`[data-bbox-id="${el.id}"]`);
                  if (!node) continue;
                  const r = node.getBoundingClientRect();
                  if (cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom) {
                    geomHitId = el.id;
                    break;
                  }
                }

                // What CSS naturally targeted via pointer-events
                const cssNode  = e.target?.closest?.('[data-bbox-id]');
                const cssHitId = cssNode?.dataset?.bboxId ?? null;

                if (geomHitId !== null && cssHitId !== null && geomHitId !== cssHitId) {
                  // Geometric test found a specific element CSS missed/got wrong.
                  // Stop the event and re-fire it on the correct node so that
                  // element's onMouseDown (selection + drag) runs instead.
                  e.stopPropagation();
                  ignoreNextCapture.current = true;
                  const correctNode = document.querySelector(`[data-bbox-id="${geomHitId}"]`);
                  correctNode?.dispatchEvent(new MouseEvent("mousedown", {
                    bubbles: true, cancelable: true, view: window,
                    clientX: e.clientX, clientY: e.clientY,
                    shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey,
                    button: e.button, buttons: e.buttons,
                  }));
                }
                // geomHitId === cssHitId → CSS was right, proceed normally.
                // geomHitId === null    → background click, proceed normally
                //   (existing onMouseDown starts marquee selection).
              }}
              onMouseDown={e => {
                // Only start marquee on the background — elements call e.stopPropagation()
                if (e.button !== 0) return;
                // Don't deselect while a text element is being edited
                if (document.activeElement?.isContentEditable) return;
                setSelectedIds([]);
                const rect = canvasRef.current.getBoundingClientRect();
                const startX = (e.clientX - rect.left) / fit;
                const startY = (e.clientY - rect.top) / fit;
                setMarquee({ x:startX, y:startY, w:0, h:0 });
                const move = (ev) => {
                  const mx = (ev.clientX - rect.left) / fit;
                  const my = (ev.clientY - rect.top) / fit;
                  const x = Math.min(startX, mx), y = Math.min(startY, my);
                  const w = Math.abs(mx - startX), h = Math.abs(my - startY);
                  setMarquee({ x, y, w, h });
                  // Hit-test all elements against the marquee box.
                  // Locked and hidden elements are never marquee-selected —
                  // locking exists precisely to keep big background/border
                  // elements out of group selections.
                  const hit = elementsRef.current.filter(el => {
                    if (el.locked || el.hidden) return false;
                    const ew = el.width || 100, eh = el.height || el.fontSize || 20;
                    return el.x < x+w && el.x+ew > x && el.y < y+h && el.y+eh > y;
                  }).map(el => el.id);
                  setSelectedIds(hit);
                };
                const up = () => {
                  setMarquee(null);
                  window.removeEventListener("mousemove", move);
                  window.removeEventListener("mouseup", up);
                };
                window.addEventListener("mousemove", move);
                window.addEventListener("mouseup", up);
              }}>
              <LinenTexture opacity={linenOpacity}/>
              <SnapGuides guideX={guideX} guideY={guideY} guideXKind={guideXKind} guideYKind={guideYKind} cw={cw} ch={ch}/>
              {/* Group bounding box with resize handle */}
              {selectedIds.length > 1 && (
                <GroupBoundingBox
                  selectedIds={selectedIds}
                  elements={staged ?? elementsRef.current ?? []}
                  scale={scale}
                  cw={cw}
                  ch={ch}
                  onGroupResize={handleGroupResize}
                  onGroupDragStart={handleGroupDragStart}/>
              )}
              {/* Marquee rectangle */}
              {marquee && marquee.w > 4 && marquee.h > 4 && (
                <div style={{
                  position:"absolute",
                  left:marquee.x, top:marquee.y, width:marquee.w, height:marquee.h,
                  border:"1.5px dashed #8A7B6C",
                  background:"rgba(138,123,108,0.08)",
                  pointerEvents:"none", zIndex:150,
                  borderRadius:2,
                }}/>
              )}
              {displayElements.filter(el => !el.hidden).map(el => (
                <CanvasElement key={el.id} el={el}
                  selected={selectedIds.includes(el.id)}
                  multiSelect={selectedIds.length > 1}
                  onContextMenu={(id, x, y) => openContextMenu(x, y, id)}
                  onSelect={(id, additive) => {
                    if (additive) setSelectedIds(prev => prev.includes(id) ? prev.filter(x=>x!==id) : [...prev, id]);
                    else setSelectedIds([id]);
                  }}
                  onAddToSelection={(id) => setSelectedIds(prev => prev.includes(id) ? prev : [...prev, id])}
                  onMultiDragStart={() => {
                    const base = elementsRef.current ?? [];
                    return base
                      .filter(e => selectedIds.includes(e.id))
                      .map(e => ({ id: e.id, x: e.x, y: e.y }));
                  }}
                  onChange={(patch) => {
                    if (patch.multiDrag && patch.startPositions) {
                      // Multi-drag: apply dx/dy to each element's snapshotted start position
                      const base = elementsRef.current ?? [];
                      setStaged(base.map(e => {
                        if (e.locked) return e; // locked elements never move with a group
                        const start = patch.startPositions.find(s => s.id === e.id);
                        if (!start) return e;
                        return { ...e, x: start.x + patch.dx, y: start.y + patch.dy };
                      }));
                    } else {
                      updateElementStaged(el.id, patch);
                    }
                  }}
                  onSnap={handleSnap}
                  onSnapEnd={handleSnapEnd}
                  onCommit={commitStaged}
                  scale={scale}
                  onEditStart={(id) => setEditingId(id)}
                  onEditEnd={() => { setEditingId(null); setGlyphPicker(null); }}
                  onEditSelect={(data) => {
                    setGlyphPicker(data);
                    if (data) {
                      // Snapshot the live selection range now — by the time the user
                      // clicks a picker button, mousedown will have cleared it.
                      try {
                        const s = window.getSelection();
                        savedRangeRef.current = (s && s.rangeCount > 0) ? s.getRangeAt(0).cloneRange() : null;
                      } catch { savedRangeRef.current = null; }
                    } else {
                      savedRangeRef.current = null;
                    }
                  }}/>
              ))}
            </div>
          </div>
        </div>

        {/* Right panel */}
        <div style={{width:268,background:"rgba(255,255,255,0.62)",borderLeft:"1px solid rgba(180,165,150,0.2)",
          display:isPreview?"none":undefined,overflowY:"auto",padding:20,flexShrink:0,zIndex:10}}>

          {/* ── Layers panel ── */}
          <div style={{marginBottom:20,paddingBottom:16,borderBottom:"1px solid rgba(180,165,150,0.25)"}}>
            <div style={{fontSize:10,letterSpacing:2,color:"#9A8F85",marginBottom:10}}>LAYERS</div>
            <div style={{display:"flex",flexDirection:"column",gap:1,maxHeight:220,overflowY:"auto"}}>
              {elements.length === 0 && (
                <div style={{fontSize:11,color:"#9A8F85",padding:"6px 0",textAlign:"center"}}>No elements yet</div>
              )}
              {elements.slice().reverse().map(el => {
                const isSelected = selectedIds.includes(el.id);
                const labelText = (() => {
                  if (el.type === "text") {
                    // Strip HTML tags (span feature wrappers, <br>, &nbsp; etc.) before truncating
                    const t = (el.content || "")
                      .replace(/<[^>]*>/g, "")
                      .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
                      .replace(/\s+/g, " ").trim();
                    return t.length > 22 ? t.slice(0, 22) + "…" : (t || "Text");
                  }
                  if (el.type === "illustration") return "✾ " + (el.label || el.illustrationId || "Illustration");
                  if (el.type === "image")        return "▣ Image";
                  if (el.type === "divider")      return "— Divider";
                  return el.type || "Element";
                })();
                return (
                  <div key={el.id}
                    onClick={() => setSelectedIds([el.id])}
                    style={{
                      display:"flex",alignItems:"center",gap:2,padding:"5px 6px",
                      background: isSelected ? "rgba(138,123,108,0.18)" : "transparent",
                      borderRadius:4,cursor:"pointer",fontSize:11,color:"#3A3028",
                      opacity: el.hidden ? 0.5 : 1,
                    }}
                    onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = "rgba(138,123,108,0.08)"; }}
                    onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}>
                    <span style={{flex:1,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",
                      textDecoration: el.hidden ? "line-through" : "none"}}>
                      {labelText}
                    </span>
                    <button onClick={e => { e.stopPropagation(); toggleHidden(el.id); }}
                      title={el.hidden ? "Show" : "Hide"}
                      style={{padding:"2px 4px",fontSize:11,background:"none",border:"none",cursor:"pointer",lineHeight:1,color:"#6B5E52"}}>
                      {el.hidden ? "⊘" : "👁"}
                    </button>
                    <button onClick={e => { e.stopPropagation(); toggleLocked(el.id); }}
                      title={el.locked ? "Unlock" : "Lock"}
                      style={{padding:"2px 4px",fontSize:11,background:"none",border:"none",cursor:"pointer",lineHeight:1,color:el.locked?"#3A3028":"#9A8F85"}}>
                      {el.locked ? "🔒" : "🔓"}
                    </button>
                    <button onClick={e => { e.stopPropagation(); moveOneUp(el.id); }}
                      title="Move layer up" disabled={elements.indexOf(el) === elements.length - 1}
                      style={{padding:"2px 4px",fontSize:11,background:"none",border:"none",cursor:"pointer",lineHeight:1,color:"#6B5E52"}}>↑</button>
                    <button onClick={e => { e.stopPropagation(); moveOneDown(el.id); }}
                      title="Move layer down" disabled={elements.indexOf(el) === 0}
                      style={{padding:"2px 4px",fontSize:11,background:"none",border:"none",cursor:"pointer",lineHeight:1,color:"#6B5E52"}}>↓</button>
                  </div>
                );
              })}
            </div>
          </div>

          {selectedIds.length > 1 ? (
            /* ── Multiple elements selected ── */
            <div>
              <div style={{fontSize:10,letterSpacing:2,color:"#9A8F85",marginBottom:16}}>
                {selectedIds.length} ELEMENTS SELECTED
              </div>
              <div style={{fontSize:12,color:"#6B5E52",lineHeight:1.7,marginBottom:16}}>
                Drag any element to move the group.<br/>
                Drag the <strong style={{fontWeight:"normal",color:"#3A3028"}}>corner handle</strong> on the canvas to resize everything together.<br/>
                Shift+click to add/remove from selection.
              </div>
              <div style={{display:"flex",gap:8,marginBottom:10}}>
                <button onClick={duplicateSelected}
                  style={{flex:1,padding:"7px 0",fontSize:10,letterSpacing:1,
                    border:"1px solid rgba(138,123,108,0.35)",borderRadius:6,background:"transparent",
                    cursor:"pointer",color:"#6B5E52",fontFamily:"Georgia,serif"}}>
                  ⧉ Duplicate All
                </button>
                <button onClick={deleteSelected}
                  style={{flex:1,padding:"7px 0",fontSize:10,letterSpacing:1,
                    border:"1px solid rgba(180,80,80,0.3)",borderRadius:6,background:"transparent",
                    cursor:"pointer",color:"#C07070",fontFamily:"Georgia,serif"}}>
                  ✕ Delete All
                </button>
              </div>
              <button onClick={() => setSelectedIds([])}
                style={{width:"100%",padding:"7px 0",fontSize:10,letterSpacing:1,
                  border:"1px solid rgba(180,165,150,0.3)",borderRadius:6,background:"transparent",
                  cursor:"pointer",color:"#9A8F85",fontFamily:"Georgia,serif"}}>
                Deselect All
              </button>

              {/* Colour — only shown when the selection contains text elements */}
              {displayElements.some(e => selectedIds.includes(e.id) && e.type === "text") && (
                <div style={{marginTop:20,borderTop:"1px solid rgba(180,165,150,0.2)",paddingTop:16}}>
                  <div style={{fontSize:10,letterSpacing:2,color:"#9A8F85",marginBottom:10}}>TEXT COLOUR</div>
                  <div style={{display:"flex",flexDirection:"column",gap:5,marginBottom:10}}>
                    {palette.map((row, ri) => (
                      <div key={ri} style={{display:"flex",gap:7}}>
                        {row.map((hex, i) => (
                          <button key={i} title={hex}
                            onClick={() => updateEl({ color: hex })}
                            style={{width:26,height:26,borderRadius:"50%",border:"none",background:hex,
                              cursor:"pointer",flexShrink:0,
                              boxShadow:"0 1px 4px rgba(0,0,0,0.18)",transition:"transform 0.15s"}}
                            onMouseEnter={e => e.currentTarget.style.transform="scale(1.2)"}
                            onMouseLeave={e => e.currentTarget.style.transform="scale(1)"}/>
                        ))}
                      </div>
                    ))}
                  </div>
                  {/* Custom colour */}
                  <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer"}}>
                    <div style={{width:26,height:26,borderRadius:"50%",border:"1px dashed rgba(138,123,108,0.5)",
                      display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,color:"#9A8F85",flexShrink:0,position:"relative"}}>
                      +
                      <input type="color" defaultValue="#3A3028"
                        onChange={e => updateEl({ color: e.target.value })}
                        style={{opacity:0,position:"absolute",inset:0,width:"100%",height:"100%",cursor:"pointer"}}/>
                    </div>
                    <span style={{fontSize:10,color:"#9A8F85",letterSpacing:1}}>CUSTOM</span>
                  </label>
                </div>
              )}
            </div>
          ) : !selectedEl ? (
            <>
              <div style={{color:"#9A8F85",fontSize:12,textAlign:"center",marginTop:32,lineHeight:1.9,marginBottom:24}}>
                <div style={{fontSize:20,marginBottom:10}}>✦</div>
                Click any element to edit.<br/>
                <span style={{fontSize:9,letterSpacing:1.5,display:"block",marginTop:6}}>CLICK TEXT TO TYPE</span>
                <span style={{fontSize:9,letterSpacing:1.5,display:"block",marginTop:3}}>↻ HANDLE = ROTATE</span>
                <span style={{fontSize:9,letterSpacing:1.5,display:"block",marginTop:3}}>● CORNER = RESIZE</span>
                <span style={{fontSize:9,letterSpacing:1.5,display:"block",marginTop:3}}>CTRL+Z = UNDO</span>
              </div>
              {/* Paper colour locked (coloured stock / envelopes): no bg picker */}
              {!urlParams.lockbg && (
              <div style={{borderTop:"1px solid rgba(180,165,150,0.2)",paddingTop:20}}>
                <div style={{fontSize:10,letterSpacing:2,color:"#9A8F85",marginBottom:12}}>BACKGROUND COLOUR</div>
                <div style={{display:"flex",flexDirection:"column",gap:5,marginBottom:12}}>
                  {palette.map((row, ri) => (
                    <div key={ri} style={{display:"flex",gap:7}}>
                      {row.map((hex, i) => (
                        <button key={i} onClick={() => setBgColour(hex)} title={hex}
                          style={{width:26,height:26,borderRadius:"50%",border:"1px solid rgba(0,0,0,0.1)",
                            background:hex,cursor:"pointer",flexShrink:0,
                            boxShadow:bgColour===hex?"0 0 0 2px #fff,0 0 0 3.5px #8A7B6C":"0 1px 4px rgba(0,0,0,0.12)",
                            transform:bgColour===hex?"scale(1.15)":"scale(1)",transition:"all 0.15s"}}/>
                      ))}
                    </div>
                  ))}
                </div>
                <BgColourPicker value={bgColour} onChange={setBgColour} onSaveToPalette={addToPalette}/>
                <label style={{display:"flex",alignItems:"center",gap:10,marginTop:14,cursor:"pointer"}}>
                  <div style={{position:"relative",width:32,height:18,flexShrink:0}}>
                    <input type="checkbox" checked={showLinenTexture}
                      onChange={e=>setShowLinenTexture(e.target.checked)}
                      style={{opacity:0,width:0,height:0,position:"absolute"}}/>
                    <div style={{position:"absolute",inset:0,borderRadius:9,
                      background:showLinenTexture?"#8A7B6C":"rgba(180,165,150,0.4)",transition:"background 0.2s"}}/>
                    <div style={{position:"absolute",top:2,left:showLinenTexture?14:2,
                      width:14,height:14,borderRadius:"50%",background:"#fff",
                      boxShadow:"0 1px 3px rgba(0,0,0,0.2)",transition:"left 0.2s"}}/>
                  </div>
                  <span style={{fontSize:11,color:"#6B5E52",fontFamily:"Georgia,serif"}}>Linen texture overlay</span>
                </label>
              </div>
              )}
            </>
          ) : (
            <>
              <div style={{fontSize:10,letterSpacing:2,color:"#9A8F85",marginBottom:14}}>
                {{ text:"TEXT PROPERTIES", divider:"DIVIDER", image:"PHOTO", illustration:"ILLUSTRATION" }[selectedEl.type]}
              </div>

              {/* Rotation (text gets it after the font selector below) */}
              {selectedEl.type !== "divider" && selectedEl.type !== "text" && (
                <SliderRow label="ROTATION" value={selectedEl.rotation||0} min={-180} max={180}
                  format={v => `${v}°`}
                  onChange={v => { updateElementStaged(selectedEl.id, {rotation:v}); commitStaged(); }}/>
              )}

              {/* TEXT */}
              {selectedEl.type === "text" && (
                <>
                  <FontDropdown value={selectedEl.fontId}
                    onChange={id => updateEl({fontId:id})}
                    onUpload={() => fontFileRef.current?.click()}/>

                  <SliderRow label="SIZE" value={selectedEl.fontSize} min={6} max={200}
                    onChange={v => updateEl({fontSize:v})}/>
                  <SliderRow label="ROTATION" value={selectedEl.rotation||0} min={-180} max={180}
                    format={v => `${v}°`}
                    onChange={v => { updateElementStaged(selectedEl.id, {rotation:v}); commitStaged(); }}/>
                  <SliderRow label="LINE HEIGHT" value={selectedEl.lineHeight||1.35} min={0.4} max={3} step={0.05}
                    format={v => v.toFixed(2)} onChange={v => updateEl({lineHeight:v})}/>
                  <SliderRow label="LETTER SPACING" value={selectedEl.letterSpacing||0} min={0} max={12}
                    onChange={v => updateEl({letterSpacing:v})}/>
                  <SliderRow label="CURVE" value={selectedEl.curve||0} min={-180} max={180}
                    format={v => v === 0 ? "straight" : `${v}°`}
                    onChange={v => updateEl({curve:v})}/>

                  {/* Stroke */}
                  <div style={{marginBottom:8}}>
                    <SliderRow label="STROKE" value={selectedEl.strokeWidth||0} min={0} max={8} step={0.5}
                      format={v => `${v}px`} onChange={v => updateEl({strokeWidth:v})}/>
                    {(selectedEl.strokeWidth||0) > 0 && (
                      <div>
                        <div style={{fontSize:10,letterSpacing:2,color:"#9A8F85",marginBottom:6}}>STROKE COLOUR</div>
                        <div style={{display:"flex",flexDirection:"column",gap:5,marginBottom:6}}>
                          {palette.map((row, ri) => (
                            <div key={ri} style={{display:"flex",gap:7}}>
                              {row.map((hex, i) => (
                                <button key={i} onClick={() => updateEl({strokeColor:hex})} title={hex}
                                  style={{width:22,height:22,borderRadius:"50%",border:"none",background:hex,cursor:"pointer",flexShrink:0,
                                    boxShadow:(selectedEl.strokeColor||selectedEl.color)===hex?"0 0 0 2px #fff,0 0 0 3.5px #8A7B6C":"0 1px 4px rgba(0,0,0,0.15)",
                                    transform:(selectedEl.strokeColor||selectedEl.color)===hex?"scale(1.15)":"scale(1)",transition:"all 0.15s"}}/>
                              ))}
                            </div>
                          ))}
                          <label style={{width:22,height:22,borderRadius:"50%",border:"1px dashed rgba(138,123,108,0.5)",
                            cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,color:"#9A8F85",flexShrink:0}}>
                            +
                            <input type="color" value={selectedEl.strokeColor||selectedEl.color||"#3A3028"}
                              onChange={e => updateEl({strokeColor:e.target.value})}
                              style={{opacity:0,width:0,height:0,position:"absolute"}}/>
                          </label>
                        </div>
                        <div style={{fontSize:10,color:"#B0A496",fontFamily:"Georgia,serif"}}>
                          Same colour = thicker text. Darker = outline effect.
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Alignment */}
                  <div style={{marginBottom:8}}>
                    <div style={{fontSize:10,letterSpacing:2,color:"#9A8F85",marginBottom:3}}>ALIGNMENT</div>
                    <div style={{display:"flex",gap:6}}>
                      {[
                        {label:"Left",   val:"left",   active:selectedEl.align==="left"},
                        {label:"Centre", val:"center", active:(selectedEl.align??"center")==="center"},
                        {label:"Right",  val:"right",  active:selectedEl.align==="right"},
                      ].map(btn => (
                        <button key={btn.label} onClick={() => updateEl({align:btn.val})}
                          style={{flex:1,padding:"5px 0",fontSize:10,letterSpacing:1,
                            border:"1px solid rgba(138,123,108,0.35)",borderRadius:6,
                            background:btn.active?"rgba(138,123,108,0.15)":"transparent",
                            cursor:"pointer",color:"#3A3028",fontFamily:"Georgia,serif"}}>
                          {btn.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Style */}
                  <div style={{marginBottom:8}}>
                    <div style={{fontSize:10,letterSpacing:2,color:"#9A8F85",marginBottom:3}}>STYLE</div>
                    <button onClick={() => updateEl({italic:!selectedEl.italic})}
                      style={{width:"38%",padding:"5px 0",fontSize:10,letterSpacing:1,
                        border:selectedEl.italic?"1px solid rgba(138,123,108,0.8)":"1px solid rgba(138,123,108,0.35)",
                        borderRadius:6,
                        background:selectedEl.italic?"rgba(138,123,108,0.15)":"transparent",
                        cursor:"pointer",color:"#3A3028",fontFamily:"Georgia,serif",fontStyle:"italic"}}>
                      Italic
                    </button>
                  </div>

                  <SliderRow label="TRANSPARENCY" value={Math.round((selectedEl.opacity ?? 1) * 100)}
                    min={0} max={100} format={v => `${v}%`}
                    onChange={v => updateEl({opacity: v / 100})}/>

                  <ColourPicker value={selectedEl.color} onChange={v => updateEl({color:v})}
                    palette={palette} onAddToPalette={addToPalette}/>
                </>
              )}

              {/* ILLUSTRATION */}
              {selectedEl.type === "illustration" && (
                <>
                  <div style={{marginBottom:10,fontSize:12,color:"#6B5E52",lineHeight:1.7}}>
                    {selectedEl.label}
                  </div>
                  <SliderRow label="SIZE" value={selectedEl.width} min={40} max={360}
                    onChange={v => updateEl({width:v,height:v})}/>
                  <ColourPicker value={selectedEl.color||"#9A8F85"} onChange={v => updateEl({color:v})}
                    palette={palette} onAddToPalette={addToPalette}/>
                </>
              )}

              {/* IMAGE */}
              {selectedEl.type === "image" && (
                <div style={{color:"#6B5E52",fontSize:12,lineHeight:1.8,marginTop:8}}>
                  Photo added ✓<br/>
                  <span style={{color:"#9A8F85",fontSize:11}}>Drag to move · drag corner to resize</span>
                  <br/><br/>
                  <button onClick={() => fileRef.current?.click()}
                    style={{fontSize:11,letterSpacing:1,border:"1px solid rgba(138,123,108,0.4)",
                      background:"transparent",padding:"6px 14px",borderRadius:6,cursor:"pointer",
                      color:"#3A3028",fontFamily:"Georgia,serif"}}>
                    Replace Photo
                  </button>
                </div>
              )}

              {selectedEl.type === "divider" && (
                <div style={{color:"#9A8F85",fontSize:12,marginTop:8}}>Drag to reposition the divider line.</div>
              )}
            </>
          )}
        </div>

        {showLibrary && <IllustrationLibrary onAdd={addIllustration} onClose={() => setShowLibrary(false)}/>}

        {showGuestModal && (
          <GuestListModal
            textEls={(elementsRef.current || []).filter(e => e.type === "text")}
            onApply={applyGuestList}
            onClose={() => setShowGuestModal(false)}/>
        )}

        {/* ── Glyph alternate picker ──────────────────────────────────────── */}
        {glyphPicker && editingId && (() => {
          const editEl = displayElements.find(e => e.id === editingId);
          const font = getAllFonts().find(f => f.id === editEl?.fontId) || FONTS[0];
          // _fontFeatureCache[id]: undefined = probing/never probed, [] = no
          // alternates, [tags] = probed. Only show on a positive probe.
          const supportedTags = _fontFeatureCache[font.id];
          if (!Array.isArray(supportedTags) || supportedTags.length === 0) return null;
          const OT_FEATURES = ALL_OT_FEATURES.filter(f => supportedTags.includes(f.tag));
          if (OT_FEATURES.length === 0) return null;
          return (
            <GlyphAltPopup
              key={`${font.id}|${glyphPicker.text}`}
              font={font} text={glyphPicker.text}
              x={glyphPicker.x} y={glyphPicker.y}
              features={OT_FEATURES}
              onPick={applyGlyphFeature}/>
          );
        })()}

        {contextMenu && (
          <>
            {/* Click-catcher to dismiss */}
            <div onClick={() => setContextMenu(null)}
              onContextMenu={(e) => { e.preventDefault(); setContextMenu(null); }}
              style={{position:"fixed",inset:0,zIndex:9998,background:"transparent"}}/>
            <div style={{
              position:"fixed",
              left: Math.min(contextMenu.x, (typeof window !== "undefined" ? window.innerWidth  : 1000) - 200),
              top:  Math.min(contextMenu.y, (typeof window !== "undefined" ? window.innerHeight : 800)  - 240),
              zIndex:9999,
              minWidth:180,
              background:"#fff",
              border:"1px solid rgba(180,165,150,0.4)",
              borderRadius:6,
              padding:"6px 0",
              boxShadow:"0 8px 24px rgba(0,0,0,0.18)",
              fontFamily:"Georgia,serif",
              userSelect:"none",
            }}>
              {[
                { label: "Duplicate",      action: () => duplicateIds(contextMenu.ids) },
                { label: "Delete",         action: () => deleteIds(contextMenu.ids), divider: true },
                { label: "Bring to front", action: () => bringToFront(contextMenu.ids) },
                { label: "Send to back",   action: () => sendToBack(contextMenu.ids), divider: true },
                {
                  label: (contextMenu.ids.length === 1 &&
                          elementsRef.current.find(e => e.id === contextMenu.ids[0])?.locked)
                          ? "Unlock" : "Lock",
                  action: () => contextMenu.ids.forEach(id => toggleLocked(id)),
                },
                {
                  label: (contextMenu.ids.length === 1 &&
                          elementsRef.current.find(e => e.id === contextMenu.ids[0])?.hidden)
                          ? "Show" : "Hide",
                  action: () => contextMenu.ids.forEach(id => toggleHidden(id)),
                },
              ].map((item, i) => (
                <div key={i}>
                  <div
                    onClick={() => { item.action(); setContextMenu(null); }}
                    style={{
                      padding:"8px 16px",
                      fontSize:12,
                      color:"#3A3028",
                      cursor:"pointer",
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = "rgba(138,123,108,0.12)"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    {item.label}
                  </div>
                  {item.divider && <div style={{height:1,background:"rgba(180,165,150,0.25)",margin:"4px 0"}}/>}
                </div>
              ))}
            </div>
          </>
        )}

        {showLoadJsonModal && (
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center"}}
            onClick={e => { if (e.target === e.currentTarget) setShowLoadJsonModal(false); }}>
            <div style={{background:"#FAF7F2",borderRadius:12,padding:"28px 32px",width:560,maxWidth:"90vw",fontFamily:"Georgia,serif",boxShadow:"0 8px 40px rgba(0,0,0,0.18)"}}>
              <h3 style={{margin:"0 0 6px",fontSize:16,color:"#3A3028",letterSpacing:1}}>Load Design JSON</h3>
              <p style={{margin:"0 0 16px",fontSize:12,color:"#8B7D6B"}}>Paste a previously exported design JSON to restore it into the editor.</p>
              <textarea
                value={loadJsonText}
                onChange={e => { setLoadJsonText(e.target.value); setLoadJsonErr(""); }}
                placeholder='Paste JSON here…'
                style={{width:"100%",height:220,fontFamily:"monospace",fontSize:11,padding:10,border:"1px solid rgba(138,123,108,0.4)",borderRadius:6,background:"#FFF",resize:"vertical",boxSizing:"border-box",color:"#3A3028"}}
              />
              {loadJsonErr && <p style={{color:"#C0392B",fontSize:12,margin:"8px 0 0"}}>{loadJsonErr}</p>}
              <div style={{display:"flex",gap:10,marginTop:16,justifyContent:"flex-end"}}>
                <button onClick={() => setShowLoadJsonModal(false)}
                  style={{padding:"9px 18px",fontSize:11,letterSpacing:1,border:"1px solid rgba(138,123,108,0.4)",borderRadius:6,background:"transparent",cursor:"pointer",color:"#6B5E52",fontFamily:"Georgia,serif"}}>
                  Cancel
                </button>
                <button onClick={() => {
                  try {
                    const parsed = JSON.parse(loadJsonText.trim());
                    if (!parsed.elements || !Array.isArray(parsed.elements)) throw new Error("JSON must have an 'elements' array.");
                    const tmplMeta = {
                      id: parsed.id || "custom",
                      name: parsed.name || "Custom Design",
                      category: parsed.category || "",
                      availableSizes: parsed.availableSizes || [],
                      sizeKey: parsed.sizeKey || "75x100",
                    };
                    setTemplate(prev => ({ ...(prev || {}), ...tmplMeta }));
                    if (parsed.background) setBgColour(parsed.background);
                    resetElements(JSON.parse(JSON.stringify(parsed.elements)));
                    setStage("editor");
                    setShowLoadJsonModal(false);
                    setLoadJsonText("");
                  } catch (e) {
                    setLoadJsonErr("Invalid JSON: " + e.message);
                  }
                }}
                  style={{padding:"9px 22px",fontSize:11,letterSpacing:1,border:"none",borderRadius:6,background:"#3A3028",cursor:"pointer",color:"#F5F0E8",fontFamily:"Georgia,serif"}}>
                  Load Design
                </button>
              </div>
            </div>
          </div>
        )}

        {showSaveModal && (
          <SaveModal
            onClose={() => setShowSaveModal(false)}
            existingEmail={userEmail}
            onSave={(email) => {
              setUserEmail(email);
              setSavedPulse(true);
              setTimeout(() => setSavedPulse(false), 3000);
            }}/>
        )}
      </div>
    </div>
  );
}
