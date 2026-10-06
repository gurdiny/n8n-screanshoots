/* Del JSON del workflow al SVG: temas, privacidad, acomodo y dibujo. No toca la página. */
"use strict";

/* ───────────── temas del render ───────────── */
const THEMES = {
  canvas:{bg:"#f7f6f4",dot:"#d9d7d2",card:"#ffffff",cardLine:"#dcd9d4",cardShadow:"rgba(20,18,30,.10)",
    text:"#1f1e26",dim:"#6f6d7a",wire:"#9c99a6",title:"#15141b",mark:"#a8a5b0",stickyText:"#3a3730"},
  dark:{bg:"#15151c",dot:"#282832",card:"#20202a",cardLine:"#32323f",cardShadow:"rgba(0,0,0,.45)",
    text:"#eceaf2",dim:"#9793a4",wire:"#4e4c5e",title:"#ffffff",mark:"#5d5a6b",stickyText:"#241f14"},
  blueprint:{bg:"#0e2233",dot:"#1b3a53",card:"#13304a",cardLine:"#27547a",cardShadow:"rgba(0,0,0,.4)",
    text:"#e4f1fb",dim:"#8fb4ce",wire:"#4b82ad",title:"#ffffff",mark:"#5c89ab",stickyText:"#22303a"},
  paper:{bg:"#ffffff",dot:"#ffffff",card:"#ffffff",cardLine:"#d7d4ce",cardShadow:"rgba(20,18,30,.07)",
    text:"#1a1a20",dim:"#75727e",wire:"#b0adb8",title:"#111115",mark:"#b6b3bd",stickyText:"#3a3730"}
};

const STICKY_FILL = ["#fdf6c8","#ffe6c2","#ffd6cf","#d8f2d8","#d5ebff","#e6dcff","#eeeeee"];

/* ───────────── detección de datos sensibles ───────────── */
const PATTERNS = [
  {k:"correos",  label:"direcciones de correo",            re:/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g},
  {k:"tokens",   label:"llaves o tokens de API",           re:/\b(?:sk-[A-Za-z0-9_\-]{12,}|xox[baprs]-[A-Za-z0-9-]{10,}|ghp_[A-Za-z0-9]{16,}|AIza[0-9A-Za-z_\-]{20,}|eyJ[A-Za-z0-9_\-]{24,}|Bearer\s+[A-Za-z0-9._\-]{16,})/g},
  {k:"urls",     label:"direcciones web internas o de API",re:/https?:\/\/[^\s"'<>\\]{6,}/g},
  {k:"ids",      label:"IDs numéricos largos (chat, teléfono, cuenta)", re:/\b\d{8,}\b/g},
  {k:"hashes",   label:"identificadores largos tipo hash", re:/\b[A-Fa-f0-9]{32,}\b/g}
];

function mask(s){
  const str = String(s);
  if (str.length <= 8) return "••••";
  return str.slice(0,3) + "•".repeat(Math.min(10, Math.max(4, str.length-6))) + str.slice(-3);
}
function sanitize(text){
  let out = String(text==null?"":text);
  for (const p of PATTERNS){
    p.re.lastIndex = 0;
    out = out.replace(p.re, m => mask(m));
  }
  return out;
}

function scanRaw(raw, wf){
  const findings = [];
  const seen = {};
  for (const p of PATTERNS){
    p.re.lastIndex = 0;
    const hits = Array.from(new Set((raw.match(p.re)||[])));
    if (hits.length) { seen[p.k] = hits; findings.push({n:hits.length, text:p.label, sample:mask(hits[0])}); }
  }
  const creds = new Set(), hooks = [];
  let params = 0;
  (wf && wf.nodes || []).forEach(n=>{
    if (n.credentials) Object.values(n.credentials).forEach(c=>{ if(c&&c.name) creds.add(c.name); });
    if (n.webhookId) hooks.push(n.webhookId);
    if (n.parameters) params += Object.keys(n.parameters).length;
  });
  if (creds.size) findings.push({n:creds.size, text:"nombres de credenciales guardadas", sample:Array.from(creds).slice(0,2).join(" · ")});
  if (hooks.length) findings.push({n:hooks.length, text:"IDs de webhook (URLs públicas de tu instancia)", sample:mask(hooks[0])});
  if (params) findings.push({n:params, text:"campos de configuración con tus datos reales", sample:"prompts, filtros, IDs de hoja, plantillas"});
  return findings;
}

/* ───────────── parseo del workflow ───────────── */
function parseWorkflow(text){
  let data = JSON.parse(text);
  if (data && data.workflow && data.workflow.nodes) data = data.workflow;
  if (Array.isArray(data)) data = {nodes:data, connections:{}};
  if (!data || !Array.isArray(data.nodes) || !data.nodes.length) throw new Error("No encontré una lista de nodos en ese JSON.");
  return {
    name: typeof data.name === "string" ? data.name : "",
    nodes: data.nodes,
    connections: (data.connections && typeof data.connections === "object") ? data.connections : {}
  };
}

/* ───────────── geometría ───────────── */
const NODE = 96, SUB = 72, LABEL_GAP = 10, LINE_H = 13;

function buildModel(wf, opts){
  const nodes = [], stickies = [];
  const byName = new Map();
  const subNames = new Set();

  Object.entries(wf.connections).forEach(([from, outs])=>{
    Object.keys(outs||{}).forEach(k=>{ if (k !== "main") subNames.add(from); });
  });

  wf.nodes.forEach(n=>{
    const pos = Array.isArray(n.position) ? n.position : [0,0];
    const x = Number(pos[0])||0, y = Number(pos[1])||0;
    const type = n.type || "";
    if (/stickyNote/i.test(type)){
      if (!opts.stickies) return;
      const p = n.parameters || {};
      stickies.push({
        x, y,
        w: Number(p.width)||240,
        h: Number(p.height)||160,
        color: STICKY_FILL[(Number(p.color)||1)-1] || STICKY_FILL[0],
        text: opts.priv ? sanitize(p.content||"") : String(p.content||"")
      });
      return;
    }
    const sub = subNames.has(n.name);
    const size = sub ? SUB : NODE;
    const node = {
      name: opts.priv ? sanitize(n.name||"") : String(n.name||""),
      raw: n.name,
      type,
      short: shortType(type),
      trigger: isTrigger(type),
      sub, size,
      x, y, ox:x, oy:y,
      cx: x + size/2,
      cy: y + size/2
    };
    nodes.push(node);
    byName.set(n.name, node);
  });

  /* conexiones */
  const mainEdges = [], aiEdges = [];
  Object.entries(wf.connections).forEach(([fromName, outs])=>{
    const a = byName.get(fromName);
    if (!a) return;
    Object.entries(outs||{}).forEach(([kind, branches])=>{
      const list = Array.isArray(branches) ? branches : [];
      const count = Math.max(1, list.length);
      list.forEach((branch, bi)=>{
        (Array.isArray(branch)?branch:[]).forEach(link=>{
          const b = byName.get(link && link.node);
          if (!b) return;
          if (kind === "main") mainEdges.push({a, b, bi, count});
          else aiEdges.push({a, b});
        });
      });
    });
  });

  let bandOf = null, bands = null;
  if (opts.layout !== "n8n" && nodes.length){
    /* cada subnodo de IA cuelga de su primer padre */
    const kids = new Map(), owned = new Set();
    aiEdges.forEach(({a, b})=>{
      if (owned.has(a) || a === b) return;
      owned.add(a);
      if (!kids.has(b)) kids.set(b, []);
      kids.get(b).push(a);
    });
    const main = nodes.filter(n=>!owned.has(n));
    const lay = autoLayout(main, kids, mainEdges.filter(e=>!owned.has(e.a) && !owned.has(e.b)), stickies, opts);
    bandOf = lay.bandOf; bands = lay.bands;
  }

  /* cables */
  const wires = [];
  const lanes = new Map();
  mainEdges.forEach(({a, b, bi, count})=>{
    const x1 = a.x + a.size, y1 = a.y + (a.size*(bi+1))/(count+1);
    const x2 = b.x, y2 = b.cy;
    const ba = bandOf && bandOf.get(a), bb = bandOf && bandOf.get(b);
    const crossBand = bands && ba !== undefined && bb !== undefined && bb !== ba;
    if (x2 > x1 + 20 && !crossBand){
      wires.push({kind:"main", x1, y1, x2, y2});
      return;
    }
    const lane = key=>{ const u = lanes.get(key) || 0; lanes.set(key, u + 1); return u; };
    const gapY = g => bands[g].y1 + BAND_GAP/2 - 8 + lane("g"+g)*12;
    if (crossBand && Math.abs(bb - ba) > 1){
      /* salta varias filas: baja o sube por el margen izquierdo para no cruzar nodos de las filas intermedias */
      const ya = gapY(bb > ba ? ba : ba - 1), yb = gapY(bb > ba ? bb - 1 : bb);
      const xm = -36 - lane("m")*12;
      wires.push({kind:"main", pts:[[x1,y1],[x1+22,y1],[x1+22,ya],[xm,ya],[xm,yb],[x2-22,yb],[x2-22,y2],[x2,y2]]});
      return;
    }
    /* hacia atrás (bucle) o a la fila vecina: rodea con trazo en ángulo */
    let ch, key, base;
    if (crossBand){
      /* por el hueco entre las dos filas */
      ch = gapY(bb > ba ? ba : ba - 1);
      wires.push({kind:"main", pts:[[x1,y1],[x1+22,y1],[x1+22,ch],[x2-22,ch],[x2-22,y2],[x2,y2]]});
      return;
    } else if (bands && ba !== undefined){
      key = "b"+ba; base = bands[ba].y1 + 16;
    } else {
      key = "n"; base = Math.max(a.y + a.size + labelH(a, opts), b.y + b.size + labelH(b, opts)) + 14;
    }
    const used = lanes.get(key) || 0;
    lanes.set(key, used + 1);
    ch = base + used*12;
    wires.push({kind:"main", pts:[[x1,y1],[x1+22,y1],[x1+22,ch],[x2-22,ch],[x2-22,y2],[x2,y2]]});
  });
  aiEdges.forEach(({a, b})=>{
    /* con acomodo, el cable sale de debajo del nombre del padre para no taparlo */
    const y2 = bands ? b.y + b.size + labelH(b, opts) - 2 : b.y + b.size;
    wires.push({kind:"ai", x1:a.cx, y1:a.y, x2:b.cx, y2});
  });

  return {nodes, stickies, wires};
}

/* ───────────── acomodo automático ─────────────
   Columnas por profundidad del flujo, ramas apiladas, subnodos de IA bajo su padre
   y, si el flujo es muy largo, cortes en filas para acercarse al formato elegido. */
const COL_GAP = 78, ROW_GAP = 30, SUB_HGAP = 10, SUB_GAP = 40, BAND_GAP = 84;

function labelH(n, opts){
  return LABEL_GAP + (wrap(n.name, 18, 2).length + (opts.types?1:0))*LINE_H + 6;
}

/* huella (ancho y alto) de un nodo junto con sus subnodos */
function measure(n, kids, opts){
  const ch = kids.get(n) || [];
  ch.forEach(c=>measure(c, kids, opts));
  const own = n.size + labelH(n, opts);
  const kidsW = ch.reduce((s,c)=>s+c._w, 0) + SUB_HGAP*Math.max(0, ch.length-1);
  n._w = Math.max(128, n.size, kidsW);
  n._h = own + (ch.length ? SUB_GAP + Math.max(...ch.map(c=>c._h)) : 0);
}
function placeKids(n, kids, opts){
  const ch = kids.get(n) || [];
  if (!ch.length) return;
  const total = ch.reduce((s,c)=>s+c._w, 0) + SUB_HGAP*(ch.length-1);
  let x = n.cx - total/2;
  const y = n.y + n.size + labelH(n, opts) + SUB_GAP;
  ch.forEach(c=>{
    setPos(c, x + c._w/2 - c.size/2, y);
    x += c._w + SUB_HGAP;
    placeKids(c, kids, opts);
  });
}
function setPos(n, x, y){ n.x = x; n.y = y; n.cx = x + n.size/2; n.cy = y + n.size/2; }

function autoLayout(main, kids, edges, stickies, opts){
  main.forEach(n=>measure(n, kids, opts));
  const outE = new Map(main.map(n=>[n,[]]));
  edges.forEach(e=>outE.get(e.a).push(e));

  /* romper ciclos (bucles) con un recorrido en profundidad */
  const hasIn = new Set(edges.map(e=>e.b));
  const roots = main.slice().sort((p,q)=>(hasIn.has(p)-hasIn.has(q)) || p.ox-q.ox || p.oy-q.oy);
  const state = new Map(), post = [];
  const visit = v=>{
    state.set(v, 1);
    outE.get(v).slice().sort((p,q)=>p.bi-q.bi).forEach(e=>{
      const s = state.get(e.b);
      if (s === 1) e.back = true;
      else if (!s) visit(e.b);
    });
    state.set(v, 2); post.push(v);
  };
  roots.forEach(r=>{ if (!state.get(r)) visit(r); });
  const topo = post.reverse();
  const fwd = edges.filter(e=>!e.back);
  const preds = new Map(main.map(n=>[n,[]])), succs = new Map(main.map(n=>[n,[]]));
  fwd.forEach(e=>{ preds.get(e.b).push(e); succs.get(e.a).push(e); });

  /* capa = camino más largo desde un inicio; los inicios se acercan a su primer destino */
  const layer = new Map();
  topo.forEach(v=>layer.set(v, preds.get(v).reduce((m,e)=>Math.max(m, layer.get(e.a)+1), 0)));
  topo.slice().reverse().forEach(v=>{
    if (preds.get(v).length || !succs.get(v).length) return;
    layer.set(v, Math.max(0, Math.min(...succs.get(v).map(e=>layer.get(e.b))) - 1));
  });
  const L = Math.max(0, ...layer.values()) + 1;
  const layers = Array.from({length:L}, ()=>[]);
  main.forEach(n=>layers[layer.get(n)].push(n));

  /* posición vertical: cada nodo busca la altura de la salida que lo alimenta */
  const portY = e=>{
    const k = e.a; return k.y + (k.size*(e.bi+1))/(e.count+1);
  };
  const settle = (ns, desired)=>{
    ns.sort((p,q)=>desired.get(p)-desired.get(q) || p.oy-q.oy || p.ox-q.ox);
    let bottom = -Infinity;
    ns.forEach(n=>{
      const y = Math.max(desired.get(n) - n.size/2, bottom + ROW_GAP);
      n.y = y; n.cy = y + n.size/2; bottom = y + n._h;
    });
  };
  const forward = keepSources=>{
    layers.forEach((ns, li)=>{
      const desired = new Map();
      let fallback = 0;
      ns.slice().sort((p,q)=>p.oy-q.oy).forEach(n=>{
        const ps = preds.get(n);
        if (ps.length) desired.set(n, ps.reduce((s,e)=>s+portY(e),0)/ps.length);
        else if (keepSources) desired.set(n, n.cy);
        else { desired.set(n, fallback); fallback += n._h + ROW_GAP; }
      });
      settle(ns, desired);
    });
  };
  forward(false);
  /* los inicios se alinean con lo que alimentan */
  for (let li=L-1; li>=0; li--){
    const desired = new Map();
    layers[li].forEach(n=>{
      const ss = succs.get(n);
      desired.set(n, !preds.get(n).length && ss.length ? ss.reduce((s,e)=>s+e.b.cy,0)/ss.length : n.cy);
    });
    settle(layers[li], desired);
  }
  forward(true);

  /* columnas y cortes en filas */
  const colW = layers.map(ns=>Math.max(128, ...ns.map(n=>n._w)));
  const span = (from, to)=>{
    let top = Infinity, bot = -Infinity, w = 0;
    for (let li=from; li<to; li++){
      w += colW[li] + (li>from ? COL_GAP : 0);
      layers[li].forEach(n=>{ top = Math.min(top, n.y); bot = Math.max(bot, n.y + n._h); });
    }
    return {w, top, h: Math.max(0, bot-top)};
  };
  const bandsFor = K=>{
    const bs = [];
    for (let s=0; s<L; s+=K) bs.push({from:s, to:Math.min(L, s+K), ...span(s, Math.min(L, s+K))});
    return bs;
  };
  let K = L;
  if (opts.layout === "auto" && L > 3){
    /* se compara contra el hueco que de verdad queda para el flujo, sin márgenes, título ni marca */
    const fr = frameOf(opts);
    const [tw, th] = opts.preset === "fit" ? [1600, 900] : opts.preset.split("x").map(Number);
    const aw = Math.max(1, tw - fr.pad*2), ah = Math.max(1, th - fr.pad*2 - fr.headH - fr.footH);
    const dims = bs=>[Math.max(...bs.map(b=>b.w)), bs.reduce((s,b)=>s+b.h, 0) + BAND_GAP*(bs.length-1)];
    const [w1, h1] = dims(bandsFor(L));
    if (!(opts.preset === "fit" && w1/h1 <= 2.2)){
      let best = 0;
      const score = [];
      /* filas parejas: con n filas, cada una lleva ceil(L/n) pasos (nunca una fila con un solo nodo suelto) */
      for (let n=1; n<=L; n++){
        const k = Math.ceil(L/n);
        if (score.length && score[score.length-1][0] === k) continue;
        const [w, h] = dims(bandsFor(k));
        score.push([k, Math.min(aw/w, ah/h)]);
      }
      best = Math.max(...score.map(s=>s[1]));
      /* a igualdad casi total, menos cortes: cada corte obliga a un cable de regreso */
      K = score.find(s=>s[1] >= best*0.92)[0];
    }
  }
  const bands = bandsFor(K);

  let offY = 0;
  const bandOf = new Map();
  bands.forEach((b, bi)=>{
    let x = 0;
    for (let li=b.from; li<b.to; li++){
      layers[li].forEach(n=>{
        setPos(n, x + (colW[li]-n.size)/2, n.y - b.top + offY);
        bandOf.set(n, bi);
        placeKids(n, kids, opts);
      });
      x += colW[li] + COL_GAP;
    }
    b.y0 = offY; b.y1 = offY + b.h;
    offY += b.h + BAND_GAP;
  });

  /* notas adhesivas: en fila encima del flujo */
  if (stickies.length){
    const maxW = Math.max(600, ...bands.map(b=>b.w));
    let x = 0, y = 0, rowH = 0;
    const rows = [];
    stickies.forEach(s=>{
      s.w = Math.min(s.w, 420); s.h = Math.min(s.h, 220);
      if (x > 0 && x + s.w > maxW){ y += rowH + 20; x = 0; rowH = 0; }
      s.x = x; s.y = y; x += s.w + 20; rowH = Math.max(rowH, s.h);
    });
    const shift = y + rowH + 48;
    stickies.forEach(s=>{ s.y -= shift; });
  }
  return {bandOf, bands};
}

/* trazo ortogonal con esquinas redondeadas */
function roundPath(p, r){
  let d = `M${p[0][0]} ${p[0][1]}`;
  for (let i=1; i<p.length-1; i++){
    const [x0,y0] = p[i-1], [x,y] = p[i], [xn,yn] = p[i+1];
    const l1 = Math.hypot(x-x0, y-y0) || 1, l2 = Math.hypot(xn-x, yn-y) || 1;
    const rr = Math.min(r, l1/2, l2/2);
    d += ` L${x-(x-x0)/l1*rr} ${y-(y-y0)/l1*rr} Q${x} ${y} ${x+(xn-x)/l2*rr} ${y+(yn-y)/l2*rr}`;
  }
  const e = p[p.length-1];
  return d + ` L${e[0]} ${e[1]}`;
}

/* ───────────── utilidades de texto ───────────── */
const esc = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

function wrap(text, maxChars, maxLines){
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  for (const w of words){
    if (!cur) { cur = w; }
    else if ((cur + " " + w).length <= maxChars) { cur += " " + w; }
    else { lines.push(cur); cur = w; }
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  if (lines.length === maxLines){
    const used = lines.join(" ").split(/\s+/).length;
    if (used < words.length) lines[maxLines-1] = lines[maxLines-1].slice(0, Math.max(1,maxChars-1)) + "…";
  }
  return lines.length ? lines : [""];
}

/* ───────────── dibujo ───────────── */
/* márgenes y franjas de texto del lienzo; el acomodo los descuenta al elegir cuántas filas usar */
const FRAME_PAD = 56, MAX_SCALE = 1.6;
function frameOf(opts){
  return {
    pad: FRAME_PAD,
    headH: (opts.title || opts.subtitle) ? (opts.subtitle ? 92 : 68) : 0,
    footH: opts.mark ? 34 : 0
  };
}

function drawSVG(model, opts){
  const T = THEMES[opts.theme] || THEMES.canvas;
  const PAD = FRAME_PAD;

  /* caja que contiene todo */
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  const touch = (x,y,w,h)=>{minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x+w);maxY=Math.max(maxY,y+h);};
  model.stickies.forEach(s=>touch(s.x,s.y,s.w,s.h));
  model.nodes.forEach(n=>{
    const lines = wrap(n.name, 18, 2).length + (opts.types?1:0);
    touch(n.x-12, n.y, n.size+24, n.size + LABEL_GAP + lines*LINE_H + 6);
  });
  model.wires.forEach(w=>{ if (w.pts) w.pts.forEach(([x,y])=>touch(x-4,y-4,8,8)); });
  if (!isFinite(minX)) { minX=0;minY=0;maxX=NODE;maxY=NODE; }

  const {headH, footH} = frameOf(opts);
  const contentW = (maxX-minX) + PAD*2;
  const contentH = (maxY-minY) + PAD*2 + headH + footH;

  /* lienzo final */
  let W, H, scale, offX, offY;
  if (opts.preset === "fit"){
    W = Math.max(480, Math.round(contentW));
    H = Math.max(300, Math.round(contentH));
    scale = 1;
    offX = PAD - minX;
    offY = PAD - minY + headH;
  } else {
    const [pw,ph] = opts.preset.split("x").map(Number);
    W = pw; H = ph;
    const availW = W - PAD*2, availH = H - PAD*2 - headH - footH;
    const fw = (maxX-minX) || 1, fh = (maxY-minY) || 1;
    scale = Math.min(availW/fw, availH/fh, MAX_SCALE);
    offX = (W - fw*scale)/2 - minX*scale;
    offY = headH + (H - headH - footH - fh*scale)/2 - minY*scale;
  }

  const o = [];
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="'IBM Plex Sans','Helvetica Neue',Arial,sans-serif">`);
  o.push(`<defs>
    <pattern id="dots" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.2" fill="${T.dot}"/></pattern>
    <filter id="sh" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="${T.cardShadow}"/></filter>
    <marker id="arw" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="${T.wire}"/></marker>
  </defs>`);
  o.push(`<rect width="${W}" height="${H}" fill="${T.bg}"/>`);
  if (opts.theme !== "paper") o.push(`<rect width="${W}" height="${H}" fill="url(#dots)" opacity=".85"/>`);

  /* encabezado */
  if (opts.title){
    o.push(`<text x="${PAD}" y="${opts.subtitle?48:46}" fill="${T.title}" font-size="30" font-weight="700" letter-spacing="-.6">${esc(opts.title)}</text>`);
  }
  if (opts.subtitle){
    o.push(`<text x="${PAD}" y="${opts.title?76:46}" fill="${T.dim}" font-size="16" font-weight="400">${esc(opts.subtitle)}</text>`);
  }

  o.push(`<g transform="translate(${offX} ${offY}) scale(${scale})">`);

  /* notas adhesivas, al fondo */
  model.stickies.forEach(s=>{
    o.push(`<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="8" fill="${s.color}" opacity=".95"/>`);
    const raw = s.text.replace(/^#+\s*/gm,"").split(/\n/).filter(l=>l.trim()!=="");
    const maxChars = Math.max(10, Math.floor(s.w/7.2));
    const maxLines = Math.max(1, Math.floor((s.h-24)/16));
    let ly = s.y + 24, used = 0;
    for (const line of raw){
      for (const piece of wrap(line, maxChars, 2)){
        if (used >= maxLines) break;
        const bold = used === 0;
        o.push(`<text x="${s.x+12}" y="${ly}" fill="${T.stickyText}" font-size="${bold?13.5:12}" font-weight="${bold?600:400}">${esc(piece)}</text>`);
        ly += 16; used++;
      }
      if (used >= maxLines) break;
    }
  });

  /* cables */
  model.wires.forEach(w=>{
    if (w.pts){
      o.push(`<path d="${roundPath(w.pts, 12)}" fill="none" stroke="${T.wire}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" marker-end="url(#arw)"/>`);
    } else if (w.kind === "main"){
      const dx = Math.max(48, Math.abs(w.x2-w.x1)*0.55);
      o.push(`<path d="M${w.x1} ${w.y1} C${w.x1+dx} ${w.y1}, ${w.x2-dx} ${w.y2}, ${w.x2} ${w.y2}" fill="none" stroke="${T.wire}" stroke-width="2.2" stroke-linecap="round" marker-end="url(#arw)"/>`);
    } else {
      const dy = Math.max(36, Math.abs(w.y2-w.y1)*0.5);
      o.push(`<path d="M${w.x1} ${w.y1} C${w.x1} ${w.y1-dy}, ${w.x2} ${w.y2+dy}, ${w.x2} ${w.y2}" fill="none" stroke="${T.wire}" stroke-width="1.8" stroke-dasharray="5 4" stroke-linecap="round" opacity=".85"/>`);
    }
  });

  /* nodos */
  model.nodes.forEach(n=>{
    const b = brandOf(n.type), s = n.size, r = 12;
    if (n.trigger){
      const rr = s/2;
      o.push(`<path d="M${n.x+rr} ${n.y} H${n.x+s-r} a${r} ${r} 0 0 1 ${r} ${r} V${n.y+s-r} a${r} ${r} 0 0 1 ${-r} ${r} H${n.x+rr} a${rr} ${rr} 0 0 1 0 ${-s} z" fill="${T.card}" stroke="${T.cardLine}" stroke-width="1.5" filter="url(#sh)"/>`);
      o.push(`<path d="M${n.x+13} ${n.cy-11} l7 0 l-3 7 l5 0 l-9 12 l2.5-9 l-5 0 z" fill="${opts.icons === "n8n" ? "#ff6d5a" : b.color}" opacity=".9"/>`);
    } else {
      o.push(`<rect x="${n.x}" y="${n.y}" width="${s}" height="${s}" rx="${r}" fill="${T.card}" stroke="${T.cardLine}" stroke-width="1.5" filter="url(#sh)"/>`);
    }
    const shift = n.trigger ? 8 : 0;
    const ic = opts.icons === "n8n" ? n8nIcon(n.type, isDarkTheme(opts.theme)) : null;
    const uri = ic && ic.url ? iconCache.get(iconKey(ic)) : null;
    if (opts.icons === "n8n"){
      /* estilo n8n: tarjeta lisa con el icono en su color */
      const box = n.sub ? 34 : 48, tx = n.cx - box/2 + shift, ty = n.cy - box/2;
      if (ic && ic.glyph){
        o.push(`<g transform="translate(${tx} ${ty}) scale(${box/24})" fill="none" color="${ic.color}">${ic.glyph}</g>`);
      } else if (uri){
        o.push(`<image href="${uri}" x="${tx}" y="${ty}" width="${box}" height="${box}" preserveAspectRatio="xMidYMid meet"/>`);
      } else if (b.icon){
        /* sin logo de n8n (nodo de la comunidad o sin conexión): el integrado, en color */
        const g = box*0.82, k = g/24, gx = n.cx - g/2 + shift, gy = n.cy - g/2;
        const [kind, body] = b.icon;
        o.push(kind === "f"
          ? `<path transform="translate(${gx} ${gy}) scale(${k})" d="${body}" fill="${b.color}"/>`
          : `<g transform="translate(${gx} ${gy}) scale(${k})" fill="none" stroke="${b.color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</g>`);
      } else {
        const fs = b.mono.length >= 4 ? (n.sub?11:13) : (n.sub?14:18);
        o.push(`<text x="${n.cx+shift}" y="${n.cy + fs*0.35}" text-anchor="middle" fill="${b.color}" font-size="${fs}" font-weight="700" letter-spacing=".3" font-family="'IBM Plex Mono',ui-monospace,Menlo,monospace">${esc(b.mono)}</text>`);
      }
    } else {
      const badge = n.sub ? 32 : 44;
      const bx = n.cx - badge/2 + shift;
      o.push(`<rect x="${bx}" y="${n.cy-badge/2}" width="${badge}" height="${badge}" rx="${badge/3.4}" fill="${b.color}"/>`);
      if (b.icon){
        const glyph = badge*0.58, k = glyph/24;
        const tx = bx + (badge-glyph)/2, ty = n.cy - glyph/2;
        const [kind, body] = b.icon;
        o.push(kind === "f"
          ? `<path transform="translate(${tx} ${ty}) scale(${k})" d="${body}" fill="#ffffff"/>`
          : `<g transform="translate(${tx} ${ty}) scale(${k})" fill="none" stroke="#ffffff" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">${body}</g>`);
      } else {
        const fs = b.mono.length >= 4 ? (n.sub?9:11) : (n.sub?13:16);
        o.push(`<text x="${bx+badge/2}" y="${n.cy + fs*0.35}" text-anchor="middle" fill="#ffffff" font-size="${fs}" font-weight="700" letter-spacing=".3" font-family="'IBM Plex Mono',ui-monospace,Menlo,monospace">${esc(b.mono)}</text>`);
      }
    }

    let ly = n.y + s + LABEL_GAP + 4;
    wrap(n.name, 18, 2).forEach(line=>{
      o.push(`<text x="${n.cx}" y="${ly}" text-anchor="middle" fill="${T.text}" font-size="12.5" font-weight="600">${esc(line)}</text>`);
      ly += LINE_H;
    });
    if (opts.types){
      o.push(`<text x="${n.cx}" y="${ly}" text-anchor="middle" fill="${T.dim}" font-size="10" font-family="'IBM Plex Mono',ui-monospace,Menlo,monospace">${esc(n.short)}</text>`);
    }
  });

  o.push(`</g>`);

  if (opts.mark){
    o.push(`<text x="${W-PAD}" y="${H-22}" text-anchor="end" fill="${T.mark}" font-size="13" font-weight="500" letter-spacing=".4">${esc(opts.mark)}</text>`);
  }
  o.push(`</svg>`);
  return {svg:o.join(""), W, H, scale};
}
