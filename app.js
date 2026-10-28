import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, onSnapshot, runTransaction, updateDoc, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

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

/* ---------- Arranque ---------- */
if (!firebaseConfig || !firebaseConfig.apiKey || firebaseConfig.apiKey.startsWith("PEGA")) {
  setStatus("Falta configurar Firebase: pega tu configuración en firebase-config.js (ver README).", true);
} else {
  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  const auth = getAuth(app);
  onAuthStateChanged(auth, user => {
    if (!user) return;
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
