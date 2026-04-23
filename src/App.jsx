import { useState, useRef, useEffect, useCallback } from "react";

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
function getAllFonts() { return [...FONTS, ..._runtimeFonts]; }

// ─── Sizes ────────────────────────────────────────────────────────────────────
const SIZES = {
  "450x1000":  { label:"450mm × 1m",   w:450,  h:1000 },
  "700x1400":  { label:"700mm × 1.4m", w:700,  h:1400 },
  "700x2000":  { label:"700mm × 2m",   w:700,  h:2000 },
  "700x3000":  { label:"700mm × 3m",   w:700,  h:3000 },
  "1400x2000": { label:"1.4m × 2m",    w:1400, h:2000 },
};

const SIGN_TYPES = {
  "wedding-welcome": { label:"Wedding Welcome Sign"  },
  "wedding-seating": { label:"Wedding Seating Chart" },
  "bar-sign":        { label:"Bar Sign"              },
  "memorial":        { label:"Memorial Sign"         },
  "baby-shower":     { label:"Baby Shower Sign"      },
  "birthday":        { label:"Birthday Sign"         },
};

const INTERNAL_W = 400;
function canvasDims(sizeKey) {
  const s = SIZES[sizeKey] || SIZES["700x2000"];
  return { cw: INTERNAL_W, ch: Math.round(INTERNAL_W * s.h / s.w) };
}

// ─── URL param reader ─────────────────────────────────────────────────────────
function getUrlParams() {
  try {
    const p = new URLSearchParams(window.location.search);
    return { type: p.get("type") || null, size: p.get("size") || null };
  } catch { return { type: null, size: null }; }
}

// ─── Snap helpers ─────────────────────────────────────────────────────────────
const SNAP_THRESHOLD = 6;
function getSnapLines(elements, draggingId, cw) {
  const xLines = [0, cw / 2, cw], yLines = [];
  elements.forEach(el => {
    if (el.id === draggingId || el.type === "divider") return;
    const w = el.width || 0, h = el.height || el.fontSize || 0;
    xLines.push(el.x, el.x + w / 2, el.x + w);
    yLines.push(el.y, el.y + h / 2, el.y + h);
  });
  return { xLines: [...new Set(xLines)], yLines: [...new Set(yLines)] };
}
function snapVal(v, lines) {
  for (const l of lines) if (Math.abs(v - l) < SNAP_THRESHOLD) return { snapped: l, guide: l };
  return { snapped: v, guide: null };
}
function applySnap(x, y, w, h, xLines, yLines) {
  const cx = x + w / 2, rx = x + w, cy = y + h / 2, by = y + h;
  const xs = [snapVal(x, xLines), snapVal(cx, xLines), snapVal(rx, xLines)];
  const ys = [snapVal(y, yLines), snapVal(cy, yLines), snapVal(by, yLines)];
  const xOffsets = [0, -w / 2, -w], yOffsets = [0, -h / 2, -h];
  let bestX = null, bestY = null;
  xs.forEach((s, i) => { if (s.guide !== null && (!bestX || Math.abs(s.snapped - [x, cx, rx][i]) < Math.abs(bestX.dist))) bestX = { val: s.snapped + xOffsets[i], guide: s.guide, dist: Math.abs(s.snapped - [x, cx, rx][i]) }; });
  ys.forEach((s, i) => { if (s.guide !== null && (!bestY || Math.abs(s.snapped - [y, cy, by][i]) < Math.abs(bestY.dist))) bestY = { val: s.snapped + yOffsets[i], guide: s.guide, dist: Math.abs(s.snapped - [y, cy, by][i]) }; });
  return { x: bestX ? bestX.val : x, y: bestY ? bestY.val : y, guideX: bestX ? bestX.guide : null, guideY: bestY ? bestY.guide : null };
}

// ─── Undo/redo ────────────────────────────────────────────────────────────────
function useUndoRedo(initial) {
  const [idx, setIdx] = useState(0);
  const [history, setHistory] = useState([initial]);
  const present = history[idx];
  const set = useCallback((next) => {
    const val = typeof next === "function" ? next(history[idx]) : next;
    setHistory(h => [...h.slice(0, idx + 1), val]);
    setIdx(i => i + 1);
  }, [history, idx]);
  const undo = useCallback(() => setIdx(i => Math.max(0, i - 1)), []);
  const redo = useCallback(() => setIdx(i => Math.min(history.length - 1, i + 1)), [history.length]);
  const reset = useCallback((val) => { setHistory([val]); setIdx(0); }, []);
  return { present, set, undo, redo, canUndo: idx > 0, canRedo: idx < history.length - 1, reset };
}

// ─── Illustration library ─────────────────────────────────────────────────────
const ILLUSTRATION_LIBRARY = [
  { category: "Botanicals", items: [
    { id: "il-eucalyptus", label: "Eucalyptus",   svg: "eucalyptus" },
    { id: "il-olive",      label: "Olive Branch",  svg: "olive"      },
    { id: "il-fern",       label: "Fern",          svg: "fern"       },
    { id: "il-rose",       label: "Rose",          svg: "rose"       },
    { id: "il-peony",      label: "Peony",         svg: "peony"      },
    { id: "il-lavender",   label: "Lavender",      svg: "lavender"   },
  ]},
  { category: "Frames", items: [
    { id: "il-arch",    label: "Arch Frame",   svg: "arch"    },
    { id: "il-wreath",  label: "Wreath",       svg: "wreath"  },
    { id: "il-monogram",label: "Monogram Ring",svg: "monogram"},
    { id: "il-corner",  label: "Corner Sprig", svg: "corner"  },
  ]},
  { category: "Wedding", items: [
    { id: "il-rings",    label: "Wedding Rings", svg: "rings"    },
    { id: "il-champagne",label: "Champagne",     svg: "champagne"},
    { id: "il-bow",      label: "Ribbon Bow",    svg: "bow"      },
    { id: "il-heart",    label: "Heart",         svg: "heart"    },
    { id: "il-dove",     label: "Dove",          svg: "dove"     },
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

// ─── Templates ────────────────────────────────────────────────────────────────
const TEMPLATES = [
  { id:"welcome", name:"Welcome to Our Wedding", category:"wedding-welcome", availableSizes:["700x1400","700x2000","700x3000","1400x2000"], sizeKey:"700x2000", background:"#F2EDE4", elements:[
    {id:"e1",type:"text",    content:"Welcome to Our",              x:30,y:80,  fontSize:26,fontId:"cormorant",  italic:true, align:"center",color:"#3A3028",width:340,lineHeight:1.35,rotation:0},
    {id:"e2",type:"text",    content:"Wedding",                     x:30,y:130, fontSize:52,fontId:"great-vibes",italic:false,align:"center",color:"#3A3028",width:340,lineHeight:1.2, rotation:0},
    {id:"e3",type:"divider", x:120,y:205,width:160},
    {id:"e4",type:"text",    content:"Amelia & James",              x:30,y:235, fontSize:34,fontId:"pinyon",     italic:false,align:"center",color:"#6B5E52",width:340,lineHeight:1.3, rotation:0},
    {id:"e5",type:"text",    content:"14th June 2025",              x:30,y:295, fontSize:13,fontId:"jost",       italic:false,align:"center",color:"#9A8F85",width:340,letterSpacing:3,lineHeight:1.4,rotation:0},
    {id:"e6",type:"text",    content:"The Grand Estate, Cotswolds", x:30,y:325, fontSize:12,fontId:"jost",       italic:false,align:"center",color:"#9A8F85",width:340,letterSpacing:2,lineHeight:1.4,rotation:0},
    {id:"e7",type:"divider", x:150,y:380,width:100},
    {id:"e8",type:"text",    content:"♡",                           x:30,y:415, fontSize:28,fontId:"cormorant",  italic:false,align:"center",color:"#C5B9AC",width:340,lineHeight:1.3, rotation:0},
  ]},
  { id:"order-of-day", name:"Order of the Day", category:"wedding-welcome", availableSizes:["700x1400","700x2000","700x3000"], sizeKey:"700x2000", background:"#EDE8E0", elements:[
    {id:"e1",type:"text",    content:"Order of the Day",             x:30,y:70,  fontSize:38,fontId:"playfair", italic:true, align:"center",color:"#3A3028",width:340,lineHeight:1.25,rotation:0},
    {id:"e2",type:"divider", x:100,y:128,width:200},
    {id:"e3",type:"text",    content:"2:30pm  —  Ceremony",          x:40,y:168, fontSize:16,fontId:"cormorant",italic:false,align:"left",  color:"#5A4A3C",width:320,letterSpacing:1,lineHeight:1.6,rotation:0},
    {id:"e4",type:"text",    content:"3:15pm  —  Drinks Reception",  x:40,y:205, fontSize:16,fontId:"cormorant",italic:false,align:"left",  color:"#5A4A3C",width:320,letterSpacing:1,lineHeight:1.6,rotation:0},
    {id:"e5",type:"text",    content:"5:00pm  —  Wedding Breakfast", x:40,y:242, fontSize:16,fontId:"cormorant",italic:false,align:"left",  color:"#5A4A3C",width:320,letterSpacing:1,lineHeight:1.6,rotation:0},
    {id:"e6",type:"text",    content:"7:30pm  —  Evening Reception", x:40,y:279, fontSize:16,fontId:"cormorant",italic:false,align:"left",  color:"#5A4A3C",width:320,letterSpacing:1,lineHeight:1.6,rotation:0},
    {id:"e7",type:"text",    content:"10:00pm  —  Last Dance",       x:40,y:316, fontSize:16,fontId:"cormorant",italic:false,align:"left",  color:"#5A4A3C",width:320,letterSpacing:1,lineHeight:1.6,rotation:0},
    {id:"e8",type:"divider", x:100,y:365,width:200},
    {id:"e9",type:"text",    content:"Amelia & James",               x:30,y:400, fontSize:28,fontId:"pinyon",   italic:false,align:"center",color:"#9A8F85",width:340,lineHeight:1.3, rotation:0},
  ]},
  { id:"table-plan", name:"Table Plan", category:"wedding-seating", availableSizes:["700x1400","700x2000","700x3000","1400x2000"], sizeKey:"700x2000", background:"#F5F0E8", elements:[
    {id:"e1",type:"text",    content:"Please find",                 x:30,y:70,  fontSize:22,fontId:"cormorant",  italic:true, align:"center",color:"#3A3028",width:340,lineHeight:1.3, rotation:0},
    {id:"e2",type:"text",    content:"your seat",                   x:30,y:108, fontSize:48,fontId:"great-vibes",italic:false,align:"center",color:"#3A3028",width:340,lineHeight:1.2, rotation:0},
    {id:"e3",type:"divider", x:130,y:170,width:140},
    {id:"e4",type:"text",    content:"Table 1  ·  The Oak Room",    x:30,y:200, fontSize:15,fontId:"cormorant", italic:false,align:"center",color:"#6B5E52",width:340,letterSpacing:1,lineHeight:1.5,rotation:0},
    {id:"e5",type:"text",    content:"Table 2  ·  The Rose Garden", x:30,y:228, fontSize:15,fontId:"cormorant", italic:false,align:"center",color:"#6B5E52",width:340,letterSpacing:1,lineHeight:1.5,rotation:0},
    {id:"e6",type:"text",    content:"Table 3  ·  The Library",     x:30,y:256, fontSize:15,fontId:"cormorant", italic:false,align:"center",color:"#6B5E52",width:340,letterSpacing:1,lineHeight:1.5,rotation:0},
    {id:"e7",type:"text",    content:"Table 4  ·  The Orangery",    x:30,y:284, fontSize:15,fontId:"cormorant", italic:false,align:"center",color:"#6B5E52",width:340,letterSpacing:1,lineHeight:1.5,rotation:0},
    {id:"e8",type:"text",    content:"Table 5  ·  The Terrace",     x:30,y:312, fontSize:15,fontId:"cormorant", italic:false,align:"center",color:"#6B5E52",width:340,letterSpacing:1,lineHeight:1.5,rotation:0},
    {id:"e9",type:"divider", x:130,y:355,width:140},
  ]},
  { id:"menu", name:"Dinner Menu", category:"wedding-welcome", availableSizes:["700x1400","700x2000","700x3000"], sizeKey:"700x2000", background:"#EAE5DC", elements:[
    {id:"e1", type:"text",    content:"Menu",                        x:30,y:70,  fontSize:52,fontId:"pinyon",    italic:false,align:"center",color:"#3A3028",width:340,lineHeight:1.2, rotation:0},
    {id:"e2", type:"divider", x:120,y:135,width:160},
    {id:"e3", type:"text",    content:"— Starter —",                x:30,y:162, fontSize:10,fontId:"jost",      italic:false,align:"center",color:"#9A8F85",width:340,letterSpacing:3,lineHeight:1.5,rotation:0},
    {id:"e4", type:"text",    content:"Smoked Salmon Terrine",      x:30,y:185, fontSize:18,fontId:"cormorant", italic:true, align:"center",color:"#5A4A3C",width:340,lineHeight:1.4, rotation:0},
    {id:"e5", type:"text",    content:"cucumber, crème fraîche",    x:30,y:210, fontSize:13,fontId:"cormorant", italic:false,align:"center",color:"#9A8F85",width:340,lineHeight:1.4, rotation:0},
    {id:"e6", type:"divider", x:160,y:238,width:80},
    {id:"e7", type:"text",    content:"— Main —",                   x:30,y:262, fontSize:10,fontId:"jost",      italic:false,align:"center",color:"#9A8F85",width:340,letterSpacing:3,lineHeight:1.5,rotation:0},
    {id:"e8", type:"text",    content:"Herb-crusted Lamb",          x:30,y:285, fontSize:18,fontId:"cormorant", italic:true, align:"center",color:"#5A4A3C",width:340,lineHeight:1.4, rotation:0},
    {id:"e9", type:"text",    content:"dauphinoise, seasonal greens",x:30,y:310,fontSize:13,fontId:"cormorant", italic:false,align:"center",color:"#9A8F85",width:340,lineHeight:1.4, rotation:0},
    {id:"e10",type:"divider", x:160,y:338,width:80},
    {id:"e11",type:"text",    content:"— Dessert —",                x:30,y:362, fontSize:10,fontId:"jost",      italic:false,align:"center",color:"#9A8F85",width:340,letterSpacing:3,lineHeight:1.5,rotation:0},
    {id:"e12",type:"text",    content:"Lemon Posset & Shortbread",  x:30,y:385, fontSize:18,fontId:"cormorant", italic:true, align:"center",color:"#5A4A3C",width:340,lineHeight:1.4, rotation:0},
    {id:"e13",type:"divider", x:120,y:425,width:160},
  ]},
  { id:"drinks", name:"Drinks Station", category:"bar-sign", availableSizes:["450x1000","700x1400"], sizeKey:"600x900", background:"#F0EAE0", elements:[
    {id:"e1",type:"text",    content:"Help yourself to",                  x:30,y:60, fontSize:18,fontId:"cormorant",  italic:true, align:"center",color:"#3A3028",width:340,lineHeight:1.4,rotation:0},
    {id:"e2",type:"text",    content:"Drinks",                            x:30,y:95, fontSize:52,fontId:"great-vibes", italic:false,align:"center",color:"#3A3028",width:340,lineHeight:1.2,rotation:0},
    {id:"e3",type:"divider", x:130,y:158,width:140},
    {id:"e4",type:"text",    content:"Prosecco  ·  Beer  ·  Elderflower", x:30,y:186,fontSize:14,fontId:"cormorant", italic:false,align:"center",color:"#6B5E52",width:340,letterSpacing:1,lineHeight:1.5,rotation:0},
  ]},
];

// ─── Default colour palette ───────────────────────────────────────────────────
const DEFAULT_PALETTE = ["#3A3028","#6B5E52","#9A8F85","#F5F0E8","#4A6741","#8AAFC0","#C4714A","#C9A84C"];

// ─── Linen texture ────────────────────────────────────────────────────────────
function LinenTexture({ opacity=0.18 }) {
  if (opacity <= 0) return null;
  return (
    <svg style={{position:"absolute",inset:0,width:"100%",height:"100%",opacity,pointerEvents:"none"}} xmlns="http://www.w3.org/2000/svg">
      <filter id="linen">
        <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="4" stitchTiles="stitch"/>
        <feColorMatrix type="saturate" values="0"/>
        <feBlend in="SourceGraphic" mode="multiply"/>
      </filter>
      <rect width="100%" height="100%" filter="url(#linen)"/>
    </svg>
  );
}

// ─── Snap guides ──────────────────────────────────────────────────────────────
function SnapGuides({ guideX, guideY, cw, ch }) {
  if (guideX === null && guideY === null) return null;
  return (
    <svg style={{position:"absolute",inset:0,width:cw,height:ch,pointerEvents:"none",zIndex:99}} viewBox={`0 0 ${cw} ${ch}`}>
      {guideX !== null && <line x1={guideX} y1={0} x2={guideX} y2={ch} stroke="#E07060" strokeWidth="0.8" strokeDasharray="4,3" opacity="0.8"/>}
      {guideY !== null && <line x1={0} y1={guideY} x2={cw} y2={guideY} stroke="#E07060" strokeWidth="0.8" strokeDasharray="4,3" opacity="0.8"/>}
    </svg>
  );
}

// ─── Handles ──────────────────────────────────────────────────────────────────
function RotationHandle({ onMouseDown }) {
  return (
    <div onMouseDown={onMouseDown} title="Drag to rotate"
      style={{position:"absolute",top:-28,left:"50%",transform:"translateX(-50%)",
        width:18,height:18,borderRadius:"50%",background:"#8A7B6C",border:"2px solid #fff",
        cursor:"crosshair",zIndex:21,display:"flex",alignItems:"center",justifyContent:"center",
        boxSizing:"border-box",boxShadow:"0 1px 4px rgba(0,0,0,0.2)"}}>
      <span style={{fontSize:9,color:"#fff",lineHeight:1,userSelect:"none"}}>↻</span>
    </div>
  );
}

function ResizeHandle({ onMouseDown }) {
  return (
    <div onMouseDown={onMouseDown}
      style={{position:"absolute",bottom:-6,right:-6,width:13,height:13,
        background:"#8A7B6C",borderRadius:"50%",cursor:"se-resize",zIndex:20,
        border:"2px solid #fff",boxSizing:"border-box"}}/>
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
      <div style={{display:"flex",flexWrap:"wrap",gap:7,marginBottom:10}}>
        {palette.map((hex, i) => (
          <button key={i} onClick={() => { onChange(hex); setDraft(hex); }} title={hex}
            style={{width:26,height:26,borderRadius:"50%",border:"none",background:hex,cursor:"pointer",flexShrink:0,
              boxShadow:value===hex?"0 0 0 2px #fff,0 0 0 3.5px #8A7B6C":"0 1px 4px rgba(0,0,0,0.18)",
              transform:value===hex?"scale(1.15)":"scale(1)",transition:"all 0.15s"}}/>
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

// ─── Slider ───────────────────────────────────────────────────────────────────
function SliderRow({ label, value, min, max, step=1, format, onChange }) {
  return (
    <div style={{marginBottom:16}}>
      <div style={{fontSize:10,letterSpacing:2,color:"#9A8F85",marginBottom:6}}>
        {label} — {format ? format(value) : value}
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(step < 1 ? parseFloat(e.target.value) : parseInt(e.target.value))}
        style={{width:"100%",accentColor:"#8A7B6C"}}/>
    </div>
  );
}

// ─── Text scale handle (drag right edge to resize font proportionally) ─────────
function TextScaleHandle({ el, onChange, onCommit, scale }) {
  const handleMouseDown = (e) => {
    e.stopPropagation(); e.preventDefault();
    const startX  = e.clientX;
    const startW  = el.width || 340;
    const startFs = el.fontSize || 22;
    const move = (ev) => {
      const dw    = (ev.clientX - startX) / scale;
      const nw    = Math.max(30, startW + dw);
      // Font size scales proportionally with box width
      const ratio = nw / startW;
      const nfs   = Math.max(6, Math.round(startFs * ratio));
      onChange({ width: Math.round(nw), fontSize: nfs });
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
      style={{position:"absolute",top:"50%",right:-8,transform:"translateY(-50%)",
        width:16,height:28,borderRadius:4,background:"#8A7B6C",cursor:"ew-resize",zIndex:22,
        border:"2px solid #fff",boxSizing:"border-box",
        display:"flex",alignItems:"center",justifyContent:"center",
        boxShadow:"0 1px 4px rgba(0,0,0,0.2)"}}>
      <div style={{display:"flex",flexDirection:"column",gap:2}}>
        <div style={{width:2,height:2,borderRadius:"50%",background:"#fff"}}/>
        <div style={{width:2,height:2,borderRadius:"50%",background:"#fff"}}/>
        <div style={{width:2,height:2,borderRadius:"50%",background:"#fff"}}/>
      </div>
    </div>
  );
}

// ─── Canvas element ───────────────────────────────────────────────────────────
function CanvasElement({ el, selected, onSelect, onAddToSelection, onChange, onSnap, onSnapEnd, onCommit, onMultiDragStart, scale }) {
  const [dragging, setDragging] = useState(false);
  const [editing,  setEditing]  = useState(false);
  const dragStart = useRef(null);
  const textRef   = useRef(null);
  const font = getAllFonts().find(f => f.id === el.fontId) || FONTS[0];
  const lh   = el.lineHeight || 1.35;
  const rot  = el.rotation || 0;

  useEffect(() => {
    if (editing && textRef.current) {
      // Restore content — switching away from dangerouslySetInnerHTML clears the div
      textRef.current.innerText = el.content;
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

  const handleMouseDown = (e) => {
    if (editing) return;
    e.stopPropagation(); e.preventDefault();
    onSelect(el.id, e.shiftKey); // pass shift key for additive selection
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
      if (dragStart.current?.openEdit && !dragStart.current?.moved) setEditing(true);
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
    const cx = el.x + (el.width || 100) / 2;
    const cy = el.y + (el.height || el.fontSize || 20) / 2;
    const startAngle = Math.atan2(e.clientY - cy * scale, e.clientX - cx * scale) * 180 / Math.PI;
    const startRot = rot;
    const move = (ev) => {
      const angle = Math.atan2(ev.clientY - cy * scale, ev.clientX - cx * scale) * 180 / Math.PI;
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

  const textStyle = {
    fontFamily: font.family, fontSize: el.fontSize, color: el.color,
    textAlign: el.align || "center", fontStyle: el.italic ? "italic" : "normal",
    letterSpacing: el.letterSpacing ? `${el.letterSpacing}px` : undefined,
    lineHeight: lh,
    WebkitTextStrokeWidth: el.strokeWidth ? `${el.strokeWidth}px` : undefined,
    WebkitTextStrokeColor: el.strokeWidth ? (el.strokeColor || el.color) : undefined,
    paintOrder: "stroke fill",
  };

  if (el.type === "divider") return (
    <div onMouseDown={handleMouseDown} onClick={e => { e.stopPropagation(); onSelect(el.id); }}
      style={{position:"absolute",left:el.x,top:el.y,width:el.width,padding:"8px 0",...sel,cursor:"move",...rotStyle}}>
      <div style={{height:1,background:"rgba(90,74,60,0.25)"}}/>
    </div>
  );

  if (el.type === "image") return (
    <div onMouseDown={handleMouseDown} onClick={e => { e.stopPropagation(); onSelect(el.id); }}
      style={{position:"absolute",left:el.x,top:el.y,width:el.width,height:el.height,...sel,...grab,...rotStyle}}>
      <img src={el.src} alt="" draggable={false}
        style={{width:"100%",height:"100%",objectFit:"contain",borderRadius:2,display:"block",pointerEvents:"none"}}/>
      {selected && <><RotationHandle onMouseDown={handleRotateMouseDown}/><ResizeHandle onMouseDown={handleResizeMouseDown}/></>}
    </div>
  );

  if (el.type === "illustration") return (
    <div onMouseDown={handleMouseDown} onClick={e => { e.stopPropagation(); onSelect(el.id); }}
      style={{position:"absolute",left:el.x,top:el.y,width:el.width,height:el.height,...sel,...grab,...rotStyle,
        display:"flex",alignItems:"center",justifyContent:"center"}}>
      <IllustrationThumb type={el.illustrationId} size={Math.min(el.width, el.height)} color={el.color || "#9A8F85"}/>
      {selected && <><RotationHandle onMouseDown={handleRotateMouseDown}/><ResizeHandle onMouseDown={handleResizeMouseDown}/></>}
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
        borderRadius:2,...rotStyle,
      }}>
      {/* Wrapper that hugs text width — this is the actual hit area */}
      <div
        onMouseDown={handleMouseDown}
        style={{position:"relative", display:"inline-block",
          cursor: dragging ? "grabbing" : "grab", userSelect:"none",
          pointerEvents:"auto",
          outline: (selected && !editing) ? "1.5px dashed rgba(138,123,108,0.75)" : "none",
          outlineOffset: 3,
        }}>
        <div
          ref={textRef}
          contentEditable={editing}
          suppressContentEditableWarning
          // Uncontrolled: don't pass content as children while editing —
          // let browser own the DOM. Only sync back on blur.
          dangerouslySetInnerHTML={editing ? undefined : { __html: el.content.replace(/\n/g,"<br/>") }}
          onBlur={e => { onChange({ content: e.currentTarget.innerText }); setEditing(false); onCommit(); }}
          onKeyDown={handleContentKeyDown}
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
        {selected && (
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
  const [cat, setCat] = useState(ILLUSTRATION_LIBRARY[0].category);
  const activeCat = ILLUSTRATION_LIBRARY.find(c => c.category === cat);
  return (
    <div style={{position:"absolute",bottom:0,left:72,right:268,zIndex:200,
      background:"rgba(252,249,245,0.97)",backdropFilter:"blur(16px)",
      borderTop:"1px solid rgba(180,165,150,0.3)",boxShadow:"0 -8px 40px rgba(0,0,0,0.1)",
      display:"flex",flexDirection:"column",maxHeight:290}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",
        padding:"12px 20px 0",borderBottom:"1px solid rgba(180,165,150,0.2)",flexShrink:0}}>
        <div style={{fontSize:10,letterSpacing:3,color:"#9A8F85",fontFamily:"Georgia,serif"}}>ILLUSTRATION LIBRARY</div>
        <div style={{display:"flex",gap:2}}>
          {ILLUSTRATION_LIBRARY.map(c => (
            <button key={c.category} onClick={() => setCat(c.category)}
              style={{padding:"6px 14px",fontSize:10,letterSpacing:1,border:"none",
                borderBottom:cat===c.category?"2px solid #8A7B6C":"2px solid transparent",
                background:"transparent",cursor:"pointer",color:cat===c.category?"#3A3028":"#9A8F85",
                fontFamily:"Georgia,serif",transition:"all 0.15s"}}>
              {c.category.toUpperCase()}
            </button>
          ))}
        </div>
        <button onClick={onClose}
          style={{background:"none",border:"none",cursor:"pointer",color:"#9A8F85",fontSize:20,lineHeight:1,padding:"0 4px"}}>
          ×
        </button>
      </div>
      <div style={{display:"flex",gap:10,padding:"14px 20px",flexWrap:"wrap",flex:1,overflowY:"auto"}}>
        {activeCat.items.map(item => (
          <button key={item.id} onClick={() => { onAdd(item); onClose(); }}
            style={{display:"flex",flexDirection:"column",alignItems:"center",gap:6,
              padding:"10px 12px",background:"rgba(255,255,255,0.6)",
              border:"1px solid rgba(180,165,150,0.3)",borderRadius:8,cursor:"pointer",
              transition:"all 0.15s",minWidth:76,fontFamily:"Georgia,serif"}}
            onMouseEnter={e => { e.currentTarget.style.background="rgba(138,123,108,0.12)"; e.currentTarget.style.borderColor="rgba(138,123,108,0.5)"; }}
            onMouseLeave={e => { e.currentTarget.style.background="rgba(255,255,255,0.6)"; e.currentTarget.style.borderColor="rgba(180,165,150,0.3)"; }}>
            <IllustrationThumb type={item.svg} size={46} color="#8A7B6C"/>
            <span style={{fontSize:10,color:"#6B5E52",letterSpacing:0.5}}>{item.label}</span>
          </button>
        ))}
      </div>
      <div style={{padding:"6px 20px 10px",borderTop:"1px solid rgba(180,165,150,0.12)",
        fontSize:10,color:"#B0A496",fontFamily:"Georgia,serif",flexShrink:0}}>
        ✦ &nbsp; Your uploaded illustration files will appear here automatically.
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
function GroupBoundingBox({ selectedIds, elements, scale, onGroupResize, onGroupDragStart }) {
  if (selectedIds.length < 2) return null;

  const sel = (elements || []).filter(e => selectedIds.includes(e.id));
  if (!sel.length) return null;

  // Compute bounding box over all selected elements
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  sel.forEach(el => {
    const x = el.x, y = el.y;
    const w = el.width || 100;
    const h = el.height || el.fontSize || 20;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  });

  const bw = maxX - minX, bh = maxY - minY;
  const PAD = 10;

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
      left:   minX - PAD,
      top:    minY - PAD,
      width:  bw + PAD * 2,
      height: bh + PAD * 2,
      border: "1.5px dashed rgba(138,123,108,0.6)",
      borderRadius: 4,
      pointerEvents: "none",
      zIndex: 120,
    }}>
      {/* Transparent drag area covers whole bbox for group move */}
      <div
        onMouseDown={onGroupDragStart}
        style={{
          position: "absolute", inset: 0,
          cursor: "grab", pointerEvents: "auto",
          background: "transparent", zIndex: 121,
        }}
      />
      {/* Corner resize handle — bottom right */}
      <div
        onMouseDown={handleResizeMouseDown}
        style={{
          position: "absolute", bottom: -7, right: -7,
          width: 14, height: 14, borderRadius: "50%",
          background: "#8A7B6C", border: "2px solid #fff",
          cursor: "se-resize", pointerEvents: "auto", zIndex: 130,
          boxShadow: "0 1px 4px rgba(0,0,0,0.25)",
          boxSizing: "border-box",
        }}
      />
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function LinenSignEditor() {
  const [urlParams]        = useState(() => getUrlParams());
  const [stage,            setStage]            = useState("gallery");
  const [template,         setTemplate]         = useState(null);
  const [selectedIds,      setSelectedIds]      = useState([]); // multi-select
  // Convenience: primary selected element is first in array
  const selectedId = selectedIds[0] ?? null;
  const setSelectedId = (id) => setSelectedIds(id ? [id] : []);
  const [exportMsg,        setExportMsg]        = useState(null);
  const [showLibrary,      setShowLibrary]      = useState(false);
  const [showSaveModal,    setShowSaveModal]    = useState(false);
  const [userEmail,        setUserEmail]        = useState(() => { try { return JSON.parse(localStorage.getItem("linenStudio_user") || "{}").email || ""; } catch { return ""; } });
  const [savedPulse,       setSavedPulse]       = useState(false);
  const [scale,            setScale]            = useState(1);
  const [bgColour,         setBgColour]         = useState("#F2EDE4");
  const [palette,          setPalette]          = useState(DEFAULT_PALETTE);
  const [customFonts,      setCustomFonts]      = useState([]);
  const [guideX,           setGuideX]           = useState(null);
  const [guideY,           setGuideY]           = useState(null);
  const [staged,           setStaged]           = useState(null);
  const [marquee,          setMarquee]          = useState(null); // {x,y,w,h} in internal coords
  const [showLinenTexture, setShowLinenTexture] = useState(true);

  const canvasRef    = useRef(null);
  const fileRef      = useRef(null);
  const fontFileRef  = useRef(null);
  const elementsRef  = useRef([]);
  const groupDragRef = useRef(null); // stores {startPositions, mx, my} for group drag
  const fitRef       = useRef(1);    // mirrors the computed fit scale

  const { present: elements, set: setElements, undo, redo, canUndo, canRedo, reset: resetElements } = useUndoRedo([]);

  useEffect(() => { _runtimeFonts = customFonts; }, [customFonts]);
  elementsRef.current = elements;

  const displayElements = staged ?? elements ?? [];

  const commitStaged = useCallback(() => {
    if (staged) { setElements(staged); setStaged(null); }
  }, [staged, setElements]);

  const updateElementStaged = useCallback((id, patch) => {
    setStaged(prev => {
      const base = prev ?? elementsRef.current;
      return base.map(el => el.id === id ? { ...el, ...patch } : el);
    });
  }, []);

  // Load Google Fonts
  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?${FONTS.map(f => `family=${f.url}`).join("&")}&display=swap`;
    document.head.appendChild(link);
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
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stage, selectedId, undo, redo, setElements]);

  const openTemplate = (tmpl) => {
    if (tmpl.placeholder) return;
    setTemplate(tmpl);
    resetElements(JSON.parse(JSON.stringify(tmpl.elements)));
    setStaged(null);
    setBgColour(tmpl.background);
    setSelectedId(null);
    setShowLibrary(false);
    setStage("editor");
  };

  const handleSnap = useCallback((rawX, rawY, w, h, draggingId) => {
    const { cw } = canvasDims(template?.sizeKey);
    const base = staged ?? elementsRef.current ?? [];
    const { xLines, yLines } = getSnapLines(base, draggingId, cw);
    const result = applySnap(rawX, rawY, w, h, xLines, yLines);
    setGuideX(result.guideX); setGuideY(result.guideY);
    return { x: result.x, y: result.y };
  }, [staged, template]);

  const handleSnapEnd = useCallback(() => { setGuideX(null); setGuideY(null); }, []);

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
    const el = { id:`ill-${Date.now()}`, type:"illustration",
      illustrationId:item.svg, label:item.label, x:130, y:100, width:140, height:140, color:"#9A8F85", rotation:0 };
    setElements(els => [...els, el]); setSelectedId(el.id);
  };

  const addToPalette = (hex) => {
    if (!hex || !/^#[0-9A-Fa-f]{6}$/.test(hex)) return;
    setPalette(p => p.includes(hex) ? p : [...p, hex]);
  };

  const updateEl = (patch) => setElements(els => els.map(el => selectedIds.includes(el.id) ? { ...el, ...patch } : el));

  const handleGroupDragStart = useCallback((e) => {
    e.stopPropagation(); e.preventDefault();
    const rect = canvasRef.current.getBoundingClientRect();
    // Snapshot positions of all selected elements at drag start
    const startPositions = (elementsRef.current ?? [])
      .filter(el => selectedIds.includes(el.id))
      .map(el => ({ id: el.id, x: el.x, y: el.y }));
    const startMx = e.clientX, startMy = e.clientY;

    const move = (ev) => {
      const dx = (ev.clientX - startMx) / fitRef.current;
      const dy = (ev.clientY - startMy) / fitRef.current;
      const base = elementsRef.current ?? [];
      setStaged(base.map(el => {
        const sp = startPositions.find(s => s.id === el.id);
        if (!sp) return el;
        return { ...el, x: sp.x + dx, y: sp.y + dy };
      }));
    };
    const up = () => {
      setStaged(null);
      const base = elementsRef.current ?? [];
      const dx = (groupDragRef.current?.lastDx ?? 0);
      const dy = (groupDragRef.current?.lastDy ?? 0);
      // Compute final positions from last move
      setElements(base.map(el => {
        const sp = startPositions.find(s => s.id === el.id);
        if (!sp) return el;
        return { ...el, x: sp.x + (groupDragRef.current?.lastDx ?? 0), y: sp.y + (groupDragRef.current?.lastDy ?? 0) };
      }));
      groupDragRef.current = null;
      window.removeEventListener("mousemove", move2);
      window.removeEventListener("mouseup", up);
    };
    // Wrapper that also tracks last dx/dy for commit
    const move2 = (ev) => {
      const dx = (ev.clientX - startMx) / fitRef.current;
      const dy = (ev.clientY - startMy) / fitRef.current;
      groupDragRef.current = { lastDx: dx, lastDy: dy };
      const base = elementsRef.current ?? [];
      setStaged(base.map(el => {
        const sp = startPositions.find(s => s.id === el.id);
        if (!sp) return el;
        return { ...el, x: sp.x + dx, y: sp.y + dy };
      }));
    };
    window.addEventListener("mousemove", move2);
    window.addEventListener("mouseup", up);
  }, [selectedIds, fit, setElements]);

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

  // ── GALLERY ──────────────────────────────────────────────────────────────
  if (stage === "gallery") {
    const filterType = urlParams.type;
    const filterSize = urlParams.size;
    const signLabel  = filterType ? (SIGN_TYPES[filterType]?.label || filterType) : null;
    const sizeLabel  = filterSize ? (SIZES[filterSize]?.label || filterSize) : null;
    const lockedSize = filterSize && SIZES[filterSize] ? filterSize : null;

    let matched = TEMPLATES.filter(t => {
      const typeOk = !filterType || t.category === filterType;
      const sizeOk = !filterSize || !t.availableSizes || t.availableSizes.includes(filterSize);
      return typeOk && sizeOk;
    });
    if (lockedSize) matched = matched.map(t => ({ ...t, sizeKey: lockedSize }));

    const gallerySlots = [
      ...matched,
      ...Array.from({ length: Math.max(0, 10 - matched.length) }, (_, i) => ({
        id: `ph-${i}`, name: `Design ${matched.length + i + 1}`,
        sizeKey: lockedSize || "700x2000",
        background: ["#F2EDE4","#EDE8E0","#F5F0E8","#EAE5DC"][i % 4],
        placeholder: true,
        elements: [{ id:"p1", type:"text", content:"Coming Soon", x:30, y:180, fontSize:24, fontId:"cormorant", italic:true, align:"center", color:"#C5B9AC", width:340, lineHeight:1.3, rotation:0 }],
      })),
    ];

    return (
      <div style={{minHeight:"100vh",background:"#F7F3EE",fontFamily:"Georgia,serif"}}>
        <div style={{padding:"40px 40px 24px",borderBottom:"1px solid rgba(180,165,150,0.25)"}}>
          <div style={{fontSize:10,letterSpacing:4,color:"#9A8F85",marginBottom:6}}>BESPOKE LINEN SIGNS</div>
          <div style={{fontSize:32,color:"#3A3028",fontWeight:"normal"}}>{signLabel || "Choose Your Design"}</div>
          {(signLabel || sizeLabel) && (
            <div style={{display:"flex",gap:8,marginTop:10,flexWrap:"wrap"}}>
              {sizeLabel && <span style={{fontSize:11,background:"rgba(138,123,108,0.12)",color:"#6B5E52",padding:"4px 12px",borderRadius:20,letterSpacing:1}}>{sizeLabel}</span>}
              {signLabel && <span style={{fontSize:11,background:"rgba(138,123,108,0.12)",color:"#6B5E52",padding:"4px 12px",borderRadius:20,letterSpacing:1}}>{signLabel}</span>}
            </div>
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
                    cursor:tmpl.placeholder?"default":"pointer",position:"relative",overflow:"hidden",
                    boxShadow:"0 2px 20px rgba(0,0,0,0.08)",transition:"transform 0.2s, box-shadow 0.2s",
                    opacity:tmpl.placeholder?0.45:1}}
                  onMouseEnter={e => { if (!tmpl.placeholder) { e.currentTarget.style.transform="translateY(-3px)"; e.currentTarget.style.boxShadow="0 8px 32px rgba(0,0,0,0.14)"; }}}
                  onMouseLeave={e => { e.currentTarget.style.transform="none"; e.currentTarget.style.boxShadow="0 2px 20px rgba(0,0,0,0.08)"; }}>
                  <LinenTexture/>
                  <div style={{position:"absolute",inset:8,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:3,overflow:"hidden"}}>
                    {tmpl.elements.slice(0, 4).map((el, i) => el.type === "text" && (
                      <div key={el.id} style={{fontFamily:(getAllFonts().find(f=>f.id===el.fontId)||FONTS[0]).family,
                        fontSize:Math.min(el.fontSize*0.25,13),color:el.color,textAlign:"center",
                        fontStyle:el.italic?"italic":"normal",opacity:i===0?1:0.65,
                        lineHeight:1.25,width:"100%",overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>
                        {el.content}
                      </div>
                    ))}
                  </div>
                  {tmpl.placeholder && (
                    <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
                      <div style={{fontSize:8,letterSpacing:2,color:"#9A8F85"}}>COMING SOON</div>
                    </div>
                  )}
                </div>
                <div>
                  <div style={{fontSize:11,color:"#3A3028",letterSpacing:0.5,lineHeight:1.4}}>{tmpl.name}</div>
                  <div style={{fontSize:9,color:"#9A8F85",letterSpacing:1,marginTop:2}}>{s.label}</div>
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
      if (!showLinenTexture) return 0;    // user toggled off
      if (brightness > 240) return 0;    // near-white: no texture
      if (brightness > 200) return 0.08; // light: subtle texture
      return 0.18;                        // normal
    } catch { return 0.18; }
  })();

  const { cw, ch } = canvasDims(template?.sizeKey);
  const maxH = typeof window !== "undefined" ? window.innerHeight - 120 : 700;
  const fit  = Math.min(maxH / ch, 460 / cw, 1);
  fitRef.current = fit; // keep ref in sync so callbacks can read it
  const dispW = Math.round(cw * fit), dispH = Math.round(ch * fit);

  return (
    <div style={{height:"100vh",background:"#F7F3EE",fontFamily:"Georgia,serif",display:"flex",flexDirection:"column",overflow:"hidden"}}>

      {/* Top bar */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",
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
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <button onClick={() => setShowSaveModal(true)}
            style={{display:"flex",alignItems:"center",gap:6,padding:"9px 16px",
              background:savedPulse?"rgba(74,103,65,0.15)":"rgba(255,255,255,0.7)",
              border:"1px solid rgba(138,123,108,0.4)",borderRadius:6,cursor:"pointer",
              fontSize:11,letterSpacing:1,color:savedPulse?"#4A6741":"#6B5E52",
              fontFamily:"Georgia,serif",transition:"all 0.2s"}}>
            <span style={{fontSize:13}}>💾</span>
            {userEmail ? "SAVED ✓" : "SAVE DESIGN"}
          </button>
          <button onClick={() => { setExportMsg("Design saved! PNG + JSON would attach to your Shopify cart."); setTimeout(() => setExportMsg(null), 5000); }}
            style={{background:"#3A3028",color:"#F5F0E8",border:"none",borderRadius:6,
              padding:"10px 24px",fontSize:11,letterSpacing:2,cursor:"pointer",fontFamily:"Georgia,serif"}}
            onMouseEnter={e => e.target.style.background="#5A4A3C"}
            onMouseLeave={e => e.target.style.background="#3A3028"}>
            ADD TO CART
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
          display:"flex",flexDirection:"column",alignItems:"center",padding:"16px 0",gap:2,flexShrink:0,zIndex:10}}>
          {[
            { icon:"T",  sublabel:"Add Text",     action:addText,                                          active:false },
            { icon:"✾",  sublabel:"Illustrations",action:() => { setShowLibrary(l => !l); setSelectedId(null); }, active:showLibrary },
            { icon:"🖼", sublabel:"Upload Image",  action:() => fileRef.current?.click(),                  active:false },
            { icon:"⧉",  sublabel:"Duplicate",    action:duplicateSelected, disabled:!selectedIds.length },
            { icon:"✕",  sublabel:"Delete",       action:deleteSelected,    disabled:!selectedIds.length },
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

        {/* Canvas */}
        <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",padding:"16px 24px",overflow:"hidden"}}>
          <div ref={canvasRef}
            style={{width:dispW,height:dispH,position:"relative",overflow:"hidden",
              background:bgColour,
              boxShadow:"0 8px 60px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.08)",
              borderRadius:4,flexShrink:0}}>
            <div
              style={{position:"absolute",inset:0,transform:`scale(${fit})`,transformOrigin:"top left",width:cw,height:ch,
                cursor:marquee?"crosshair":"default"}}
              onMouseDown={e => {
                // Only start marquee on the background — elements call e.stopPropagation()
                if (e.button !== 0) return;
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
                  // Hit-test all elements against the marquee box
                  const hit = elementsRef.current.filter(el => {
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
              <SnapGuides guideX={guideX} guideY={guideY} cw={cw} ch={ch}/>
              {/* Group bounding box with resize handle */}
              {selectedIds.length > 1 && (
                <GroupBoundingBox
                  selectedIds={selectedIds}
                  elements={staged ?? elementsRef.current ?? []}
                  scale={scale}
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
              {displayElements.map(el => (
                <CanvasElement key={el.id} el={el}
                  selected={selectedIds.includes(el.id)}
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
                  scale={scale}/>
              ))}
            </div>
          </div>
        </div>

        {/* Right panel */}
        <div style={{width:268,background:"rgba(255,255,255,0.62)",borderLeft:"1px solid rgba(180,165,150,0.2)",
          overflowY:"auto",padding:20,flexShrink:0,zIndex:10}}>

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
              <div style={{borderTop:"1px solid rgba(180,165,150,0.2)",paddingTop:20}}>
                <div style={{fontSize:10,letterSpacing:2,color:"#9A8F85",marginBottom:12}}>BACKGROUND COLOUR</div>
                <div style={{display:"flex",flexWrap:"wrap",gap:7,marginBottom:12}}>
                  {palette.map((hex, i) => (
                    <button key={i} onClick={() => setBgColour(hex)} title={hex}
                      style={{width:26,height:26,borderRadius:"50%",border:"1px solid rgba(0,0,0,0.1)",
                        background:hex,cursor:"pointer",flexShrink:0,
                        boxShadow:bgColour===hex?"0 0 0 2px #fff,0 0 0 3.5px #8A7B6C":"0 1px 4px rgba(0,0,0,0.12)",
                        transform:bgColour===hex?"scale(1.15)":"scale(1)",transition:"all 0.15s"}}/>
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
            </>
          ) : (
            <>
              <div style={{fontSize:10,letterSpacing:2,color:"#9A8F85",marginBottom:14}}>
                {{ text:"TEXT PROPERTIES", divider:"DIVIDER", image:"PHOTO", illustration:"ILLUSTRATION" }[selectedEl.type]}
              </div>

              {/* Duplicate + Delete */}
              <div style={{display:"flex",gap:8,marginBottom:16}}>
                <button onClick={duplicateSelected}
                  style={{flex:1,padding:"7px 0",fontSize:10,letterSpacing:1,
                    border:"1px solid rgba(138,123,108,0.35)",borderRadius:6,background:"transparent",
                    cursor:"pointer",color:"#6B5E52",fontFamily:"Georgia,serif"}}>
                  ⧉ Duplicate
                </button>
                <button onClick={deleteSelected}
                  style={{flex:1,padding:"7px 0",fontSize:10,letterSpacing:1,
                    border:"1px solid rgba(180,80,80,0.3)",borderRadius:6,background:"transparent",
                    cursor:"pointer",color:"#C07070",fontFamily:"Georgia,serif"}}>
                  ✕ Remove
                </button>
              </div>

              {/* Rotation */}
              {selectedEl.type !== "divider" && (
                <SliderRow label="ROTATION" value={selectedEl.rotation||0} min={-180} max={180}
                  format={v => `${v}°`}
                  onChange={v => { updateElementStaged(selectedEl.id, {rotation:v}); commitStaged(); }}/>
              )}

              {/* TEXT */}
              {selectedEl.type === "text" && (
                <>
                  <div style={{marginBottom:14}}>
                    <div style={{fontSize:10,letterSpacing:2,color:"#9A8F85",marginBottom:8}}>FONT</div>
                    <div style={{display:"flex",flexDirection:"column",gap:3}}>
                      {getAllFonts().map(f => (
                        <button key={f.id} onClick={() => updateEl({fontId:f.id})}
                          style={{textAlign:"left",padding:"6px 10px",borderRadius:6,border:"none",
                            background:selectedEl.fontId===f.id?"rgba(138,123,108,0.15)":"transparent",
                            cursor:"pointer",fontFamily:f.family,fontSize:14,color:"#3A3028",
                            display:"flex",alignItems:"center",gap:6}}>
                          {f.id.startsWith("custom-") && (
                            <span style={{fontSize:9,background:"rgba(138,123,108,0.2)",color:"#6B5E52",
                              padding:"1px 5px",borderRadius:3,letterSpacing:1,flexShrink:0}}>CUSTOM</span>
                          )}
                          {f.label}
                        </button>
                      ))}
                      <button onClick={() => fontFileRef.current?.click()}
                        style={{textAlign:"left",padding:"6px 10px",borderRadius:6,
                          border:"1px dashed rgba(138,123,108,0.4)",background:"transparent",
                          cursor:"pointer",fontSize:11,color:"#8A7B6C",fontFamily:"Georgia,serif",
                          letterSpacing:0.5,marginTop:4}}>
                        + Upload your own font
                      </button>
                    </div>
                  </div>

                  <SliderRow label="SIZE" value={selectedEl.fontSize} min={6} max={200}
                    onChange={v => updateEl({fontSize:v})}/>
                  <SliderRow label="LINE HEIGHT" value={selectedEl.lineHeight||1.35} min={0.8} max={3} step={0.05}
                    format={v => v.toFixed(2)} onChange={v => updateEl({lineHeight:v})}/>
                  <SliderRow label="LETTER SPACING" value={selectedEl.letterSpacing||0} min={0} max={12}
                    onChange={v => updateEl({letterSpacing:v})}/>

                  {/* Stroke */}
                  <div style={{marginBottom:16}}>
                    <div style={{fontSize:10,letterSpacing:2,color:"#9A8F85",marginBottom:6}}>
                      STROKE (THICKNESS) — {selectedEl.strokeWidth||0}px
                    </div>
                    <input type="range" min={0} max={8} step={0.5} value={selectedEl.strokeWidth||0}
                      onChange={e => updateEl({strokeWidth:parseFloat(e.target.value)})}
                      style={{width:"100%",accentColor:"#8A7B6C",marginBottom:8}}/>
                    {(selectedEl.strokeWidth||0) > 0 && (
                      <div>
                        <div style={{fontSize:10,letterSpacing:2,color:"#9A8F85",marginBottom:6}}>STROKE COLOUR</div>
                        <div style={{display:"flex",flexWrap:"wrap",gap:7,marginBottom:6}}>
                          {palette.map((hex, i) => (
                            <button key={i} onClick={() => updateEl({strokeColor:hex})} title={hex}
                              style={{width:22,height:22,borderRadius:"50%",border:"none",background:hex,cursor:"pointer",flexShrink:0,
                                boxShadow:(selectedEl.strokeColor||selectedEl.color)===hex?"0 0 0 2px #fff,0 0 0 3.5px #8A7B6C":"0 1px 4px rgba(0,0,0,0.15)",
                                transform:(selectedEl.strokeColor||selectedEl.color)===hex?"scale(1.15)":"scale(1)",transition:"all 0.15s"}}/>
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

                  {/* Style */}
                  <div style={{marginBottom:14}}>
                    <div style={{fontSize:10,letterSpacing:2,color:"#9A8F85",marginBottom:8}}>STYLE</div>
                    <div style={{display:"flex",gap:8}}>
                      {[
                        {label:"Italic", prop:"italic", val:!selectedEl.italic,     active:selectedEl.italic},
                        {label:"Centre", prop:"align",  val:"center",               active:selectedEl.align==="center"},
                        {label:"Left",   prop:"align",  val:"left",                 active:selectedEl.align==="left"},
                      ].map(btn => (
                        <button key={btn.label} onClick={() => updateEl({[btn.prop]:btn.val})}
                          style={{flex:1,padding:"6px 0",fontSize:10,letterSpacing:1,
                            border:"1px solid rgba(138,123,108,0.35)",borderRadius:6,
                            background:btn.active?"rgba(138,123,108,0.15)":"transparent",
                            cursor:"pointer",color:"#3A3028",fontFamily:"Georgia,serif",
                            fontStyle:btn.label==="Italic"?"italic":"normal"}}>
                          {btn.label}
                        </button>
                      ))}
                    </div>
                  </div>

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
