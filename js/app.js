/* Interfaz: estado, vista previa, exportación y eventos. */
(function(){
  "use strict";

  /* ───────────── ejemplo de muestra (inventado, no es un flujo real) ───────────── */
  const DEMO = {
    name:"Ejemplo · Publicación automática de blog",
    nodes:[
      {name:"Cada lunes 8:00",type:"n8n-nodes-base.scheduleTrigger",position:[0,180],parameters:{}},
      {name:"Leer calendario editorial",type:"n8n-nodes-base.googleSheets",position:[200,180],parameters:{}},
      {name:"¿Hay tema pendiente?",type:"n8n-nodes-base.if",position:[400,180],parameters:{}},
      {name:"Redactar artículo",type:"@n8n/n8n-nodes-langchain.agent",position:[620,120],parameters:{}},
      {name:"Modelo de lenguaje",type:"@n8n/n8n-nodes-langchain.lmChatOpenAi",position:[600,330],parameters:{}},
      {name:"Buscar datos del sector",type:"@n8n/n8n-nodes-langchain.toolHttpRequest",position:[730,330],parameters:{}},
      {name:"Publicar como borrador",type:"n8n-nodes-base.wordpress",position:[860,120],parameters:{}},
      {name:"Avisar en Telegram",type:"n8n-nodes-base.telegram",position:[1060,120],parameters:{}},
      {name:"Marcar como publicado",type:"n8n-nodes-base.googleSheets",position:[1060,260],parameters:{}},
      {name:"Nota",type:"n8n-nodes-base.stickyNote",position:[0,-60],parameters:{width:420,height:120,color:4,content:"Flujo de ejemplo\nSustitúyelo pegando tu propio workflow arriba."}}
    ],
    connections:{
      "Cada lunes 8:00":{main:[[{node:"Leer calendario editorial",type:"main",index:0}]]},
      "Leer calendario editorial":{main:[[{node:"¿Hay tema pendiente?",type:"main",index:0}]]},
      "¿Hay tema pendiente?":{main:[[{node:"Redactar artículo",type:"main",index:0}],[]]},
      "Redactar artículo":{main:[[{node:"Publicar como borrador",type:"main",index:0}]]},
      "Publicar como borrador":{main:[[{node:"Avisar en Telegram",type:"main",index:0},{node:"Marcar como publicado",type:"main",index:0}]]},
      "Modelo de lenguaje":{ai_languageModel:[[{node:"Redactar artículo",type:"ai_languageModel",index:0}]]},
      "Buscar datos del sector":{ai_tool:[[{node:"Redactar artículo",type:"ai_tool",index:0}]]}
    }
  };

  /* ───────────── estado y DOM ───────────── */
  const $ = id => document.getElementById(id);
  let current = null; /* {svg,W,H,model,wf} */

  function opts(){
    return {
      theme: $("theme").value,
      preset: presetValue(),
      layout: $("layout").value,
      icons: $("icons").value,
      title: $("title").value.trim(),
      subtitle: $("subtitle").value.trim(),
      mark: $("mark").value.trim(),
      types: $("optTypes").checked,
      stickies: $("optStickies").checked,
      priv: $("optPrivate").checked
    };
  }

  function showErr(msg){
    const el = $("err");
    if (!msg){ el.hidden = true; el.textContent = ""; return; }
    el.hidden = false; el.textContent = msg;
  }

  let toastTimer;
  function toast(msg){
    document.querySelectorAll(".toast").forEach(t=>t.remove());
    const t = document.createElement("div");
    t.className = "toast"; t.textContent = msg; t.setAttribute("role","status");
    document.body.appendChild(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(()=>t.remove(), 3200);
  }

  function renderScan(findings){
    const box = $("scan");
    box.innerHTML = "";
    if (!findings.length){
      box.innerHTML = '<div class="finding clean"><span class="n">✓</span><span class="t">No detecté datos sensibles evidentes en este JSON.</span></div>';
      return;
    }
    findings.forEach(f=>{
      const d = document.createElement("div");
      d.className = "finding";
      d.innerHTML = '<span class="n">'+f.n+'</span><span class="t">'+esc(f.text)+'<br><code>'+esc(f.sample)+'</code></span>';
      box.appendChild(d);
    });
    const p = document.createElement("p");
    p.className = "note";
    p.textContent = "Esto es lo que entregarías si pegaras el JSON completo en un servicio en línea. Aquí no sale de tu navegador, y nada de esto llega a la imagen.";
    box.appendChild(p);
  }

  function draw(){
    if (!current || !current.wf) return;
    const o = opts();
    const model = buildModel(current.wf, o);
    const out = drawSVG(model, o);
    current.model = model; current.svg = out.svg; current.W = out.W; current.H = out.H;
    $("stageInner").innerHTML = out.svg;
    const shown = current;
    ensureIcons(model, o).then(changed=>{ if (changed && current === shown) draw(); });
    $("stageInner").style.maxWidth = out.W + "px";
    const triggers = model.nodes.filter(n=>n.trigger).length;
    $("meta").innerHTML =
      '<span>Nodos <b>'+model.nodes.length+'</b></span>'+
      '<span>Conexiones <b>'+model.wires.length+'</b></span>'+
      '<span>Disparadores <b>'+triggers+'</b></span>'+
      '<span>Notas <b>'+model.stickies.length+'</b></span>'+
      '<span>Imagen <b>'+out.W+'×'+out.H+'</b></span>' +
      /* por debajo de ~55% los nombres de 12.5 px bajan de 7 px y dejan de leerse */
      (out.scale < 0.55
        ? '<span class="warn">Texto al <b>'+Math.round(out.scale*100)+'%</b>: usa una medida más grande o el acomodo «en filas»</span>'
        : '');
  }

  function load(text, quiet){
    showErr("");
    let wf;
    try { wf = parseWorkflow(text); }
    catch(e){
      if (!quiet) showErr("No pude leer ese JSON: " + e.message);
      return false;
    }
    current = {wf};
    $("wfName").textContent = wf.name || "Vista previa";
    renderScan(scanRaw(text, wf));
    draw();
    return true;
  }

  /* ───────────── exportar ───────────── */
  /* antes de exportar, que no falte ningún logo por descargar */
  async function ready(){
    if (await ensureIcons(current.model, opts())) draw();
  }
  function svgBlob(){
    return new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n' + current.svg], {type:"image/svg+xml;charset=utf-8"});
  }
  function toPng(scale){
    return new Promise((resolve, reject)=>{
      const url = URL.createObjectURL(svgBlob());
      const img = new Image();
      img.onload = ()=>{
        const c = document.createElement("canvas");
        c.width = Math.round(current.W*scale);
        c.height = Math.round(current.H*scale);
        const ctx = c.getContext("2d");
        ctx.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob(b => b ? resolve(b) : reject(new Error("No se pudo generar el PNG.")), "image/png");
      };
      img.onerror = ()=>{ URL.revokeObjectURL(url); reject(new Error("No se pudo convertir el dibujo.")); };
      img.src = url;
    });
  }
  function fileName(ext){
    const base = ((current && current.wf && current.wf.name) || "flujo-n8n")
      .toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"")
      .replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,60) || "flujo-n8n";
    return base + "." + ext;
  }

  let downloads = null, downloadsReady = false;
  (async ()=>{
    try { downloads = await window.claude?.use?.("downloads"); } catch(e){ downloads = null; }
    downloadsReady = true;
  })();

  async function save(filename, data){
    if (!downloads){
      /* abierto como archivo suelto: descarga normal del navegador */
      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(()=>URL.revokeObjectURL(url), 4000);
      toast("Listo: " + filename);
      return;
    }
    try {
      await downloads.save({filename, data});
      toast("Listo: " + filename);
    } catch(e){
      const code = e && e.code;
      if (code === "declined") return;
      if (code === "rate_limited") toast("Espera un momento y vuelve a intentarlo.");
      else toast("No se pudo guardar el archivo.");
    }
  }

  /* ───────────── eventos ───────────── */
  $("btnRender").addEventListener("click", ()=>{
    const t = $("json").value.trim();
    if (!t){ showErr("Pega primero el JSON del workflow."); return; }
    if (load(t)) toast("Flujo dibujado.");
  });
  $("btnDemo").addEventListener("click", ()=>{
    const t = JSON.stringify(DEMO, null, 2);
    $("json").value = t;
    load(t);
  });
  $("btnClear").addEventListener("click", ()=>{
    $("json").value = ""; showErr("");
    $("scan").innerHTML = '<p class="note">Pega un workflow para revisarlo.</p>';
  });

  /* medida personalizada: se acota a un rango que el navegador pueda exportar sin problemas */
  const clampSize = v => Math.min(8000, Math.max(300, Math.round(Number(v) || 0)));
  function presetValue(){
    const p = $("preset").value;
    if (p !== "custom") return p;
    return clampSize($("sizeW").value) + "x" + clampSize($("sizeH").value);
  }
  $("preset").addEventListener("change", ()=>{
    $("customSize").hidden = $("preset").value !== "custom";
  });
  ["sizeW","sizeH"].forEach(id=>{
    $(id).addEventListener("input", draw);
    $(id).addEventListener("change", ()=>{ $(id).value = clampSize($(id).value); draw(); });
  });
  $("sizeSwap").addEventListener("click", ()=>{
    const w = $("sizeW").value;
    $("sizeW").value = $("sizeH").value; $("sizeH").value = w;
    draw();
  });

  ["theme","preset","layout","icons","title","subtitle","mark"].forEach(id=>{
    $(id).addEventListener("input", draw);
    $(id).addEventListener("change", draw);
  });
  ["optTypes","optStickies","optPrivate"].forEach(id=>{
    $(id).addEventListener("change", ()=>{
      if (!current) return;
      const txt = $("json").value.trim();
      if (txt) renderScan(scanRaw(txt, current.wf));
      draw();
    });
  });

  $("btnPng").addEventListener("click", async ()=>{
    if (!current) return;
    try { await ready(); await save(fileName("png"), await toPng(2)); } catch(e){ toast(e.message); }
  });
  $("btnPng3").addEventListener("click", async ()=>{
    if (!current) return;
    try { await ready(); await save(fileName("png"), await toPng(3)); } catch(e){ toast(e.message); }
  });
  $("btnSvg").addEventListener("click", async ()=>{
    if (!current) return;
    await ready();
    save(fileName("svg"), svgBlob());
  });
  $("btnCopy").addEventListener("click", async ()=>{
    if (!current) return;
    try {
      /* la promesa va dentro del ClipboardItem para no perder el permiso del clic */
      await navigator.clipboard.write([new ClipboardItem({"image/png": ready().then(()=>toPng(2))})]);
      toast("Imagen copiada al portapapeles.");
    } catch(e){
      toast("Tu navegador no dejó copiar la imagen. Usa la descarga.");
    }
  });

  /* arrastrar archivo */
  const drop = $("drop");
  ["dragenter","dragover"].forEach(ev=>drop.addEventListener(ev, e=>{e.preventDefault();drop.classList.add("hot");}));
  ["dragleave","drop"].forEach(ev=>drop.addEventListener(ev, e=>{e.preventDefault();drop.classList.remove("hot");}));
  drop.addEventListener("drop", e=>{
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = ()=>{ $("json").value = r.result; load(String(r.result)); };
    r.readAsText(f);
  });

  /* arranque: ejemplo cargado para que la página abra funcionando */
  $("json").value = JSON.stringify(DEMO, null, 2);
  load($("json").value, true);
})();
