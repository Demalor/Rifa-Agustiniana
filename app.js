import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, onSnapshot, runTransaction, updateDoc, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js?v=3";
import { GANADOR as GANADOR_FIJO } from "./ganador.js?v=13";

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
let ganadorActual = null;
const esGanador = n => ganadorActual === n;
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
    b.classList.toggle("gana", esGanador(n));
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

/* ---------- Pantalla del número ---------- */
// resultado: null | { tipo: "ok" | "ocupado" | "error", titulo, msg }
let resultado = null, borrador = null, formError = "";

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
function animar(el, clase, ms) {
  return new Promise(ok => {
    el.classList.remove("entrar", "salir-arriba", "salir-abajo");
    if (reduceMotion) return ok();
    void el.offsetWidth; el.classList.add(clase);
    setTimeout(ok, ms);
  });
}

function abrir(n) {
  current = n; resultado = null; borrador = null; formError = ""; confirming = false;
  const card = $("sheetIn");
  $("sheet").classList.remove("cerrando");
  drawSheet(true); $("sheet").hidden = false; document.body.classList.add("modal");
  card.scrollTop = 0; animar(card, "entrar", 380); render();
}
let cerrandoAhora = false;
async function cerrar() {
  if (busy || cerrandoAhora || !current) return; // no cerrar a mitad de una operación
  cerrandoAhora = true;
  $("sheet").classList.add("cerrando");
  await animar($("sheetIn"), "salir-abajo", 260);
  current = null; resultado = null; $("sheet").hidden = true; document.body.classList.remove("modal");
  $("sheetIn").classList.remove("salir-abajo"); cerrandoAhora = false; render();
}
$("backdrop").onclick = cerrar;
document.addEventListener("keydown", e => { if (e.key === "Escape" && current) cerrar(); });

function leerFormulario() {
  if (!$("fComprador")) return borrador;
  return {
    comprador: $("fComprador").value.trim(),
    telefono: $("fTel").value.trim(),
    vendedor: $("fVendedor").value.trim(),
    estado: (document.querySelector('input[name="est"]:checked') || {}).value || "pendiente"
  };
}

function hero(n, e, titulo, sub, extra = "") {
  return `<div class="hero ${e === "pendiente" ? "pend" : e === "pagado" ? "pago" : ""}">
    <button class="btn ghost x" type="button" id="cerrar" aria-label="Cerrar" ${busy ? "disabled" : ""}>✕</button>
    ${extra}
    <div class="hero-num" aria-hidden="true">${n}</div>
    <h2 id="shTitle">${titulo}</h2>
    <p>${sub}</p>
  </div>`;
}

function drawSheet(fresh) {
  const n = current, e = estado(n), d = data[n] || {}, el = $("sheetIn");
  if (!n) return;
  if (n === QR) { if (fresh) drawQR(); return; }
  if (n === IMG) { if (fresh) drawImg(); return; }

  // Pantalla de resultado: no se toca con las actualizaciones en vivo
  if (resultado) {
    if (!fresh && el.dataset.state === "res") return;
    el.dataset.state = "res";
    const r = resultado;
    const icono = r.tipo === "ok" ? "✓" : r.tipo === "ocupado" ? "✕" : "!";
    const botones = r.tipo === "ok"
      ? `<button class="btn primary" id="rOk" type="button">Listo</button>`
      : r.tipo === "ocupado"
        ? `<button class="btn primary" id="rOtro" type="button">Elegir otro número</button><button class="btn ghost" id="rVer" type="button">Ver quién lo tiene</button>`
        : `<button class="btn primary" id="rRetry" type="button">Intentar de nuevo</button><button class="btn ghost" id="rOk" type="button">Cerrar</button>`;
    el.innerHTML = hero(n, r.tipo === "ok" ? e : r.tipo === "ocupado" ? (e || "pendiente") : null, r.titulo, r.msg,
        `<div class="res-icon ${r.tipo}" aria-hidden="true">${icono}</div>`)
      + `<div class="body"><div class="actions">${botones}</div></div>`;
    $("rOk") && ($("rOk").onclick = cerrar);
    $("rOtro") && ($("rOtro").onclick = cerrar);
    $("rVer") && ($("rVer").onclick = () => { resultado = null; drawSheet(true); });
    $("rRetry") && ($("rRetry").onclick = () => { resultado = null; drawSheet(true); });
    $("cerrar").onclick = cerrar;
    $("rOk") ? $("rOk").focus() : $("rOtro") ? $("rOtro").focus() : $("rRetry").focus();
    return;
  }

  const key = n + "|" + e + "|" + confirming + "|" + busy + "|" + formError;
  // No redibujar el formulario mientras alguien escribe
  if (!fresh && el.dataset.state === key && (!e || el.dataset.v === JSON.stringify(d))) return;

  if (!e) {
    if ($("fComprador")) borrador = leerFormulario();
    const b = borrador || { comprador: "", telefono: "", vendedor: vendedorGuardado, estado: "pendiente" };
    const dis = busy ? "disabled" : "";
    el.innerHTML = hero(n, null, "Número libre", "Boleta de " + fmt(PRECIO))
      + `<form id="f" class="body" novalidate>
      <label>Comprador<input type="text" id="fComprador" autocomplete="off" placeholder="Nombre de quien compra" value="${esc(b.comprador)}" ${dis}></label>
      <label>Teléfono<input type="tel" id="fTel" autocomplete="off" inputmode="tel" placeholder="Opcional" value="${esc(b.telefono)}" ${dis}></label>
      <label>Vendido por<input type="text" id="fVendedor" autocomplete="off" placeholder="Tu nombre" value="${esc(b.vendedor)}" ${dis}></label>
      <div class="seg" role="radiogroup" aria-label="Estado de pago">
        <input type="radio" name="est" id="eP" value="pendiente" ${b.estado !== "pagado" ? "checked" : ""} ${dis}><label for="eP"><i style="background:var(--green)"></i>Pendiente de pago</label>
        <input type="radio" name="est" id="eG" value="pagado" ${b.estado === "pagado" ? "checked" : ""} ${dis}><label for="eG"><i style="background:var(--red)"></i>Ya pagó</label>
      </div>
      ${formError ? `<p class="form-err" role="alert">${esc(formError)}</p>` : ""}
      <div class="actions"><button class="btn primary" id="fGo" ${dis}>${busy ? '<span class="spin"></span>Apartando…' : "Apartar el " + n}</button></div>
    </form>`;
    $("f").onsubmit = ev => { ev.preventDefault(); reservar(n); };
  } else {
    const dis = busy ? "disabled" : "";
    el.innerHTML = hero(n, e, e === "pagado" ? "Pagado" : "Apartado · pendiente de pago", "Vendido por " + esc(d.vendedor || "—"))
      + `<div class="body"><dl class="info">
        <dt>Comprador</dt><dd>${esc(d.comprador || "—")}</dd>
        <dt>Teléfono</dt><dd>${esc(d.telefono || "—")}</dd>
        <dt>Vendedor</dt><dd>${esc(d.vendedor || "—")}</dd>
        <dt>Apartado</dt><dd>${fecha(d.fecha)}</dd>
        ${d.pagadoEn ? `<dt>Pagado</dt><dd>${fecha(d.pagadoEn)}</dd>` : ""}
      </dl>
      ${confirming ? `<div class="confirm"><b>¿Liberar el ${n}?</b><span>Se borra el apartado de ${esc(d.comprador || "este comprador")} y el número vuelve a quedar libre.</span>
        <div class="actions"><button class="btn red" id="liberarOk" type="button" ${dis}>${busy ? '<span class="spin"></span>Liberando…' : "Sí, liberar"}</button><button class="btn ghost" id="liberarNo" type="button" ${dis}>Cancelar</button></div></div>`
      : `<div class="actions">
        ${e === "pendiente"
          ? `<button class="btn primary" id="pagar" type="button" ${dis}>${busy ? '<span class="spin"></span>Guardando…' : "Marcar como pagado"}</button>`
          : `<button class="btn ghost" id="despagar" type="button" ${dis}>${busy ? '<span class="spin"></span>Guardando…' : "Volver a pendiente"}</button>`}
        <button class="btn ghost" id="liberar" type="button" ${dis}>Liberar número</button></div>`}</div>`;
    $("pagar") && ($("pagar").onclick = () => cambiar(n, { estado: "pagado", pagadoEn: serverTimestamp() },
      { titulo: "¡Pago registrado!", msg: `El ${n} de ${esc(d.comprador || "este comprador")} quedó como pagado.` }));
    $("despagar") && ($("despagar").onclick = () => cambiar(n, { estado: "pendiente", pagadoEn: null },
      { titulo: "Vuelve a pendiente", msg: `El ${n} quedó otra vez como pendiente de pago.` }));
    $("liberar") && ($("liberar").onclick = () => { confirming = true; drawSheet(true); });
    $("liberarNo") && ($("liberarNo").onclick = () => { confirming = false; drawSheet(true); });
    $("liberarOk") && ($("liberarOk").onclick = () => liberar(n, d));
  }
  el.dataset.state = n + "|" + e + "|" + confirming + "|" + busy + "|" + formError;
  el.dataset.v = JSON.stringify(d);
  $("cerrar").onclick = cerrar;
}

// La tarjeta del formulario se va hacia arriba y la del resultado sube desde abajo
async function mostrarResultado(r) {
  if (!current) return;
  const card = $("sheetIn");
  await animar(card, "salir-arriba", 300);
  resultado = r; drawSheet(true); card.scrollTop = 0;
  await animar(card, "entrar", 380);
}
function textoError(e) {
  const c = e && e.code || "";
  if (c.includes("permission-denied")) return "La base de datos rechazó el cambio (permisos). Revisa las reglas de Firestore.";
  if (c.includes("unavailable") || !navigator.onLine) return "No hay conexión a internet. Revisa tu señal e inténtalo de nuevo.";
  return "Algo falló al guardar (" + (c || (e && e.message) || "error desconocido") + ").";
}

/* ---------- QR de Nequi ---------- */
const QR = "QR";
const NEQUI = "3223808103";
function drawQR() {
  const el = $("sheetIn"); el.dataset.state = "qr";
  el.innerHTML = `<div class="hero">
      <button class="btn ghost x" type="button" id="cerrar" aria-label="Cerrar">✕</button>
      <h2 id="shTitle" style="margin-top:6px">Paga con Nequi</h2>
      <p>A nombre de <b>Julian Sarmiento</b> · boleta de ${fmt(PRECIO)}</p>
    </div>
    <div class="body">
      <div class="qr-box"><img src="nequi-qr.png?v=10" alt="Código QR de Nequi para pagar la rifa" id="qrImg"></div>
      <div class="nequi-num"><span>Nequi<br><b>${NEQUI}</b></span><button class="btn ghost" type="button" id="copiarNequi">Copiar número</button></div>
      <p class="qr-nota">Escanéalo desde la app de Nequi. Después de pagar, envía el comprobante a quien te vendió el número.</p>
      <div class="actions"><button class="btn primary" type="button" id="bajarQR">Descargar QR</button></div>
    </div>`;
  $("qrImg").onerror = () => { $("qrImg").parentElement.innerHTML = '<div class="qr-falta">El QR todavía no está cargado.</div>'; $("bajarQR").hidden = true; };
  $("cerrar").onclick = cerrar;
  $("copiarNequi").onclick = async () => {
    try { await navigator.clipboard.writeText(NEQUI); toast("Número de Nequi copiado"); }
    catch (e) { toast("No se pudo copiar. El número es " + NEQUI); }
  };
  $("bajarQR").onclick = async () => {
    try {
      const blob = await (await fetch("nequi-qr.png?v=10")).blob();
      bajarBlob(blob, "qr-nequi-rifa.png"); toast("QR descargado");
    } catch (e) { toast("No se pudo descargar el QR"); }
  };
}

function bajarBlob(blob, nombre) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

/* ---------- Menú ---------- */
const menu = $("menu"), menuBtn = $("menuBtn");
function menuAbierto(v) { menu.hidden = !v; menuBtn.setAttribute("aria-expanded", String(v)); if (v) menu.querySelector("button").focus(); }
menuBtn.onclick = e => { e.stopPropagation(); menuAbierto(menu.hidden); };
document.addEventListener("click", e => { if (!menu.hidden && !menu.contains(e.target)) menuAbierto(false); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && !menu.hidden) { menuAbierto(false); menuBtn.focus(); } });
// El QR se muestra en la misma tarjeta que sube desde abajo
function mostrarQR() { menuAbierto(false); abrir(QR); }
$("verQR").onclick = mostrarQR;

/* ---------- Escrituras ---------- */
async function reservar(n) {
  if (busy) return; // evita doble toque
  const f = leerFormulario(); borrador = f;
  if (!f.comprador || !f.vendedor) {
    formError = !f.comprador ? "Escribe el nombre del comprador." : "Escribe quién lo vendió.";
    drawSheet(true); ($(!f.comprador ? "fComprador" : "fVendedor") || {}).focus?.(); return;
  }
  formError = "";
  if (!db) { mostrarResultado({ tipo: "error", titulo: "Sin conexión", msg: "La página no está conectada a la base de datos. Recarga e inténtalo de nuevo." }); return; }
  try { localStorage.setItem("rifa.vendedor", f.vendedor); vendedorGuardado = f.vendedor; } catch (e) {}

  busy = true; drawSheet(true);
  try {
    // Transacción: lee el número y solo lo crea si nadie lo tiene.
    // Si dos personas lo intentan a la vez, Firestore reintenta y la segunda ve que ya existe.
    await runTransaction(db, async tx => {
      const ref = doc(db, COL, n);
      const snap = await tx.get(ref);
      if (snap.exists()) {
        const err = new Error("ocupado");
        err.dato = snap.data();
        throw err;
      }
      tx.set(ref, {
        numero: n, estado: f.estado, comprador: f.comprador, telefono: f.telefono, vendedor: f.vendedor,
        fecha: serverTimestamp(),
        pagadoEn: f.estado === "pagado" ? serverTimestamp() : null
      });
    });
    busy = false; borrador = null;
    mostrarResultado({ tipo: "ok", titulo: "¡Número apartado!",
      msg: `El ${n} quedó para ${esc(f.comprador)} · ${f.estado === "pagado" ? "pagado" : "pendiente de pago"}.` });
  } catch (e) {
    busy = false;
    if (e.message === "ocupado") {
      const d = e.dato || {};
      mostrarResultado({ tipo: "ocupado", titulo: "Este número ya fue tomado",
        msg: `${esc(d.vendedor || "Otra persona")} ya apartó el ${n}${d.comprador ? " para " + esc(d.comprador) : ""}. No se guardó tu venta.` });
    } else {
      mostrarResultado({ tipo: "error", titulo: "No se pudo apartar", msg: textoError(e) + " Tu venta no quedó guardada." });
    }
  }
}

async function cambiar(n, patch, ok) {
  if (busy) return;
  busy = true; drawSheet(true);
  try { await updateDoc(doc(db, COL, n), patch); busy = false; mostrarResultado({ tipo: "ok", ...ok }); }
  catch (e) { busy = false; mostrarResultado({ tipo: "error", titulo: "No se pudo guardar", msg: textoError(e) }); }
}

async function liberar(n, d) {
  if (busy) return;
  busy = true; drawSheet(true);
  try {
    await deleteDoc(doc(db, COL, n)); busy = false; confirming = false;
    mostrarResultado({ tipo: "ok", titulo: "Número liberado", msg: `El ${n} volvió a quedar disponible.` });
  } catch (e) { busy = false; confirming = false; mostrarResultado({ tipo: "error", titulo: "No se pudo liberar", msg: textoError(e) }); }
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

  return new Promise(ok => c.toBlob(ok, "image/jpeg", 0.92));
}

// Imagen del tablero: se muestra en la tarjeta para guardarla en la galería
const IMG = "IMG";
let imgArchivo = null, imgURL = null;

$("descargar").onclick = async () => {
  const btn = $("descargar");
  const original = btn.innerHTML;
  btn.disabled = true; btn.lastChild.textContent = "Generando imagen…";
  try {
    const blob = await generarImagen();
    const h = new Date();
    const nombre = `rifa-numeros-${h.getFullYear()}-${pad(h.getMonth() + 1)}-${pad(h.getDate())}-${pad(h.getHours())}${pad(h.getMinutes())}.jpg`;
    if (imgURL) URL.revokeObjectURL(imgURL);
    imgArchivo = new File([blob], nombre, { type: "image/jpeg" });
    imgURL = URL.createObjectURL(blob);
    menuAbierto(false);
    abrir(IMG);
  } catch (e) {
    toast("No se pudo generar la imagen");
  } finally {
    btn.disabled = false; btn.innerHTML = original;
  }
};

function puedeCompartir() {
  try { return !!(imgArchivo && navigator.canShare && navigator.canShare({ files: [imgArchivo] })); } catch (e) { return false; }
}

function drawImg() {
  const el = $("sheetIn"); el.dataset.state = "img";
  const share = puedeCompartir();
  el.innerHTML = `<div class="hero">
      <button class="btn ghost x" type="button" id="cerrar" aria-label="Cerrar">✕</button>
      <h2 id="shTitle" style="margin-top:6px">Imagen del tablero</h2>
      <p>${share ? "Toca Guardar o compartir y elige Guardar imagen para que quede en tu galería." : "Mantén presionada la imagen y elige Guardar imagen o Descargar imagen."}</p>
    </div>
    <div class="body">
      <img class="img-prev" src="${imgURL}" alt="Tablero de la rifa con los números apartados y pagados">
      <div class="actions">
        ${share ? '<button class="btn primary" type="button" id="compartirImg">Guardar o compartir</button>' : ""}
        <button class="btn ${share ? "ghost" : "primary"}" type="button" id="bajarImg">Descargar archivo</button>
      </div>
      <p class="qr-nota">Si usas “Descargar archivo” en el celular, la imagen queda en la carpeta Descargas o en la app Archivos, no en la galería.</p>
    </div>`;
  $("cerrar").onclick = cerrar;
  $("bajarImg").onclick = () => { bajarBlob(imgArchivo, imgArchivo.name); toast("Imagen descargada"); };
  $("compartirImg") && ($("compartirImg").onclick = async () => {
    try { await navigator.share({ files: [imgArchivo], title: "Rifa Uniagustiniana" }); }
    catch (e) { if (e.name !== "AbortError") toast("No se pudo abrir el menú de compartir"); }
  });
}


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

/* ---------- Número ganador ---------- */
// Vista previa: agrega ?prueba=42 al link para ensayar la animación sin publicar nada
const prueba = (() => { try { const v = new URLSearchParams(location.search).get("prueba"); return v && /^\d{1,2}$/.test(v) ? pad(+v) : null; } catch (e) { return null; } })();
const GANADOR = prueba || (GANADOR_FIJO != null && /^\d{1,2}$/.test(String(GANADOR_FIJO)) ? pad(+GANADOR_FIJO) : null);
ganadorActual = GANADOR;

function infoGanador() {
  if (!GANADOR) return;
  const d = data[GANADOR] || {};
  const nombre = estado(GANADOR) && d.comprador && !/^Del afiche/i.test(d.comprador) ? d.comprador : "";
  $("winQuien").textContent = nombre; $("winQuien").hidden = !nombre;
  $("wbN").textContent = GANADOR; $("wbQ").textContent = nombre;
}

function armarCarrete(reel, final, vueltas) {
  const nums = [];
  for (let v = 0; v < vueltas; v++) for (let i = 0; i < 10; i++) nums.push(i);
  for (let i = 0; i <= +final; i++) nums.push(i);
  reel.innerHTML = nums.map(n => `<span>${n}</span>`).join("");
  reel.style.transition = "none"; reel.style.transform = "translateY(0)";
  return nums.length - 1;
}

function girar() {
  const w = $("win");
  w.classList.remove("revelado");
  $("winInfo").hidden = true; $("winActions").hidden = true; $("winSr").textContent = "";
  const dig = GANADOR.split("");
  const reels = [$("reel0"), $("reel1")];
  // El sorteo siempre se anima (es el momento de la celebración), aunque el celular tenga "Reducir movimiento"
  const dur = [3200, 4600];
  const idx = reels.map((r, i) => armarCarrete(r, dig[i], 5 + i * 3));
  requestAnimationFrame(() => requestAnimationFrame(() => {
    reels.forEach((r, i) => {
      const h = r.parentElement.getBoundingClientRect().height;
      r.style.transition = `transform ${dur[i]}ms cubic-bezier(.12,.72,.18,1)`;
      r.style.transform = `translateY(${-idx[i] * h}px)`;
    });
  }));
  setTimeout(() => {
    w.classList.add("revelado");
    infoGanador();
    $("winSr").textContent = "El número ganador es el " + GANADOR;
    $("winInfo").hidden = false; $("winActions").hidden = false;
    $("winVer").focus();
    confeti();
  }, dur[1] + 150);
}

function abrirSorteo() {
  $("win").hidden = false; document.body.classList.add("modal");
  girar();
}
function cerrarSorteo() {
  $("win").hidden = true; detenerConfeti();
  if (!current) document.body.classList.remove("modal");
  $("winBanner").hidden = false;
}

// Confeti: una explosión que sale de detrás de los rodillos hacia los lados
// y una lluvia que cae por delante de toda la pantalla
let confetiRAF = 0;
const COLORES = ["#ffd31a", "#ffffff", "#22c55e", "#ef4444", "#3b82f6", "#ffe773", "#f472b6"];
function lienzo(id) {
  const c = $(id), dpr = Math.min(devicePixelRatio || 1, 2);
  c.width = innerWidth * dpr; c.height = innerHeight * dpr;
  return { c, g: c.getContext("2d"), W: c.width, H: c.height, dpr };
}
function pieza(x, y, vx, vy, dpr, lluvia) {
  return { x, y, vx, vy, r: (4 + Math.random() * 6) * dpr, rot: Math.random() * 6, vr: (Math.random() - .5) * .35,
    giro: Math.random() * 6, vg: .05 + Math.random() * .1, c: COLORES[(Math.random() * COLORES.length) | 0],
    f: Math.random() < .7, lluvia, osc: Math.random() * 6 };
}
function dibujar(g, p) {
  g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.fillStyle = p.c;
  const sx = Math.cos(p.giro); // efecto de papel que voltea
  if (p.f) g.fillRect(-p.r * sx, -p.r / 2, p.r * 2 * sx, p.r);
  else { g.beginPath(); g.arc(0, 0, p.r / 1.7, 0, 7); g.fill(); }
  g.restore();
}
function detenerConfeti() {
  cancelAnimationFrame(confetiRAF);
  for (const id of ["confeti", "confetiAtras"]) { const c = $(id); c.getContext("2d").clearRect(0, 0, c.width, c.height); }
}
function confeti() {
  cancelAnimationFrame(confetiRAF);
  const A = lienzo("confetiAtras"), F = lienzo("confeti"), dpr = A.dpr;
  const slots = document.querySelector(".slots").getBoundingClientRect();
  const cx = (slots.left + slots.width / 2) * dpr, cy = (slots.top + slots.height / 2) * dpr;
  const atras = [], frente = [];
  // Explosión lateral desde detrás de la tarjeta
  for (let i = 0; i < 220; i++) {
    const lado = i % 2 ? 1 : -1;
    const ang = (Math.random() * 70 - 45) * Math.PI / 180;     // abanico hacia arriba/lados
    const v = (14 + Math.random() * 22) * dpr;
    atras.push(pieza(cx + lado * Math.random() * 20 * dpr, cy + (Math.random() - .5) * slots.height * .6 * dpr,
      lado * Math.cos(ang) * v, -Math.sin(ang + .35) * v, dpr, false));
  }
  const t0 = performance.now(), DUR_LLUVIA = 6500, FIN = 9500;
  let ultimo = t0;
  (function paso(t) {
    const dt = Math.min(2, (t - ultimo) / 16.7); ultimo = t;
    // Lluvia continua por delante durante unos segundos
    if (t - t0 < DUR_LLUVIA) {
      const n = Math.random() < .5 ? 3 : 2;
      for (let i = 0; i < n; i++) frente.push(pieza(Math.random() * F.W, -20 * dpr, (Math.random() - .5) * 2 * dpr, (2 + Math.random() * 3) * dpr, dpr, true));
    }
    A.g.clearRect(0, 0, A.W, A.H); F.g.clearRect(0, 0, F.W, F.H);
    let vivos = 0;
    for (const p of atras) {
      p.vy += .5 * dpr * dt; p.vx *= Math.pow(.97, dt); p.vy *= Math.pow(.985, dt);
      p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt; p.giro += p.vg * dt;
      if (p.y < A.H + 40) { vivos++; dibujar(A.g, p); }
    }
    for (const p of frente) {
      p.osc += .05 * dt; p.vy = Math.min(p.vy + .06 * dpr * dt, 4.5 * dpr);
      p.x += (p.vx + Math.sin(p.osc) * 1.2 * dpr) * dt; p.y += p.vy * dt; p.rot += p.vr * dt; p.giro += p.vg * dt;
      if (p.y < F.H + 40) { vivos++; dibujar(F.g, p); }
    }
    if ((vivos || t - t0 < DUR_LLUVIA) && t - t0 < FIN + 4000) confetiRAF = requestAnimationFrame(paso);
    else detenerConfeti();
  })(t0);
}

if (GANADOR) {
  $("winVer").onclick = cerrarSorteo;
  $("winOtra").onclick = girar;
  $("winBanner").onclick = abrirSorteo;
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("win").hidden) cerrarSorteo(); });
  infoGanador();
  // Arranca justo cuando termina el splash
  setTimeout(abrirSorteo, 3000);
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
      if (GANADOR) infoGanador();
      setStatus("En vivo · se actualiza solo cuando alguien aparta o paga");
      render();
    }, err => setStatus("Se perdió la conexión (" + err.code + "). Recarga la página.", true));
  });
  signInAnonymously(auth).catch(e =>
    setStatus("No se pudo iniciar sesión anónima (" + e.code + "). Actívala en Firebase › Authentication.", true));
}
