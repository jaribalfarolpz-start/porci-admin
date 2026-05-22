// app.js — PorciAdmin v2.0.1 — build 2026-05-22
'use strict';

/* ═══════════════════════════════════════════
   VERSIÓN Y CONSTANTES
═══════════════════════════════════════════ */
const APP_VERSION = 'v2.0.1 — build 2026-05-22';

const USERS = [
  { user: 'administrador', pass: 'administrador1', nivel: 3, label: 'Administrador' },
  { user: 'JFOG',          pass: 'jfog1',          nivel: 2, label: 'JFOG' },
  { user: 'JFOD',          pass: 'jfod1',          nivel: 1, label: 'JFOD' },
  { user: 'JAOD',          pass: 'jaod1',          nivel: 1, label: 'JAOD' }
];

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
               'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

const INGRESOS_CAT = {
  Ventas: ['Engorde','Lechones','Reproductoras descartadas']
};
const GASTOS_CAT = {
  Alimentacion:         ['Maíz','Soya','Salvado','Premezclas/Vitaminas/Minerales','Preiniciadores','Otros insumos'],
  Sanidad_y_Veterinaria:['Vacunas','Antibióticos','Servicios veterinarios','Semen'],
  Mano_de_Obra:         ['Sueldos','Seguridad social'],
  Servicios_y_Operacion:['Agua','Energía','Combustibles','Equipos','Mantenimiento'],
  Otros_Gastos:         ['Transporte','Seguros','Imprevistos']
};
const ETAPAS      = ['Inicio','Crecimiento','Finalizador','Gestación','Lactancia','Reemplazo 2','Sementales'];
const INGREDIENTES = ['Maíz','Soya','Salvado','Núcleo'];
const INSUMOS_BODEGA = ['Maíz','Soya','Salvado','Núcleo','Sorgo','Preiniciadores'];
const INSUMO_UNITS   = { Maíz:'kg', Soya:'kg', Salvado:'kg', Núcleo:'piezas', Sorgo:'kg', Preiniciadores:'kg' };

const HIST_2025 = [
  { mes:'Enero',       ing:426639.60, gas:335884.54 },
  { mes:'Febrero',     ing:219030,    gas:284198.07 },
  { mes:'Marzo',       ing:66576.34,  gas:209485.93 },
  { mes:'Abril',       ing:165736,    gas:291422.98 },
  { mes:'Mayo',        ing:215640,    gas:298827.82 },
  { mes:'Junio',       ing:295887,    gas:285859.85 },
  { mes:'Julio',       ing:488454,    gas:450752.54 },
  { mes:'Agosto',      ing:220861,    gas:463091.29 },
  { mes:'Septiembre',  ing:269365,    gas:370552.21 },
  { mes:'Octubre',     ing:433314.90, gas:300249.63 },
  { mes:'Noviembre',   ing:262534,    gas:472853.23 },
  { mes:'Diciembre',   ing:353215,    gas:349803.02 }
];

const DATA_KEYS = ['contabilidad','insumos','bodega','cerdas','sementales','servicios','diagnosticos','partos'];

/* ═══════════════════════════════════════════
   ESTADO GLOBAL
═══════════════════════════════════════════ */
let currentUser  = null;
let isOnline     = false;
let isSyncing    = false;
let currentPage  = 'dashboard';
let contabMes    = new Date().getMonth() + 1;
let contabAnio   = new Date().getFullYear();
let insumosMes   = new Date().getMonth() + 1;
let insumosAnio  = new Date().getFullYear();
let insumosTab   = 'lista';
let bodegaInsumo = 'Maíz';
let reproTab     = 'cerdas';
let obSlide      = 0;
let dashChart    = null;
let cashChart    = null;

/* ═══════════════════════════════════════════
   DATA LAYER
═══════════════════════════════════════════ */
function getData(key)       { try { return JSON.parse(localStorage.getItem(key)) || []; } catch { return []; } }
function getObj(key)        { try { return JSON.parse(localStorage.getItem(key)) || {}; } catch { return {}; } }

async function setData(key, arr) {
  localStorage.setItem(key, JSON.stringify(arr));
  if (isOnline && !isSyncing) FirebaseREST.set(`data/${key}`, arr).catch(() => {});
}
async function setObj(key, obj) {
  localStorage.setItem(key, JSON.stringify(obj));
  if (isOnline && !isSyncing) FirebaseREST.set(`data/${key}`, obj).catch(() => {});
}

function mergeByTs(local, remote) {
  if (!Array.isArray(remote)) return local;
  const map = new Map();
  [...local, ...remote].forEach(r => {
    const ex = map.get(r.id);
    if (!ex || (r._ts || 0) > (ex._ts || 0)) map.set(r.id, r);
  });
  return [...map.values()];
}

/* ═══════════════════════════════════════════
   FIREBASE SYNC
═══════════════════════════════════════════ */
async function syncToFirebase() {
  if (!isOnline) { toast('Sin conexión a internet','error'); return; }
  isSyncing = true;
  updateConnBadge('syncing');
  for (const k of DATA_KEYS) await FirebaseREST.set(`data/${k}`, getData(k));
  await FirebaseREST.set('data/precios_cu', getObj('precios_cu'));
  const now = new Date().toISOString();
  localStorage.setItem('last_sync', now);
  await FirebaseREST.set('data/last_sync', now);
  isSyncing = false;
  updateConnBadge('ok');
  updateSyncLabel();
  toast('Sincronización completada','success');
}

async function downloadFromFirebase() {
  if (!isOnline) { toast('Sin conexión a internet','error'); return; }
  showSyncOverlay('Descargando desde Firebase…');
  for (const k of DATA_KEYS) {
    const remote = await FirebaseREST.get(`data/${k}`);
    if (remote) {
      const remArr = Array.isArray(remote) ? remote : Object.values(remote);
      localStorage.setItem(k, JSON.stringify(mergeByTs(getData(k), remArr)));
    }
  }
  const cfg = await FirebaseREST.get('data/precios_cu');
  if (cfg) localStorage.setItem('precios_cu', JSON.stringify(cfg));
  hideSyncOverlay();
  toast('Datos descargados y fusionados','success');
  renderCurrentPage();
}

async function backgroundMerge() {
  if (!isOnline) return;
  for (const k of DATA_KEYS) {
    const local  = getData(k);
    const remote = await FirebaseREST.get(`data/${k}`);
    if (remote) {
      const merged = mergeByTs(local, Array.isArray(remote) ? remote : Object.values(remote));
      localStorage.setItem(k, JSON.stringify(merged));
      await FirebaseREST.set(`data/${k}`, merged);
    } else if (local.length) {
      await FirebaseREST.set(`data/${k}`, local);
    }
  }
  const now = new Date().toISOString();
  localStorage.setItem('last_sync', now);
  await FirebaseREST.set('data/last_sync', now);
  updateSyncLabel();
}

/* ═══════════════════════════════════════════
   CONEXIÓN
═══════════════════════════════════════════ */
async function checkConnection() {
  try {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 5000);
    const r    = await fetch(`${DB_URL}/.json?auth=${API_KEY}&shallow=true`, { signal: ctrl.signal });
    clearTimeout(tid);
    isOnline = r.ok;
  } catch { isOnline = false; }
  updateConnBadge(isOnline ? 'ok' : 'offline');
  return isOnline;
}

function updateConnBadge(state) {
  const b = document.getElementById('conn-badge');
  if (!b) return;
  b.className = `conn-badge ${state}`;
  const labels = { ok:'Firebase OK', syncing:'Sincronizando', offline:'Sin conexión' };
  b.querySelector('.conn-label').textContent = labels[state] || state;
}

/* ═══════════════════════════════════════════
   SYNC LABEL
═══════════════════════════════════════════ */
function updateSyncLabel() {
  const raw  = localStorage.getItem('last_sync');
  const now  = new Date();
  let texto  = 'Nunca sincronizado';
  let clase  = 'text-red';
  if (raw) {
    const mins = Math.round((now - new Date(raw)) / 60000);
    if (mins < 1)    texto = 'Hace < 1 min';
    else if (mins < 60)   texto = `Hace ${mins} min`;
    else if (mins < 1440) texto = `Hace ${Math.round(mins/60)} h`;
    else texto = new Date(raw).toLocaleDateString('es-MX',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
    const h = mins / 60;
    clase = h > 24 ? 'text-red' : h > 8 ? 'text-amber' : 'text-green';
  }
  const el = document.getElementById('last-sync-label');
  if (el) { el.textContent = texto; el.className = `sync-label ${clase}`; }
  const el2 = document.getElementById('last-sync-cfg');
  if (el2) { el2.textContent = raw ? `Último respaldo Firebase: ${texto}` : 'Sin sincronización aún'; el2.className = clase; }
}

/* ═══════════════════════════════════════════
   RESPALDO
═══════════════════════════════════════════ */
function exportRespaldo() {
  const obj = { version: APP_VERSION, fecha: new Date().toISOString(), generado_por: currentUser?.user, datos: {} };
  DATA_KEYS.forEach(k => { obj.datos[k] = getData(k); });
  obj.datos.precios_cu = getObj('precios_cu');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(obj,null,2)],{type:'application/json'}));
  a.download = `PorciAdmin_respaldo_${today()}.json`;
  a.click();
  toast('Respaldo descargado','success',5000);
}

function importRespaldo() {
  const inp = document.createElement('input');
  inp.type  = 'file'; inp.accept = '.json';
  inp.onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const rb = JSON.parse(await file.text());
      if (!rb.datos) { toast('Archivo inválido','error'); return; }
      if (!confirm(`¿Restaurar respaldo del ${(rb.fecha||'').slice(0,10)}?\nSe fusionará sin eliminar datos actuales.`)) return;
      DATA_KEYS.forEach(k => { if (rb.datos[k]) localStorage.setItem(k, JSON.stringify(mergeByTs(getData(k), rb.datos[k]))); });
      if (rb.datos.precios_cu) localStorage.setItem('precios_cu', JSON.stringify(rb.datos.precios_cu));
      toast('Respaldo restaurado','success');
      renderCurrentPage();
      if (isOnline) await syncToFirebase();
    } catch(err) { toast('Error: '+err.message,'error'); }
  };
  inp.click();
}

function checkAutoRespaldo() {
  const KEY = 'last_auto_respaldo';
  const now = new Date();
  if (now.getDay() !== 1) return;
  const last = localStorage.getItem(KEY);
  if (last && new Date(last).toDateString() === now.toDateString()) return;
  const obj = { version: APP_VERSION, fecha: now.toISOString(), generado_por: 'auto', datos: {} };
  DATA_KEYS.forEach(k => { obj.datos[k] = getData(k); });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(obj,null,2)],{type:'application/json'}));
  a.download = `PorciAdmin_auto_${today()}.json`;
  a.click();
  localStorage.setItem(KEY, now.toISOString());
  toast('📥 Respaldo automático semanal descargado','info',6000);
}

/* ═══════════════════════════════════════════
   UTILIDADES
═══════════════════════════════════════════ */
function uid()   { return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
function ts()    { return Date.now(); }
function today() { return new Date().toISOString().slice(0,10); }
function fmt(n,d=2) { return new Intl.NumberFormat('es-MX',{minimumFractionDigits:d,maximumFractionDigits:d}).format(n||0); }
function fmtM(n) { return '$'+fmt(n); }
function dateStr(d) { if (!d) return '—'; return new Date(d+'T12:00:00').toLocaleDateString('es-MX',{day:'2-digit',month:'short',year:'numeric'}); }
function addDays(d,n) { const dt = new Date(d+'T12:00:00'); dt.setDate(dt.getDate()+n); return dt.toISOString().slice(0,10); }
function diffDays(a,b) { return Math.round((new Date(b)-new Date(a))/86400000); }
function isoWeek(d) { const dt = new Date(d+'T12:00:00'); dt.setHours(0,0,0,0); dt.setDate(dt.getDate()+3-(dt.getDay()+6)%7); const w=new Date(dt.getFullYear(),0,4); return 1+Math.round(((dt-w)/86400000-3+(w.getDay()+6)%7)/7); }

function toast(msg, type='info', dur=3500) {
  const c = document.getElementById('toast-container');
  const icons = { success:'fa-check-circle', error:'fa-times-circle', info:'fa-info-circle', warning:'fa-exclamation-triangle' };
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<i class="fas ${icons[type]}"></i><span>${msg}</span>`;
  c.appendChild(t);
  setTimeout(() => { t.style.opacity='0'; t.style.transform='translateX(110%)'; t.style.transition='.3s'; setTimeout(()=>t.remove(),300); }, dur);
}

function showSyncOverlay(msg='Sincronizando…') { document.getElementById('sync-msg').textContent=msg; document.getElementById('sync-overlay').classList.add('show'); }
function hideSyncOverlay() { document.getElementById('sync-overlay').classList.remove('show'); }
function openModal(id)  { document.getElementById(id)?.classList.add('open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }

/* ═══════════════════════════════════════════
   AUTH
═══════════════════════════════════════════ */
function selectLoginUser(user, el) {
  document.querySelectorAll('.user-chip').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  document.getElementById('login-user').value = user;
  document.getElementById('login-user-name').textContent = user;
  document.getElementById('login-pass-section').style.display = 'block';
  document.getElementById('login-error').style.display = 'none';
  document.getElementById('login-pass').value = '';
  setTimeout(() => document.getElementById('login-pass')?.focus(), 50);
}

function resetLoginUser() {
  document.getElementById('login-user').value = '';
  document.getElementById('login-pass').value = '';
  document.getElementById('login-pass-section').style.display = 'none';
  document.getElementById('login-error').style.display = 'none';
  document.querySelectorAll('.user-chip').forEach(c => c.classList.remove('selected'));
}

function login() {
  const u = document.getElementById('login-user').value.trim();
  const p = document.getElementById('login-pass').value;
  const found = USERS.find(x => x.user===u && x.pass===p);
  if (!found) { document.getElementById('login-error').style.display='block'; document.getElementById('login-pass').value=''; return; }
  currentUser = found;
  localStorage.setItem('session', JSON.stringify(found));
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').classList.add('visible');
  initApp();
}

function logout() {
  localStorage.removeItem('session');
  currentUser = null;
  document.getElementById('app').classList.remove('visible');
  document.getElementById('login-screen').style.display = 'flex';
  resetLoginUser();
}

function checkSession() {
  try {
    const s = JSON.parse(localStorage.getItem('session'));
    if (s && USERS.find(x => x.user===s.user && x.pass===s.pass)) {
      currentUser = s; return true;
    }
  } catch {}
  return false;
}

/* ═══════════════════════════════════════════
   NAVEGACIÓN
═══════════════════════════════════════════ */
function navigate(page) {
  currentPage = page;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`page-${page}`)?.classList.add('active');
  document.querySelector(`[data-page="${page}"]`)?.classList.add('active');
  document.getElementById('sidebar').classList.remove('open');
  const titles = { dashboard:'Dashboard', contabilidad:'Contabilidad', insumos:'Alimentación', bodega:'Bodega / Inventario', reproduccion:'Reproducción', configuracion:'Configuración' };
  document.getElementById('header-title').textContent = titles[page] || page;
  renderCurrentPage();
}

function renderCurrentPage() {
  const map = { dashboard:renderDashboard, contabilidad:renderContabilidad, insumos:renderInsumos, bodega:renderBodega, reproduccion:renderReproduccion, configuracion:renderConfiguracion };
  map[currentPage]?.();
}

/* ═══════════════════════════════════════════
   INIT APP
═══════════════════════════════════════════ */
async function initApp() {
  document.getElementById('sidebar-username').textContent = currentUser.label;
  document.getElementById('sidebar-nivel').textContent    = `Nivel ${currentUser.nivel}`;
  if (currentUser.nivel < 2) document.querySelector('[data-page="configuracion"]')?.style.setProperty('display','none');

  // Fix tab panels
  document.querySelectorAll('[data-insumos-panel]').forEach(p => { p.style.display='none'; });
  document.querySelectorAll('[data-repro-panel]').forEach(p => { p.style.display='none'; });
  const firstIns = document.querySelector('[data-insumos-panel="lista"]');
  if (firstIns) firstIns.style.display = 'block';
  const firstRep = document.querySelector('[data-repro-panel="cerdas"]');
  if (firstRep) firstRep.style.display = 'block';

  injectHistorico2025();
  checkAutoRespaldo();
  await checkConnection();
  setInterval(checkConnection, 30000);
  updateSyncLabel();
  setInterval(updateSyncLabel, 60000);

  const hasLocal = DATA_KEYS.filter(k=>k!=='contabilidad').some(k=>localStorage.getItem(k));
  if (!hasLocal && isOnline) {
    showSyncOverlay('Descargando datos iniciales…');
    await downloadFromFirebase();
    hideSyncOverlay();
  } else if (isOnline) {
    backgroundMerge();
  }

  navigate('dashboard');
  setTimeout(showOnboarding, 400);
}

function injectHistorico2025() {
  if (localStorage.getItem('hist2025_injected')) return;
  const existing = getData('contabilidad');
  const ids = new Set(existing.map(r => r.id));
  const recs = [];
  HIST_2025.forEach((m,i) => {
    const mm = String(i+1).padStart(2,'0');
    const base = { fecha:`2025-${mm}-15`, usuario:'sistema' };
    const ingId = `hist2025_ing_${i}`;
    const gasId = `hist2025_gas_${i}`;
    if (!ids.has(ingId)) recs.push({ id:ingId, ...base, tipo:'Ingreso', categoria:'Ventas', subcategoria:'Engorde', concepto:`Histórico ${m.mes} 2025`, importe:m.ing, _ts:1000+i });
    if (!ids.has(gasId)) recs.push({ id:gasId, ...base, tipo:'Gasto',   categoria:'Otros_Gastos', subcategoria:'Imprevistos', concepto:`Histórico ${m.mes} 2025`, importe:m.gas, _ts:1000+i });
  });
  if (recs.length) localStorage.setItem('contabilidad', JSON.stringify([...existing,...recs]));
  localStorage.setItem('hist2025_injected','1');
}

/* ═══════════════════════════════════════════
   ONBOARDING
═══════════════════════════════════════════ */
const OB_TOTAL = 5;

function showOnboarding() {
  if (localStorage.getItem('ob_skip_always')==='1') return;
  obSlide = 0;
  document.getElementById('ob-username').textContent = currentUser.label;
  goToSlide(0);
  document.getElementById('onboarding-overlay').classList.add('show');
}
function hideOnboarding() { document.getElementById('onboarding-overlay').classList.remove('show'); }

function goToSlide(n) {
  obSlide = n;
  document.querySelectorAll('.ob-slide').forEach((s,i) => s.classList.toggle('active', i===n));
  document.querySelectorAll('.ob-dot').forEach((d,i) => d.classList.toggle('active', i===n));
  const prev = document.getElementById('ob-prev-btn');
  const next = document.getElementById('ob-next-btn');
  if (prev) prev.style.visibility = n===0 ? 'hidden' : 'visible';
  if (next) next.innerHTML = n===OB_TOTAL-1 ? '<i class="fas fa-check"></i> Entendido' : 'Siguiente <i class="fas fa-arrow-right"></i>';
}
function obNext() { obSlide < OB_TOTAL-1 ? goToSlide(obSlide+1) : hideOnboarding(); }
function obPrev() { if (obSlide > 0) goToSlide(obSlide-1); }
function obSkipAlways() {
  if (!confirm('¿Omitir esta guía en todos los inicios de sesión futuros?\nPodrás reactivarla desde Configuración.')) return;
  localStorage.setItem('ob_skip_always','1');
  hideOnboarding();
  toast('Guía desactivada. Reactívala en Configuración.','info',4000);
}
function obResetSkip() { localStorage.removeItem('ob_skip_always'); toast('La guía volverá al próximo inicio de sesión.','success'); }

/* ═══════════════════════════════════════════
   DASHBOARD
═══════════════════════════════════════════ */
function renderDashboard() {
  const now  = new Date();
  const mes  = now.getMonth();
  const anio = now.getFullYear();
  const all  = getData('contabilidad');
  const mes_data = all.filter(r => { const d=new Date(r.fecha+'T12:00:00'); return d.getMonth()===mes && d.getFullYear()===anio; });
  const ing  = mes_data.filter(r=>r.tipo==='Ingreso').reduce((s,r)=>s+r.importe,0);
  const gas  = mes_data.filter(r=>r.tipo==='Gasto').reduce((s,r)=>s+r.importe,0);
  const util = ing-gas;
  const margen = ing>0 ? util/ing*100 : 0;

  document.getElementById('dash-ing').textContent   = fmtM(ing);
  document.getElementById('dash-gas').textContent   = fmtM(gas);
  document.getElementById('dash-util').textContent  = fmtM(util);
  document.getElementById('dash-util').className    = `kpi-val mono ${util>=0?'text-green':'text-red'}`;
  document.getElementById('dash-margen').textContent= fmt(margen)+'%';
  document.getElementById('dash-mes').textContent   = `${MESES[mes]} ${anio}`;

  // Alertas partos
  const servicios = getData('servicios');
  const cerdas    = getData('cerdas');
  const hoy       = today();
  const alertas   = [];
  servicios.filter(s=>s.estado!=='Fallido' && s.fecha_parto_probable).forEach(s => {
    const dias = diffDays(hoy, s.fecha_parto_probable);
    if (dias >= -3 && dias <= 14) {
      const c = cerdas.find(x=>x.id===s.cerda_id);
      alertas.push({ nombre: c?.nombre||s.cerda_id, dias, fecha: s.fecha_parto_probable });
    }
  });
  alertas.sort((a,b)=>a.dias-b.dias);
  const alertEl = document.getElementById('dash-alertas-partos');
  alertEl.innerHTML = alertas.length ? alertas.map(a => {
    const tipo = a.dias<=7 ? 'red' : 'amber';
    const lbl  = a.dias<0 ? `hace ${Math.abs(a.dias)} días` : a.dias===0 ? 'HOY' : `en ${a.dias} días`;
    return `<div class="alert-item ${tipo}"><i class="fas fa-exclamation-circle"></i><span><b>${a.nombre}</b> — Parto ${lbl} (${dateStr(a.fecha)})</span></div>`;
  }).join('') : '<div class="alert-item green"><i class="fas fa-check-circle"></i> Sin partos próximos</div>';

  // Alertas diagnósticos
  const diags     = getData('diagnosticos');
  const diagAlerts = [];
  servicios.filter(s=>s.estado==='Activo').forEach(s => {
    [21,28,35,42].forEach(d => {
      const fechaDiag = addDays(s.fecha_servicio, d);
      const diff = diffDays(hoy, fechaDiag);
      if (diff >= -2 && diff <= 3) {
        const yaHecho = diags.some(dr=>dr.servicio_id===s.id && dr.ventana===d);
        if (!yaHecho) {
          const c = cerdas.find(x=>x.id===s.cerda_id);
          diagAlerts.push({ nombre: c?.nombre||s.cerda_id, d, fecha: fechaDiag });
        }
      }
    });
  });
  const diagEl = document.getElementById('dash-alertas-diag');
  diagEl.innerHTML = diagAlerts.length ? diagAlerts.map(a =>
    `<div class="alert-item amber"><i class="fas fa-clock"></i><span><b>${a.nombre}</b> — Diagnóstico D+${a.d} (${dateStr(a.fecha)})</span></div>`
  ).join('') : '<div class="alert-item green"><i class="fas fa-check-circle"></i> Sin diagnósticos pendientes</div>';

  // Gráfica gastos
  const catTotals = {};
  mes_data.filter(r=>r.tipo==='Gasto').forEach(r => { catTotals[r.categoria]=(catTotals[r.categoria]||0)+r.importe; });
  const ctx = document.getElementById('dash-chart')?.getContext('2d');
  if (ctx) {
    if (dashChart) dashChart.destroy();
    dashChart = new Chart(ctx, {
      type: 'doughnut',
      data: { labels: Object.keys(catTotals), datasets: [{ data: Object.values(catTotals), backgroundColor: ['#2ecc71','#3498db','#e74c3c','#f39c12','#9b59b6','#1abc9c'], borderWidth: 0 }] },
      options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'right', labels:{ color:'#7a8a9a', font:{family:'Instrument Sans',size:11}, boxWidth:12 } } } }
    });
  }
}

/* ═══════════════════════════════════════════
   CONTABILIDAD
═══════════════════════════════════════════ */
function renderContabilidad() {
  // Populate selects once
  const ms = document.getElementById('contab-mes');
  if (ms && !ms.options.length) { MESES.forEach((m,i)=>ms.add(new Option(m,i+1))); ms.value=contabMes; }
  const ay = document.getElementById('contab-anio');
  if (ay && !ay.options.length) { [2025,2026,2027].forEach(y=>ay.add(new Option(y,y))); ay.value=contabAnio; }
  renderContabTable();
  renderCashflow();
}

function renderContabTable() {
  const data = getData('contabilidad').filter(r => {
    const d = new Date(r.fecha+'T12:00:00');
    return d.getMonth()+1===+contabMes && d.getFullYear()===+contabAnio;
  }).sort((a,b)=>b.fecha.localeCompare(a.fecha));
  const ing  = data.filter(r=>r.tipo==='Ingreso').reduce((s,r)=>s+r.importe,0);
  const gas  = data.filter(r=>r.tipo==='Gasto').reduce((s,r)=>s+r.importe,0);
  const util = ing-gas;
  document.getElementById('ct-ing').textContent  = fmtM(ing);
  document.getElementById('ct-gas').textContent  = fmtM(gas);
  document.getElementById('ct-util').textContent = fmtM(util);
  document.getElementById('ct-util').className   = `kpi-val mono ${util>=0?'text-green':'text-red'}`;
  const tbody = document.getElementById('contab-tbody');
  tbody.innerHTML = data.length ? data.map(r=>`
    <tr>
      <td class="mono">${dateStr(r.fecha)}</td>
      <td><span class="badge ${r.tipo==='Ingreso'?'badge-green':'badge-red'}">${r.tipo}</span></td>
      <td>${r.categoria}</td><td>${r.subcategoria||'—'}</td><td>${r.concepto||'—'}</td>
      <td class="mono text-right ${r.tipo==='Ingreso'?'text-green':'text-red'}">${fmtM(r.importe)}</td>
      <td>${currentUser.nivel>=2?`<button class="btn btn-danger btn-sm btn-icon" onclick="deleteContab('${r.id}')"><i class="fas fa-trash"></i></button>`:''}</td>
    </tr>`).join('') : '<tr><td colspan="7" class="text-center text-muted" style="padding:24px">Sin registros en este período</td></tr>';
}

function renderCashflow() {
  const contab = getData('contabilidad');
  const data26 = Array.from({length:12},(_,i)=>{
    const recs = contab.filter(r=>{ const d=new Date(r.fecha+'T12:00:00'); return d.getFullYear()===2026 && d.getMonth()===i; });
    return { ing:recs.filter(r=>r.tipo==='Ingreso').reduce((s,r)=>s+r.importe,0), gas:recs.filter(r=>r.tipo==='Gasto').reduce((s,r)=>s+r.importe,0) };
  });
  let acum = -695728.27;
  const acumData = data26.map(m=>{ acum+=(m.ing-m.gas); return acum; });
  const ctx = document.getElementById('cashflow-chart')?.getContext('2d');
  if (!ctx) return;
  if (cashChart) cashChart.destroy();
  cashChart = new Chart(ctx, {
    type:'bar',
    data:{ labels:MESES, datasets:[
      { label:'Ingresos 2026', data:data26.map(m=>m.ing), backgroundColor:'rgba(46,204,113,.5)', borderColor:'#2ecc71', borderWidth:1 },
      { label:'Gastos 2026',   data:data26.map(m=>m.gas), backgroundColor:'rgba(231,76,60,.5)',  borderColor:'#e74c3c', borderWidth:1 },
      { label:'Flujo Acumulado', data:acumData, type:'line', borderColor:'#f39c12', borderWidth:2, fill:false, tension:.3, pointRadius:3, yAxisID:'y2' }
    ]},
    options:{ responsive:true, maintainAspectRatio:false,
      scales:{ x:{ticks:{color:'#7a8a9a',font:{size:10}},grid:{color:'rgba(42,58,78,.5)'}},
               y:{ticks:{color:'#7a8a9a',font:{size:10},callback:v=>'$'+fmt(v,0)},grid:{color:'rgba(42,58,78,.5)'}},
               y2:{position:'right',ticks:{color:'#f39c12',font:{size:10},callback:v=>'$'+fmt(v,0)},grid:{drawOnChartArea:false}} },
      plugins:{ legend:{ labels:{ color:'#7a8a9a', font:{size:11} } } }
    }
  });
}

function openContabModal() {
  document.getElementById('contab-form').reset();
  document.getElementById('cm-id').value = '';
  document.getElementById('cm-fecha').value = today();
  updateContabCats();
  openModal('contab-modal');
}
function updateContabCats() {
  const tipo = document.getElementById('cm-tipo').value;
  const cats = tipo==='Ingreso' ? INGRESOS_CAT : GASTOS_CAT;
  const catSel = document.getElementById('cm-categoria');
  catSel.innerHTML = '';
  Object.keys(cats).forEach(c=>catSel.add(new Option(c,c)));
  updateContabSubs();
}
function updateContabSubs() {
  const tipo = document.getElementById('cm-tipo').value;
  const cat  = document.getElementById('cm-categoria').value;
  const cats = tipo==='Ingreso' ? INGRESOS_CAT : GASTOS_CAT;
  const sub  = document.getElementById('cm-subcategoria');
  sub.innerHTML = '<option value="">— Sin subcategoría —</option>';
  (cats[cat]||[]).forEach(s=>sub.add(new Option(s,s)));
}
async function saveContab() {
  const id  = document.getElementById('cm-id').value || uid();
  const rec = {
    id, fecha:document.getElementById('cm-fecha').value,
    tipo:document.getElementById('cm-tipo').value,
    categoria:document.getElementById('cm-categoria').value,
    subcategoria:document.getElementById('cm-subcategoria').value,
    concepto:document.getElementById('cm-concepto').value,
    importe:parseFloat(document.getElementById('cm-importe').value)||0,
    usuario:currentUser.user, _ts:ts()
  };
  if (!rec.fecha||!rec.importe) { toast('Completa los campos obligatorios','error'); return; }
  const data = getData('contabilidad');
  const idx  = data.findIndex(r=>r.id===id);
  if (idx>=0) data[idx]=rec; else data.push(rec);
  await setData('contabilidad', data);
  closeModal('contab-modal');
  renderContabilidad();
  toast('Registro guardado','success');
}
async function deleteContab(id) {
  if (!confirm('¿Eliminar este registro?')) return;
  await setData('contabilidad', getData('contabilidad').filter(r=>r.id!==id));
  renderContabilidad();
  toast('Registro eliminado','info');
}

/* ═══════════════════════════════════════════
   INSUMOS
═══════════════════════════════════════════ */
function renderInsumos() {
  const ms = document.getElementById('insumos-mes');
  if (ms) ms.value = insumosMes;
  const ay = document.getElementById('insumos-anio');
  if (ay) ay.value = insumosAnio;
  const data = getData('insumos').filter(r=>{ const d=new Date(r.fecha+'T12:00:00'); return d.getMonth()+1===+insumosMes && d.getFullYear()===+insumosAnio; });
  if (insumosTab==='lista') renderInsumosLista(data);
  else if (insumosTab==='ingrediente') renderInsumosIng(data);
  else renderInsumosEtapa(data);
}
function renderInsumosLista(data) {
  const s = [...data].sort((a,b)=>b.fecha.localeCompare(a.fecha));
  const tb = document.getElementById('insumos-tbody');
  if (!tb) return;
  tb.innerHTML = s.length ? s.map(r=>`<tr>
    <td class="mono">${dateStr(r.fecha)}</td><td>S${r.semana_iso}</td><td>${r.etapa}</td>
    <td>${r.ingrediente}</td><td class="mono text-right">${fmt(r.cantidad*r.medio)} kg</td>
    <td class="mono text-right">${fmtM(r.cu)}</td><td class="mono text-right">${fmtM(r.importe)}</td>
    <td>${currentUser.nivel>=2?`<button class="btn btn-danger btn-sm btn-icon" onclick="deleteInsumo('${r.id}')"><i class="fas fa-trash"></i></button>`:''}</td>
  </tr>`).join('') : '<tr><td colspan="8" class="text-center text-muted" style="padding:24px">Sin registros</td></tr>';
}
function renderInsumosIng(data) {
  const totals={}; INGREDIENTES.forEach(i=>{totals[i]=0;}); data.forEach(r=>{if(totals[r.ingrediente]!==undefined)totals[r.ingrediente]+=r.importe||0;});
  const total=Object.values(totals).reduce((s,v)=>s+v,0);
  const tb=document.getElementById('insumos-ing-tbody'); if(!tb)return;
  tb.innerHTML=INGREDIENTES.map(i=>`<tr><td>${i}</td><td class="mono text-right">${fmtM(totals[i])}</td><td class="mono text-right">${total>0?fmt(totals[i]/total*100)+'%':'—'}</td></tr>`).join('');
  const tf=document.getElementById('insumos-ing-tfoot'); if(tf) tf.innerHTML=`<tr><td><b>Total</b></td><td class="mono text-right text-green"><b>${fmtM(total)}</b></td><td class="mono text-right">100%</td></tr>`;
}
function renderInsumosEtapa(data) {
  const totals={}; ETAPAS.forEach(e=>{totals[e]=0;}); data.forEach(r=>{if(totals[r.etapa]!==undefined)totals[r.etapa]+=r.importe||0;});
  const total=Object.values(totals).reduce((s,v)=>s+v,0);
  const tb=document.getElementById('insumos-etapa-tbody'); if(!tb)return;
  tb.innerHTML=ETAPAS.map(e=>`<tr><td>${e}</td><td class="mono text-right">${fmtM(totals[e])}</td><td class="mono text-right">${total>0?fmt(totals[e]/total*100)+'%':'—'}</td></tr>`).join('');
}
function openInsumosModal() {
  document.getElementById('ins-form').reset();
  document.getElementById('ins-id').value='';
  document.getElementById('ins-fecha').value=today();
  document.getElementById('ins-medio').value=1;
  updateInsumosCU();
  openModal('insumos-modal');
}
function updateInsumosCU() {
  const ing=document.getElementById('ins-ingrediente').value;
  document.getElementById('ins-cu').value=getObj('precios_cu')[ing]||0;
  calcInsumosImporte();
}
function calcInsumosImporte() {
  const cant=parseFloat(document.getElementById('ins-cantidad').value)||0;
  const cu=parseFloat(document.getElementById('ins-cu').value)||0;
  const medio=parseFloat(document.getElementById('ins-medio').value)||1;
  document.getElementById('ins-importe').value=(cant*cu*medio).toFixed(2);
}
async function saveInsumo() {
  const id=document.getElementById('ins-id').value||uid();
  const fecha=document.getElementById('ins-fecha').value;
  const ingrediente=document.getElementById('ins-ingrediente').value;
  const cantidad=parseFloat(document.getElementById('ins-cantidad').value)||0;
  const medio=parseFloat(document.getElementById('ins-medio').value)||1;
  const cu=parseFloat(document.getElementById('ins-cu').value)||0;
  const importe=parseFloat(document.getElementById('ins-importe').value)||0;
  if(!fecha||!cantidad){toast('Completa los campos obligatorios','error');return;}
  const rec={ id, fecha, semana_iso:isoWeek(fecha), etapa:document.getElementById('ins-etapa').value, ingrediente, presentacion:document.getElementById('ins-presentacion').value, medio, cantidad, cu, importe, usuario:currentUser.user, _ts:ts() };
  const data=getData('insumos'); const idx=data.findIndex(r=>r.id===id);
  if(idx>=0) data[idx]=rec; else data.push(rec);
  await setData('insumos',data);
  await bodegaMovAuto(ingrediente, cantidad*medio, fecha, `Insumos: ${rec.etapa}`, id);
  await contabMovAuto(fecha, ingrediente, importe, id);
  closeModal('insumos-modal');
  renderInsumos();
  toast('Insumo guardado, bodega y contabilidad actualizadas','success');
}
async function deleteInsumo(id) {
  if(!confirm('¿Eliminar este insumo?'))return;
  await setData('insumos',getData('insumos').filter(r=>r.id!==id));
  renderInsumos();
}

/* ═══════════════════════════════════════════
   BODEGA
═══════════════════════════════════════════ */
function calcStock(insumo, bodega) {
  return bodega.filter(r=>r.insumo===insumo).reduce((s,r)=>{
    if(r.tipo==='Entrada') return s+r.cantidad;
    if(r.tipo==='Salida')  return s-r.cantidad;
    if(r.tipo==='Ajuste')  return r.cantidad;
    return s;
  },0);
}
async function bodegaMovAuto(insumo, cantidad, fecha, concepto, refId) {
  const bod=getData('bodega');
  const stock=calcStock(insumo,bod);
  if(stock<cantidad) toast(`⚠ Stock insuficiente de ${insumo} (${fmt(stock)} disponibles)`,'warning');
  bod.push({ id:uid(), insumo, tipo:'Salida', cantidad, cu:0, fecha, concepto, ref_id:refId, auto:true, usuario:currentUser.user, _ts:ts() });
  await setData('bodega',bod);
}
async function contabMovAuto(fecha, ingrediente, importe, refId) {
  const data=getData('contabilidad');
  const subcat = GASTOS_CAT.Alimentacion.includes(ingrediente) ? ingrediente : 'Otros insumos';
  data.push({ id:`auto_ins_${refId}`, fecha, tipo:'Gasto', categoria:'Alimentacion', subcategoria:subcat, concepto:`Auto: ${ingrediente}`, importe, ref_id:refId, auto:true, usuario:currentUser.user, _ts:ts() });
  await setData('contabilidad',data);
}
function renderBodega() {
  const bod=getData('bodega');
  const grid=document.getElementById('bodega-stock-grid');
  if(grid) grid.innerHTML=INSUMOS_BODEGA.map(ins=>{
    const s=calcStock(ins,bod);
    return `<div class="kpi-card ${s<=0?'red':''}"><div class="kpi-label">${ins}</div><div class="kpi-val mono">${fmt(s)} <small style="font-size:11px;color:var(--text2)">${INSUMO_UNITS[ins]}</small></div></div>`;
  }).join('');
  const movs=[...bod.filter(r=>r.insumo===bodegaInsumo)].sort((a,b)=>a.fecha.localeCompare(b.fecha));
  let saldo=0;
  const rows=movs.map(r=>{
    if(r.tipo==='Entrada') saldo+=r.cantidad;
    else if(r.tipo==='Salida') saldo-=r.cantidad;
    else if(r.tipo==='Ajuste') saldo=r.cantidad;
    return `<tr>
      <td class="mono">${dateStr(r.fecha)}</td><td>${r.concepto||'—'}</td>
      <td><span class="badge ${r.tipo==='Entrada'?'badge-green':r.tipo==='Ajuste'?'badge-blue':'badge-red'}">${r.tipo}</span>${r.auto?' <span class="badge badge-auto">AUTO</span>':''}</td>
      <td class="mono text-right">${r.tipo==='Entrada'?fmt(r.cantidad):'—'}</td>
      <td class="mono text-right">${r.tipo!=='Entrada'?fmt(r.cantidad):'—'}</td>
      <td class="mono text-right">${fmt(saldo)}</td>
      <td>${currentUser.nivel>=2?`<button class="btn btn-danger btn-sm btn-icon" onclick="deleteBodega('${r.id}')"><i class="fas fa-trash"></i></button>`:''}</td>
    </tr>`;
  });
  const tb=document.getElementById('bodega-tbody');
  if(tb) tb.innerHTML=rows.length?rows.join(''):'<tr><td colspan="7" class="text-center text-muted" style="padding:24px">Sin movimientos</td></tr>';
}
function openBodegaModal() {
  document.getElementById('bod-form').reset();
  document.getElementById('bod-id').value='';
  document.getElementById('bod-fecha').value=today();
  openModal('bodega-modal');
}
async function saveBodega() {
  const id=document.getElementById('bod-id').value||uid();
  const insumo=document.getElementById('bod-insumo').value;
  const tipo=document.getElementById('bod-tipo').value;
  const cantidad=parseFloat(document.getElementById('bod-cantidad').value)||0;
  const fecha=document.getElementById('bod-fecha').value;
  if(!fecha||!cantidad){toast('Completa los campos','error');return;}
  if(tipo==='Salida'){const s=calcStock(insumo,getData('bodega'));if(s<cantidad)toast(`Stock insuficiente: ${fmt(s)} disponibles`,'error');}
  const rec={ id, insumo, tipo, cantidad, cu:parseFloat(document.getElementById('bod-cu').value)||0, fecha, concepto:document.getElementById('bod-concepto').value, auto:false, usuario:currentUser.user, _ts:ts() };
  const data=getData('bodega'); data.push(rec);
  await setData('bodega',data);
  closeModal('bodega-modal'); renderBodega();
  toast('Movimiento registrado','success');
}
async function deleteBodega(id) {
  if(!confirm('¿Eliminar?'))return;
  await setData('bodega',getData('bodega').filter(r=>r.id!==id)); renderBodega();
}

/* ═══════════════════════════════════════════
   REPRODUCCIÓN
═══════════════════════════════════════════ */
function renderReproduccion() {
  const map={ cerdas:renderCerdas, sementales:renderSementales, servicios:renderServicios, diagnosticos:renderDiagnosticos, partos:renderPartos };
  map[reproTab]?.();
}

/* Cerdas */
function renderCerdas() {
  const tb=document.getElementById('cerdas-tbody'); if(!tb)return;
  const data=getData('cerdas').sort((a,b)=>(a.nombre||'').localeCompare(b.nombre||''));
  tb.innerHTML=data.length?data.map(c=>`<tr>
    <td class="mono">${c.id_cerda||'—'}</td><td><b>${c.nombre}</b></td><td>${c.raza||'—'}</td>
    <td class="mono">${dateStr(c.fecha_nacimiento)}</td>
    <td><span class="badge ${c.estado==='Activa'?'badge-green':c.estado==='Descarte'?'badge-amber':'badge-red'}">${c.estado}</span></td>
    <td class="btn-group">
      <button class="btn btn-secondary btn-sm btn-icon" onclick="openCerdaModal('${c.id}')"><i class="fas fa-edit"></i></button>
      ${currentUser.nivel>=2?`<button class="btn btn-danger btn-sm btn-icon" onclick="deleteCerda('${c.id}')"><i class="fas fa-trash"></i></button>`:''}
    </td></tr>`).join(''):'<tr><td colspan="6" class="text-center text-muted" style="padding:24px">Sin cerdas registradas</td></tr>';
}
function openCerdaModal(id=null) {
  document.getElementById('cerda-form').reset();
  document.getElementById('cerda-id').value=id||'';
  if(id){ const c=getData('cerdas').find(x=>x.id===id); if(c){ document.getElementById('cf-arete').value=c.id_cerda||''; document.getElementById('cf-nombre').value=c.nombre; document.getElementById('cf-raza').value=c.raza||''; document.getElementById('cf-fnac').value=c.fecha_nacimiento||''; document.getElementById('cf-estado').value=c.estado; } }
  openModal('cerda-modal');
}
async function saveCerda() {
  const id=document.getElementById('cerda-id').value||uid();
  const rec={ id, id_cerda:document.getElementById('cf-arete').value, nombre:document.getElementById('cf-nombre').value, raza:document.getElementById('cf-raza').value, fecha_nacimiento:document.getElementById('cf-fnac').value, estado:document.getElementById('cf-estado').value, usuario:currentUser.user, _ts:ts() };
  if(!rec.nombre){toast('El nombre es requerido','error');return;}
  const data=getData('cerdas'); const idx=data.findIndex(r=>r.id===id);
  if(idx>=0) data[idx]=rec; else data.push(rec);
  await setData('cerdas',data); closeModal('cerda-modal'); renderCerdas(); toast('Cerda guardada','success');
}
async function deleteCerda(id){ if(!confirm('¿Eliminar esta cerda?'))return; await setData('cerdas',getData('cerdas').filter(r=>r.id!==id)); renderCerdas(); }

/* Sementales */
function renderSementales() {
  const tb=document.getElementById('sem-tbody'); if(!tb)return;
  const data=getData('sementales');
  tb.innerHTML=data.length?data.map(s=>`<tr>
    <td class="mono">${s.id_sem||'—'}</td><td><b>${s.nombre}</b></td><td>${s.raza||'—'}</td>
    <td>${s.procedencia||'—'}</td><td class="mono text-center">${s.dosis_disponibles||0}</td>
    <td><span class="badge ${s.estado==='Activo'?'badge-green':'badge-red'}">${s.estado}</span></td>
    <td class="btn-group">
      <button class="btn btn-secondary btn-sm btn-icon" onclick="openSementalModal('${s.id}')"><i class="fas fa-edit"></i></button>
      ${currentUser.nivel>=2?`<button class="btn btn-danger btn-sm btn-icon" onclick="deleteSemental('${s.id}')"><i class="fas fa-trash"></i></button>`:''}
    </td></tr>`).join(''):'<tr><td colspan="7" class="text-center text-muted" style="padding:24px">Sin sementales registrados</td></tr>';
}
function openSementalModal(id=null) {
  document.getElementById('sem-form').reset();
  document.getElementById('sem-id').value=id||'';
  if(id){ const s=getData('sementales').find(x=>x.id===id); if(s){ document.getElementById('smf-id').value=s.id_sem||''; document.getElementById('smf-nombre').value=s.nombre; document.getElementById('smf-raza').value=s.raza||''; document.getElementById('smf-proc').value=s.procedencia||''; document.getElementById('smf-dosis').value=s.dosis_disponibles||0; document.getElementById('smf-estado').value=s.estado; } }
  openModal('sem-modal');
}
async function saveSemental() {
  const id=document.getElementById('sem-id').value||uid();
  const rec={ id, id_sem:document.getElementById('smf-id').value, nombre:document.getElementById('smf-nombre').value, raza:document.getElementById('smf-raza').value, procedencia:document.getElementById('smf-proc').value, dosis_disponibles:parseInt(document.getElementById('smf-dosis').value)||0, estado:document.getElementById('smf-estado').value, usuario:currentUser.user, _ts:ts() };
  if(!rec.nombre){toast('El nombre es requerido','error');return;}
  const data=getData('sementales'); const idx=data.findIndex(r=>r.id===id);
  if(idx>=0) data[idx]=rec; else data.push(rec);
  await setData('sementales',data); closeModal('sem-modal'); renderSementales(); toast('Semental guardado','success');
}
async function deleteSemental(id){ if(!confirm('¿Eliminar?'))return; await setData('sementales',getData('sementales').filter(r=>r.id!==id)); renderSementales(); }

/* Servicios */
function renderServicios() {
  const tb=document.getElementById('serv-tbody'); if(!tb)return;
  const data=getData('servicios').sort((a,b)=>b.fecha_servicio.localeCompare(a.fecha_servicio));
  const cerdas=getData('cerdas');
  tb.innerHTML=data.length?data.map(s=>{
    const c=cerdas.find(x=>x.id===s.cerda_id);
    const revs=[21,28,35,42].map(d=>`D+${d}: ${dateStr(addDays(s.fecha_servicio,d))}`).join(' · ');
    return `<tr>
      <td><b>${c?.nombre||s.cerda_id}</b></td><td class="mono">${dateStr(s.fecha_servicio)}</td>
      <td>${s.tipo_servicio}</td><td>${s.semental||s.dosis_codigo||'—'}</td>
      <td class="mono">${dateStr(s.fecha_parto_probable)}</td>
      <td><span class="badge ${s.estado==='Activo'?'badge-green':'badge-red'}">${s.estado}</span></td>
      <td style="font-size:11px;color:var(--text2);min-width:280px">${revs}</td>
      <td>${currentUser.nivel>=1?`<button class="btn btn-danger btn-sm btn-icon" onclick="deleteServicio('${s.id}')"><i class="fas fa-trash"></i></button>`:''}</td>
    </tr>`;
  }).join(''):'<tr><td colspan="8" class="text-center text-muted" style="padding:24px">Sin servicios registrados</td></tr>';
}
function openServicioModal() {
  document.getElementById('serv-form').reset();
  document.getElementById('serv-id').value='';
  document.getElementById('sf-fecha').value=today();
  const sel=document.getElementById('sf-cerda');
  sel.innerHTML='<option value="">— Seleccionar cerda —</option>';
  const servicios=getData('servicios');
  getData('cerdas').filter(c=>c.estado==='Activa').forEach(c=>{
    const tieneActivo=servicios.some(s=>s.cerda_id===c.id && s.estado==='Activo');
    if(!tieneActivo) sel.add(new Option(c.nombre, c.id));
  });
  calcFechaParto();
  openModal('serv-modal');
}
function calcFechaParto() { const f=document.getElementById('sf-fecha')?.value; if(f) document.getElementById('sf-parto').value=addDays(f,114); }
async function saveServicio() {
  const id=document.getElementById('serv-id').value||uid();
  const cerda_id=document.getElementById('sf-cerda').value;
  const fecha_servicio=document.getElementById('sf-fecha').value;
  if(!cerda_id||!fecha_servicio){toast('Completa los campos','error');return;}
  const rec={ id, cerda_id, fecha_servicio, tipo_servicio:document.getElementById('sf-tipo').value, semental:document.getElementById('sf-semental').value, dosis_codigo:document.getElementById('sf-dosis').value, fecha_parto_probable:addDays(fecha_servicio,114), estado:'Activo', usuario:currentUser.user, _ts:ts() };
  const data=getData('servicios'); data.push(rec);
  await setData('servicios',data); closeModal('serv-modal'); renderServicios(); toast('Servicio registrado','success');
}
async function deleteServicio(id){ if(!confirm('¿Eliminar?'))return; await setData('servicios',getData('servicios').filter(r=>r.id!==id)); renderServicios(); }

/* Diagnósticos */
function renderDiagnosticos() {
  const tb=document.getElementById('diag-tbody'); if(!tb)return;
  const data=getData('diagnosticos').sort((a,b)=>b.fecha_diagnostico.localeCompare(a.fecha_diagnostico));
  tb.innerHTML=data.length?data.map(d=>{
    const s=getData('servicios').find(x=>x.id===d.servicio_id);
    const c=s?getData('cerdas').find(x=>x.id===s.cerda_id):null;
    return `<tr>
      <td><b>${c?.nombre||'—'}</b></td><td class="mono">${dateStr(d.fecha_diagnostico)}</td>
      <td>D+${d.ventana}</td><td class="mono">${d.dias_post||'—'} días</td>
      <td><span class="badge ${d.resultado==='Positivo'?'badge-green':d.resultado.includes('Negativo')?'badge-red':'badge-amber'}">${d.resultado}</span></td>
      <td>${currentUser.nivel>=1?`<button class="btn btn-danger btn-sm btn-icon" onclick="deleteDiag('${d.id}')"><i class="fas fa-trash"></i></button>`:''}</td>
    </tr>`;
  }).join(''):'<tr><td colspan="6" class="text-center text-muted" style="padding:24px">Sin diagnósticos registrados</td></tr>';
}
function openDiagModal() {
  document.getElementById('diag-form').reset();
  document.getElementById('diag-id').value='';
  document.getElementById('df-fecha').value=today();
  const sel=document.getElementById('df-servicio');
  sel.innerHTML='<option value="">— Seleccionar servicio —</option>';
  getData('servicios').filter(s=>s.estado==='Activo').forEach(s=>{ const c=getData('cerdas').find(x=>x.id===s.cerda_id); sel.add(new Option(`${c?.nombre||s.cerda_id} — ${dateStr(s.fecha_servicio)}`,s.id)); });
  openModal('diag-modal');
}
function calcDiasPost() {
  const sid=document.getElementById('df-servicio').value;
  const fecha=document.getElementById('df-fecha').value;
  if(sid&&fecha){ const s=getData('servicios').find(x=>x.id===sid); if(s) document.getElementById('df-dias').value=diffDays(s.fecha_servicio,fecha); }
}
async function saveDiag() {
  const id=document.getElementById('diag-id').value||uid();
  const servicio_id=document.getElementById('df-servicio').value;
  const fecha_diagnostico=document.getElementById('df-fecha').value;
  const resultado=document.getElementById('df-resultado').value;
  if(!servicio_id||!fecha_diagnostico){toast('Completa los campos','error');return;}
  const serv=getData('servicios').find(s=>s.id===servicio_id);
  const rec={ id, servicio_id, fecha_diagnostico, resultado, ventana:parseInt(document.getElementById('df-ventana').value), dias_post:serv?diffDays(serv.fecha_servicio,fecha_diagnostico):0, usuario:currentUser.user, _ts:ts() };
  const data=getData('diagnosticos'); data.push(rec);
  await setData('diagnosticos',data);
  if(resultado.includes('Negativo')&&serv){ const sv=getData('servicios'); const i=sv.findIndex(s=>s.id===servicio_id); if(i>=0){sv[i].estado='Fallido';sv[i]._ts=ts();} await setData('servicios',sv); toast('Servicio marcado como Fallido — cerda disponible','warning'); }
  closeModal('diag-modal'); renderDiagnosticos(); toast('Diagnóstico guardado','success');
}
async function deleteDiag(id){ if(!confirm('¿Eliminar?'))return; await setData('diagnosticos',getData('diagnosticos').filter(r=>r.id!==id)); renderDiagnosticos(); }

/* Partos */
function renderPartos() {
  const tb=document.getElementById('partos-tbody'); if(!tb)return;
  const data=getData('partos').sort((a,b)=>b.fecha_parto.localeCompare(a.fecha_parto));
  const cerdas=getData('cerdas');
  tb.innerHTML=data.length?data.map(p=>{
    const c=cerdas.find(x=>x.id===p.cerda_id);
    return `<tr>
      <td><b>${c?.nombre||'—'}</b></td><td class="mono">${dateStr(p.fecha_parto)}</td>
      <td class="mono text-green">${(p.hembras_vivas||0)+(p.machos_vivos||0)}</td>
      <td class="mono text-red">${(p.hembras_muertas||0)+(p.machos_muertos||0)}</td>
      <td class="mono">${dateStr(p.fecha_destete_probable)}</td>
      <td class="mono">${dateStr(p.fecha_destete_real)||'—'}</td>
      <td class="mono">${p.dias_lactancia||'—'} d</td>
      <td>${currentUser.nivel>=1?`<button class="btn btn-danger btn-sm btn-icon" onclick="deleteParto('${p.id}')"><i class="fas fa-trash"></i></button>`:''}</td>
    </tr>`;
  }).join(''):'<tr><td colspan="8" class="text-center text-muted" style="padding:24px">Sin partos registrados</td></tr>';
}
function openPartoModal() {
  document.getElementById('parto-form').reset();
  document.getElementById('parto-id').value='';
  document.getElementById('pf-fecha').value=today();
  const sel=document.getElementById('pf-cerda');
  sel.innerHTML='<option value="">— Seleccionar cerda —</option>';
  getData('cerdas').filter(c=>c.estado==='Activa').forEach(c=>{ const tieneServ=getData('servicios').some(s=>s.cerda_id===c.id); if(tieneServ) sel.add(new Option(c.nombre,c.id)); });
  ['pf-hembras-vivas','pf-machos-vivos','pf-hembras-muertas','pf-machos-muertos'].forEach(id=>{const el=document.getElementById(id);if(el)el.value=0;});
  document.getElementById('pf-total-vivos').textContent='0';
  document.getElementById('pf-total-muertos').textContent='0';
  calcFechaDestete();
  openModal('parto-modal');
}
function calcFechaDestete(){ const f=document.getElementById('pf-fecha')?.value; if(f) document.getElementById('pf-destete-prob').value=addDays(f,21); }
function calcTotalesParto(){ document.getElementById('pf-total-vivos').textContent=(parseInt(document.getElementById('pf-hembras-vivas').value)||0)+(parseInt(document.getElementById('pf-machos-vivos').value)||0); document.getElementById('pf-total-muertos').textContent=(parseInt(document.getElementById('pf-hembras-muertas').value)||0)+(parseInt(document.getElementById('pf-machos-muertos').value)||0); }
function calcDiasLactancia(){ const fp=document.getElementById('pf-fecha')?.value; const fd=document.getElementById('pf-destete-real')?.value; if(fp&&fd) document.getElementById('pf-dias-lact').value=diffDays(fp,fd); }
async function saveParto() {
  const id=document.getElementById('parto-id').value||uid();
  const cerda_id=document.getElementById('pf-cerda').value;
  const fecha_parto=document.getElementById('pf-fecha').value;
  if(!cerda_id||!fecha_parto){toast('Completa los campos','error');return;}
  const fd=document.getElementById('pf-destete-real').value;
  const pmin=parseFloat(document.getElementById('pf-peso-min').value)||null;
  const pmed=parseFloat(document.getElementById('pf-peso-med').value)||null;
  const pmax=parseFloat(document.getElementById('pf-peso-max').value)||null;
  const rec={ id, cerda_id, fecha_parto, hembras_vivas:parseInt(document.getElementById('pf-hembras-vivas').value)||0, machos_vivos:parseInt(document.getElementById('pf-machos-vivos').value)||0, hembras_muertas:parseInt(document.getElementById('pf-hembras-muertas').value)||0, machos_muertos:parseInt(document.getElementById('pf-machos-muertos').value)||0, destino_machos:document.getElementById('pf-destino').value, fecha_destete_probable:addDays(fecha_parto,21), fecha_destete_real:fd||null, dias_lactancia:fd?diffDays(fecha_parto,fd):null, hembras_destetadas:parseInt(document.getElementById('pf-hembras-dest').value)||0, machos_destetados:parseInt(document.getElementById('pf-machos-dest').value)||0, peso_min:pmin, peso_med:pmed, peso_max:pmax, peso_promedio:(pmin&&pmed&&pmax)?(pmin+pmed+pmax)/3:null, usuario:currentUser.user, _ts:ts() };
  const data=getData('partos'); data.push(rec);
  await setData('partos',data); closeModal('parto-modal'); renderPartos(); toast('Parto registrado','success');
}
async function deleteParto(id){ if(!confirm('¿Eliminar?'))return; await setData('partos',getData('partos').filter(r=>r.id!==id)); renderPartos(); }

/* ═══════════════════════════════════════════
   CONFIGURACIÓN
═══════════════════════════════════════════ */
function renderConfiguracion() {
  if(currentUser.nivel<2){document.getElementById('page-configuracion').innerHTML='<div class="empty-state"><i class="fas fa-lock"></i><p>Acceso restringido</p></div>';return;}
  renderPreciosCU();
  updateSyncLabel();
}
function renderPreciosCU() {
  const p=getObj('precios_cu');
  const tb=document.getElementById('precios-tbody'); if(!tb)return;
  tb.innerHTML=INGREDIENTES.map(ing=>`<tr><td>${ing}</td><td><input type="number" step="0.01" value="${p[ing]||0}" id="cu-${ing}" style="background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:5px 8px;width:120px"/></td><td><button class="btn btn-primary btn-sm" onclick="savePrecioCU('${ing}')">Guardar</button></td></tr>`).join('');
}
async function savePrecioCU(ing) {
  const val=parseFloat(document.getElementById(`cu-${ing}`).value)||0;
  const p=getObj('precios_cu'); p[ing]=val;
  await setObj('precios_cu',p); toast(`Precio de ${ing}: ${fmtM(val)}`,'success');
}
function exportCSV(key) {
  const data=getData(key); if(!data.length){toast('Sin datos','warning');return;}
  const h=Object.keys(data[0]);
  const csv=[h.join(','),...data.map(r=>h.map(k=>`"${r[k]??''}"`).join(','))].join('\n');
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'})); a.download=`${key}_${today()}.csv`; a.click();
  toast(`${key}.csv exportado`,'success');
}
function exportJSON(key) {
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([JSON.stringify(getData(key),null,2)],{type:'application/json'})); a.download=`${key}_${today()}.json`; a.click();
  toast(`${key}.json exportado`,'success');
}

/* ═══════════════════════════════════════════
   SERVICE WORKER
═══════════════════════════════════════════ */
if('serviceWorker' in navigator){ window.addEventListener('load',()=>{ navigator.serviceWorker.register('./sw.js').catch(()=>{}); }); }

/* ═══════════════════════════════════════════
   BOOT
═══════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.version-tag').forEach(el=>el.textContent=APP_VERSION);
  document.title = `PorciAdmin ${APP_VERSION}`;

  // Hamburger
  document.getElementById('hamburger')?.addEventListener('click',()=>document.getElementById('sidebar').classList.toggle('open'));

  // Login
  document.getElementById('login-btn')?.addEventListener('click', login);
  document.getElementById('login-pass')?.addEventListener('keydown',e=>{if(e.key==='Enter')login();});

  // Nav
  document.querySelectorAll('.nav-item').forEach(el=>el.addEventListener('click',()=>navigate(el.dataset.page)));

  // Logout
  document.getElementById('logout-btn')?.addEventListener('click', logout);

  // Conn badge
  document.getElementById('conn-badge')?.addEventListener('click',()=>{ if(isOnline)syncToFirebase(); else toast('Sin conexión','error'); });

  // Contabilidad
  document.getElementById('contab-mes')?.addEventListener('change',e=>{contabMes=e.target.value;renderContabTable();});
  document.getElementById('contab-anio')?.addEventListener('change',e=>{contabAnio=e.target.value;renderContabTable();});
  document.getElementById('cm-tipo')?.addEventListener('change',updateContabCats);
  document.getElementById('cm-categoria')?.addEventListener('change',updateContabSubs);

  // Insumos tabs
  document.querySelectorAll('[data-insumos-tab]').forEach(el=>el.addEventListener('click',()=>{
    insumosTab=el.dataset.insumosTab;
    document.querySelectorAll('[data-insumos-tab]').forEach(t=>t.classList.remove('active')); el.classList.add('active');
    document.querySelectorAll('[data-insumos-panel]').forEach(p=>{p.style.display='none';p.classList.remove('active');});
    const p=document.querySelector(`[data-insumos-panel="${insumosTab}"]`); if(p){p.style.display='block';p.classList.add('active');}
    renderInsumos();
  }));
  document.getElementById('insumos-mes')?.addEventListener('change',e=>{insumosMes=e.target.value;renderInsumos();});
  document.getElementById('insumos-anio')?.addEventListener('change',e=>{insumosAnio=e.target.value;renderInsumos();});
  document.getElementById('ins-ingrediente')?.addEventListener('change',updateInsumosCU);
  document.getElementById('ins-cantidad')?.addEventListener('input',calcInsumosImporte);
  document.getElementById('ins-medio')?.addEventListener('input',calcInsumosImporte);
  document.getElementById('ins-cu')?.addEventListener('input',calcInsumosImporte);

  // Bodega filtro
  document.getElementById('bodega-filtro')?.addEventListener('change',e=>{bodegaInsumo=e.target.value;renderBodega();});

  // Reproducción tabs
  document.querySelectorAll('[data-repro-tab]').forEach(el=>el.addEventListener('click',()=>{
    reproTab=el.dataset.reproTab;
    document.querySelectorAll('[data-repro-tab]').forEach(t=>t.classList.remove('active')); el.classList.add('active');
    document.querySelectorAll('[data-repro-panel]').forEach(p=>{p.style.display='none';p.classList.remove('active');});
    const p=document.querySelector(`[data-repro-panel="${reproTab}"]`); if(p){p.style.display='block';p.classList.add('active');}
    renderReproduccion();
  }));

  // Servicio / Parto
  document.getElementById('sf-fecha')?.addEventListener('change',calcFechaParto);
  document.getElementById('pf-fecha')?.addEventListener('change',calcFechaDestete);
  document.getElementById('pf-destete-real')?.addEventListener('change',calcDiasLactancia);
  ['pf-hembras-vivas','pf-machos-vivos','pf-hembras-muertas','pf-machos-muertos'].forEach(id=>document.getElementById(id)?.addEventListener('input',calcTotalesParto));

  // Diagnóstico
  document.getElementById('df-servicio')?.addEventListener('change',calcDiasPost);
  document.getElementById('df-fecha')?.addEventListener('change',calcDiasPost);

  // Modales cerrar
  document.querySelectorAll('.modal-close').forEach(el=>el.addEventListener('click',()=>el.closest('.modal-overlay')?.classList.remove('open')));
  document.querySelectorAll('.modal-overlay').forEach(ov=>ov.addEventListener('click',e=>{if(e.target===ov)ov.classList.remove('open');}));

  // Config
  document.getElementById('btn-sync-all')?.addEventListener('click',syncToFirebase);
  document.getElementById('btn-download-fb')?.addEventListener('click',downloadFromFirebase);
  document.getElementById('btn-check-conn')?.addEventListener('click',async()=>{ await checkConnection(); toast(isOnline?'Firebase conectado ✓':'Sin conexión',isOnline?'success':'error'); });
  document.getElementById('btn-export-respaldo')?.addEventListener('click',exportRespaldo);
  document.getElementById('btn-import-respaldo')?.addEventListener('click',importRespaldo);

  // Onboarding
  document.getElementById('ob-next-btn')?.addEventListener('click',obNext);
  document.getElementById('ob-prev-btn')?.addEventListener('click',obPrev);
  document.getElementById('ob-skip-btn')?.addEventListener('click',obSkipAlways);
  document.querySelectorAll('.ob-dot').forEach(d=>d.addEventListener('click',()=>goToSlide(parseInt(d.dataset.dot))));

  // Session check
  if(checkSession()){
    document.getElementById('login-screen').style.display='none';
    document.getElementById('app').classList.add('visible');
    initApp();
  }
});
