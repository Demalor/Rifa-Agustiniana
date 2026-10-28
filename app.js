import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, onSnapshot, runTransaction, updateDoc, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js?v=3";

const PRECIO = 15000;
const COL = "numeros";
const fmt = v => "$" + v.toLocaleString("es-CO");
const pad = n => String(n).padStart(2, "0");
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fecha = v => {
  if (!v) return "—";
  const d = typeof v.toDate === "function" ? v.toDate() : new Date(v);
  return isNaN(d) ? "—" : d.toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" });
};

let db = null, data = {}, current = null, q = "", confirming = false, busy = false;
let vendedorGuardado = "";
try { vendedorGuardado = localStorage.getItem("rifa.vendedor") || ""; } catch (e) {}

/* ---------- Tablero ---------- */
const board = $("board");
for (let i = 0; i < 100; i++) {
  const b = document.createElement("button");
  b.className = "n"; b.id = "n" + pad(i); b.textContent = pad(i); b.type = "button";
  b.onclick = () => abrir(pad(i));
  board.appendChild(b);
}

function estado(n) {
  const d = data[n];
  return d && (d.estado === "pendiente" || d.estado === "pagado") ? d.estado : null;
}

function render() {
  let p = 0, g = 0;
  for (let i = 0; i < 100; i++) {
    const n = pad(i), b = $("n" + n), e = estado(n), d = data[n] || {};
    b.classList.toggle("pend", e === "pendiente");
    b.classList.toggle("pago", e === "pagado");
    b.classList.toggle("sel", current === n);
    const hit = !q || (e && ((d.comprador || "") + " " + (d.vendedor || "")).toLowerCase().includes(q));
    b.classList.toggle("dim", !hit);
    b.setAttribute("aria-label", n + (e === "pagado" ? " pagado" : e === "pendiente" ? " pendiente" : " libre") + (d.comprador ? ", " + d.comprador : ""));
    if (e === "pendiente") p++;
    if (e === "pagado") g++;
  }
  $("sLibres").textContent = 100 - p - g;
  $("sPend").textContent = p;
  $("sPago").textContent = g;
  $("sPlata").textContent = fmt(g * PRECIO);
  $("porCobrar").textContent = p ? `Por cobrar: ${fmt(p * PRECIO)}` : "";
  if (current) drawSheet();
}
$("buscar").addEventListener("input", e => { q = e.target.value.trim().toLowerCase(); render(); });

function toast(t) {
  const el = $("toast");
  el.textContent = t; el.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (el.hidden = true), 2800);
}
function setStatus(t, err) { const s = $("status"); s.textContent = t; s.classList.toggle("err", !!err); }

/* ---------- Hoja inferior ---------- */
function abrir(n) { current = n; drawSheet(true); $("sheet").hidden = false; render(); }
function cerrar() { current = null; $("sheet").hidden = true; render(); }
document.addEventListener("keydown", e => { if (e.key === "Escape" && current) cerrar(); });

function drawSheet(fresh) {
  if (fresh) confirming = false;
  const n = current, e = estado(n), d = data[n] || {}, el = $("sheetIn");
  const key = n + "|" + e + "|" + confirming;
  // No redibujar el formulario mientras alguien escribe
  if (!fresh && el.dataset.state === key && !e) return;
  if (!fresh && el.dataset.state === key && e && el.dataset.v === JSON.stringify(d)) return;
  el.dataset.state = key; el.dataset.v = JSON.stringify(d);

  const head = `<div class="sh-head"><div class="big ${e === "pendiente" ? "pend" : e === "pagado" ? "pago" : ""}">${n}</div>
    <div><h2 id="shTitle">${e === "pagado" ? "Pagado" : e === "pendiente" ? "Apartado · pendiente" : "Número libre"}</h2>
    <p>${e ? "Vendido por " + esc(d.vendedor || "—") : "Boleta de " + fmt(PRECIO)}</p></div>
    <button class="btn ghost x" type="button" id="cerrar" aria-label="Cerrar">✕</button></div>`;

  if (!e) {
    el.innerHTML = head + `<form id="f" class="in" style="gap:12px">
      <div class="grid2">
        <label>Comprador<input type="text" id="fComprador" required autocomplete="off" placeholder="Nombre"></label>
        <label>Teléfono<input type="tel" id="fTel" autocomplete="off" placeholder="Opcional"></label>
      </div>
      <label>Vendido por<input type="text" id="fVendedor" required autocomplete="off" placeholder="Tu nombre" value="${esc(vendedorGuardado)}"></label>
      <div class="seg" role="radiogroup" aria-label="Estado de pago">
        <input type="radio" name="est" id="eP" value="pendiente" checked><label for="eP"><i style="background:var(--green)"></i>Pendiente de pago</label>
        <input type="radio" name="est" id="eG" value="pagado"><label for="eG"><i style="background:var(--red)"></i>Ya pagó</label>
      </div>
      <div class="actions"><button class="btn primary" id="fGo">Apartar el ${n}</button></div>
    </form>`;
    $("f").onsubmit = ev => { ev.preventDefault(); reservar(n); };
    setTimeout(() => $("fComprador") && $("fComprador").focus(), 50);
  } else {
    el.innerHTML = head + `<dl class="info">
        <dt>Comprador</dt><dd>${esc(d.comprador || "—")}</dd>
        <dt>Teléfono</dt><dd>${esc(d.telefono || "—")}</dd>
        <dt>Vendedor</dt><dd>${esc(d.vendedor || "—")}</dd>
        <dt>Apartado</dt><dd>${fecha(d.fecha)}</dd>
        ${d.pagadoEn ? `<dt>Pagado</dt><dd>${fecha(d.pagadoEn)}</dd>` : ""}
      </dl>
      ${confirming ? `<div class="confirm"><b>¿Liberar el ${n}?</b><span>Se borra el apartado de ${esc(d.comprador || "este comprador")} y el número vuelve a quedar libre.</span>
        <div class="actions"><button class="btn red" id="liberarOk" type="button">Sí, liberar</button><button class="btn ghost" id="liberarNo" type="button">Cancelar</button></div></div>`
      : `<div class="actions">
        ${e === "pendiente"
          ? `<button class="btn primary" id="pagar" type="button" ${busy ? "disabled" : ""}>Marcar como pagado</button>`
          : `<button class="btn ghost" id="despagar" type="button" ${busy ? "disabled" : ""}>Volver a pendiente</button>`}
        <button class="btn ghost" id="liberar" type="button">Liberar número</button></div>`}`;
    $("pagar") && ($("pagar").onclick = () => cambiar(n, { estado: "pagado", pagadoEn: serverTimestamp() }, "Número " + n + " marcado como pagado"));
    $("despagar") && ($("despagar").onclick = () => cambiar(n, { estado: "pendiente", pagadoEn: null }, "Número " + n + " vuelve a pendiente"));
    $("liberar") && ($("liberar").onclick = () => { confirming = true; drawSheet(); });
    $("liberarNo") && ($("liberarNo").onclick = () => { confirming = false; drawSheet(); });
    $("liberarOk") && ($("liberarOk").onclick = () => liberar(n));
  }
  $("cerrar").onclick = cerrar;
}

/* ---------- Escrituras ---------- */
async function reservar(n) {
  if (!db) { toast("Sin conexión con la base de datos"); return; }
  const comprador = $("fComprador").value.trim();
  const vendedor = $("fVendedor").value.trim();
  if (!comprador || !vendedor) { toast("Falta el comprador o el vendedor"); return; }
  const telefono = $("fTel").value.trim();
  const est = document.querySelector('input[name="est"]:checked').value;
  try { localStorage.setItem("rifa.vendedor", vendedor); vendedorGuardado = vendedor; } catch (e) {}

  const go = $("fGo"); go.disabled = true; go.textContent = "Apartando…";
  try {
    // Transacción: lee el número y solo lo crea si nadie lo tiene.
    // Si dos personas lo intentan a la vez, Firestore reintenta y la segunda ve que ya existe.
    await runTransaction(db, async tx => {
      const ref = doc(db, COL, n);
      const snap = await tx.get(ref);
      if (snap.exists()) {
        const err = new Error("ocupado");
        err.vendedor = snap.data().vendedor;
        throw err;
      }
      tx.set(ref, {
        numero: n, estado: est, comprador, telefono, vendedor,
        fecha: serverTimestamp(),
        pagadoEn: est === "pagado" ? serverTimestamp() : null
      });
    });
    toast("Número " + n + " apartado para " + comprador);
  } catch (e) {
    if (e.message === "ocupado") toast("El " + n + " ya lo apartó " + (e.vendedor || "otra persona"));
    else toast("No se pudo guardar: " + (e.code || e.message));
  } finally {
    if (current === n) {
      if (estado(n)) drawSheet(true);
      else { const g = $("fGo"); if (g) { g.disabled = false; g.textContent = "Apartar el " + n; } }
    }
  }
}

async function cambiar(n, patch, msg) {
  busy = true; drawSheet(true);
  try { await updateDoc(doc(db, COL, n), patch); toast(msg); }
  catch (e) { toast("No se pudo guardar: " + (e.code || e.message)); }
  finally { busy = false; if (current === n) drawSheet(true); }
}

async function liberar(n) {
  try { await deleteDoc(doc(db, COL, n)); toast("Número " + n + " liberado"); }
  catch (e) { toast("No se pudo liberar: " + (e.code || e.message)); }
  confirming = false; if (current === n) drawSheet(true);
}

/* ---------- Imagen para compartir ---------- */
// Coordenadas de las celdas en afiche.jpg (1024×1536), medidas sobre la imagen original
const COLS = [[89,179],[190,272],[283,362],[371,455],[465,547],[557,641],[652,736],[747,829],[838,917],[926,1009]];
const ROWS = [[665,713],[720,766],[773,819],[827,873],[881,927],[934,979],[987,1035],[1043,1089],[1097,1143],[1151,1197]];
const COLOR_X = { pendiente: "#1fd14a", pagado: "#ff2b2b" };

function cargarImagen(src) {
  return new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = src; });
}

async function generarImagen() {
  const img = await cargarImagen("afiche.jpg?v=3");
  try { await document.fonts.load('italic 900 30px "Nunito"'); } catch (e) {}
  const S = 2; // doble resolución para que las X y los números se vean nítidos
  const c = document.createElement("canvas");
  c.width = img.naturalWidth * S; c.height = img.naturalHeight * S;
  const g = c.getContext("2d");
  g.scale(S, S);
  g.imageSmoothingQuality = "high";
  g.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight);

  for (let r = 0; r < 10; r++) for (let k = 0; k < 10; k++) {
    const n = pad(r * 10 + k), [x0, x1] = COLS[k], [y0, y1] = ROWS[r];
    const w = x1 - x0, h = y1 - y0, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    // Celda limpia (tapa cualquier marca que traiga el afiche)
    g.fillStyle = "#031a40";
    g.beginPath(); g.roundRect(x0 - 1, y0 - 1, w + 2, h + 2, 10); g.fill();
    g.fillStyle = "#ffffff";
    g.font = 'italic 900 30px "Nunito", "Arial Black", sans-serif';
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(n, cx, cy + 1);

    const e = estado(n);
    if (!e) continue;
    const dx = 20, dy = 20;
    g.lineCap = "round";
    for (const [ancho, color] of [[14, "rgba(0,0,0,.45)"], [9, COLOR_X[e]]]) {
      g.strokeStyle = color; g.lineWidth = ancho;
      g.beginPath();
      g.moveTo(cx - dx, cy - dy); g.lineTo(cx + dx, cy + dy);
      g.moveTo(cx + dx, cy - dy); g.lineTo(cx - dx, cy + dy);
      g.stroke();
    }
    // Número encima de la X para que se siga leyendo
    g.lineJoin = "round"; g.lineWidth = 5; g.strokeStyle = "#031a40";
    g.strokeText(n, cx, cy + 1);
    g.fillStyle = "#ffffff"; g.fillText(n, cx, cy + 1);
  }

  // Sello de actualización debajo del tablero
  const txt = "Actualizado: " + new Date().toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" })
    + "  ·  Disponibles: " + $("sLibres").textContent;
  g.font = '800 15px "Archivo", sans-serif';
  const tw = g.measureText(txt).width + 24;
  g.fillStyle = "#ffd31a";
  g.beginPath(); g.roundRect(512 - tw / 2, 1203, tw, 24, 12); g.fill();
  g.fillStyle = "#0b1a3f"; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(txt, 512, 1216);

  return new Promise(ok => c.toBlob(ok, "image/png"));
}

$("descargar").onclick = async () => {
  const btn = $("descargar");
  btn.disabled = true; btn.textContent = "Generando…";
  try {
    const blob = await generarImagen();
    const h = new Date();
    const nombre = `rifa-numeros-${h.getFullYear()}-${pad(h.getMonth() + 1)}-${pad(h.getDate())}-${pad(h.getHours())}${pad(h.getMinutes())}.png`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = nombre;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    toast("Imagen descargada");
  } catch (e) {
    toast("No se pudo generar la imagen");
  } finally {
    btn.disabled = false; btn.textContent = "Descargar imagen";
  }
};

/* ---------- Números que ya venían marcados en el afiche ---------- */
// Se cargan una sola vez en toda la vida de la base de datos (marca en meta/semilla).
const SEMILLA = ["13", "21", "23", "87"];
async function sembrar() {
  try {
    await runTransaction(db, async tx => {
      const metaRef = doc(db, "meta", "semilla");
      const meta = await tx.get(metaRef);
      if (meta.exists()) return;
      const refs = SEMILLA.map(n => doc(db, COL, n));
      const snaps = [];
      for (const r of refs) snaps.push(await tx.get(r));
      refs.forEach((r, i) => {
        if (!snaps[i].exists()) tx.set(r, {
          numero: SEMILLA[i], estado: "pendiente", comprador: "Del afiche (sin nombre)",
          telefono: "", vendedor: "—", fecha: serverTimestamp(), pagadoEn: null
        });
      });
      tx.set(metaRef, { hecho: true, fecha: serverTimestamp() });
    });
  } catch (e) { console.warn("Semilla no aplicada:", e.code || e.message); }
}

/* ---------- Arranque ---------- */
if (!firebaseConfig || !firebaseConfig.apiKey || firebaseConfig.apiKey.startsWith("PEGA")) {
  setStatus("Falta configurar Firebase: pega tu configuración en firebase-config.js (ver README).", true);
} else {
  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  const auth = getAuth(app);
  onAuthStateChanged(auth, user => {
    if (!user) return;
    sembrar();
    onSnapshot(collection(db, COL), snap => {
      const next = {};
      snap.forEach(d => { next[d.id] = d.data(); });
      data = next;
      setStatus("En vivo · se actualiza solo cuando alguien aparta o paga");
      render();
    }, err => setStatus("Se perdió la conexión (" + err.code + "). Recarga la página.", true));
  });
  signInAnonymously(auth).catch(e =>
    setStatus("No se pudo iniciar sesión anónima (" + e.code + "). Actívala en Firebase › Authentication.", true));
}
