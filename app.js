// app.js — AgroSuino v1.0.4 — build 2026-05-22
'use strict';

/* ════════════════════════════════════════════════
   CONSTANTS & CATALOG
═══════════════════════════════════════════════════ */
const APP_VERSION = 'v1.0.4 — build 2026-05-22';

const USERS = [
  { user: 'administrador', pass: 'administrador1', nivel: 3, label: 'Administrador' },
  { user: 'JFOG', pass: 'jfog1', nivel: 2, label: 'JFOG' },
  { user: 'JFOD', pass: 'jfod1', nivel: 1, label: 'JFOD' },
  { user: 'JAOD', pass: 'jaod1', nivel: 1, label: 'JAOD' }
];

const INGRESOS_CAT = {
  Ventas: ['Engorde', 'Lechones', 'Reproductoras descartadas']
};
const GASTOS_CAT = {
  Alimentacion: ['Maíz', 'Soya', 'Salvado', 'Premezclas/Vitaminas/Minerales', 'Preiniciadores', 'Otros insumos'],
  Sanidad_y_Veterinaria: ['Vacunas', 'Antibióticos', 'Servicios veterinarios', 'Semen'],
  Mano_de_Obra: ['Sueldos', 'Seguridad social'],
  Servicios_y_Operacion: ['Agua', 'Energía', 'Combustibles', 'Equipos', 'Mantenimiento'],
  Otros_Gastos: ['Transporte', 'Seguros', 'Imprevistos']
};
const ETAPAS = ['Inicio', 'Crecimiento', 'Finalizador', 'Gestación', 'Lactancia', 'Reemplazo 2', 'Sementales'];
const INGREDIENTES = ['Maíz', 'Soya', 'Salvado', 'Núcleo'];
const INSUMOS_BODEGA = ['Maíz', 'Soya', 'Salvado', 'Núcleo', 'Sorgo', 'Preiniciadores'];
const INSUMO_UNITS = { Maíz: 'kg', Soya: 'kg', Salvado: 'kg', Núcleo: 'piezas', Sorgo: 'kg', Preiniciadores: 'kg' };
const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

const HIST_2025 = [
  { mes: 'Enero',      ing: 426639.60, gas: 335884.54 },
  { mes: 'Febrero',    ing: 219030,    gas: 284198.07 },
  { mes: 'Marzo',      ing: 66576.34,  gas: 209485.93 },
  { mes: 'Abril',      ing: 165736,    gas: 291422.98 },
  { mes: 'Mayo',       ing: 215640,    gas: 298827.82 },
  { mes: 'Junio',      ing: 295887,    gas: 285859.85 },
  { mes: 'Julio',      ing: 488454,    gas: 450752.54 },
  { mes: 'Agosto',     ing: 220861,    gas: 463091.29 },
  { mes: 'Septiembre', ing: 269365,    gas: 370552.21 },
  { mes: 'Octubre',    ing: 433314.90, gas: 300249.63 },
  { mes: 'Noviembre',  ing: 262534,    gas: 472853.23 },
  { mes: 'Diciembre',  ing: 353215,    gas: 349803.02 }
];

/* ════════════════════════════════════════════════
   STATE
═══════════════════════════════════════════════════ */
let currentUser = null;
let isOnline = false;
let isSyncing = false;

/* ════════════════════════════════════════════════
   DATA LAYER — localStorage ↔ Firebase
═══════════════════════════════════════════════════ */
function getData(key) {
  try { return JSON.parse(localStorage.getItem(key)) || []; } catch { return []; }
}
function getObj(key) {
  try { return JSON.parse(localStorage.getItem(key)) || {}; } catch { return {}; }
}

async function setData(key, arr) {
  localStorage.setItem(key, JSON.stringify(arr));
  if (isOnline && !isSyncing) {
    FirebaseREST.set(`data/${key}`, arr).catch(() => {});
  }
}
async function setObj(key, obj) {
  localStorage.setItem(key, JSON.stringify(obj));
  if (isOnline && !isSyncing) {
    FirebaseREST.set(`data/${key}`, obj).catch(() => {});
  }
}

// Merge by _ts (newest wins)
function mergeByTs(local, remote) {
  if (!Array.isArray(remote)) return local;
  const map = new Map();
  [...local, ...remote].forEach(r => {
    const existing = map.get(r.id);
    if (!existing || (r._ts || 0) > (existing._ts || 0)) map.set(r.id, r);
  });
  return [...map.values()];
}

const DATA_KEYS = ['contabilidad', 'insumos', 'bodega', 'cerdas', 'sementales', 'servicios', 'diagnosticos', 'partos'];

async function syncToFirebase() {
  if (!isOnline) { toast('Sin conexión a internet', 'error'); return; }
  isSyncing = true;
  updateConnBadge('syncing');
  for (const key of DATA_KEYS) {
    const local = getData(key);
    await FirebaseREST.set(`data/${key}`, local);
  }
  const cfg = getObj('precios_cu');
  await FirebaseREST.set('data/precios_cu', cfg);
  // Guardar timestamp de última sincronización
  const ahora = new Date().toISOString();
  localStorage.setItem('last_sync', ahora);
  await FirebaseREST.set('data/last_sync', ahora);
  isSyncing = false;
  updateConnBadge('ok');
  updateLastSyncLabel();
  toast('Sincronización completada', 'success');
}

async function downloadFromFirebase() {
  if (!isOnline) { toast('Sin conexión a internet', 'error'); return; }
  showSyncOverlay('Descargando desde Firebase…');
  for (const key of DATA_KEYS) {
    const remote = await FirebaseREST.get(`data/${key}`);
    if (remote) {
      const remoteArr = Array.isArray(remote) ? remote : Object.values(remote);
      const local = getData(key);
      // Merge preservando registros locales más recientes
      const merged = mergeByTs(local, remoteArr);
      localStorage.setItem(key, JSON.stringify(merged));
    }
  }
  const cfg = await FirebaseREST.get('data/precios_cu');
  if (cfg) localStorage.setItem('precios_cu', JSON.stringify(cfg));
  hideSyncOverlay();
  toast('Datos descargados y fusionados correctamente', 'success');
  renderCurrentPage();
}

async function backgroundMerge() {
  if (!isOnline) return;
  for (const key of DATA_KEYS) {
    const local = getData(key);
    const remote = await FirebaseREST.get(`data/${key}`);
    if (remote) {
      const merged = mergeByTs(local, Array.isArray(remote) ? remote : Object.values(remote));
      localStorage.setItem(key, JSON.stringify(merged));
      await FirebaseREST.set(`data/${key}`, merged);
    } else if (local.length) {
      await FirebaseREST.set(`data/${key}`, local);
    }
  }
  const ahora = new Date().toISOString();
  localStorage.setItem('last_sync', ahora);
  await FirebaseREST.set('data/last_sync', ahora);
  updateLastSyncLabel();
}

/* ════════════════════════════════════════════════
   CONNECTIVITY
═══════════════════════════════════════════════════ */
function updateConnBadge(state) {
  const b = document.getElementById('conn-badge');
  b.className = `conn-badge ${state}`;
  const labels = { ok: 'Firebase OK', syncing: 'Sincronizando', offline: 'Sin conexión' };
  b.querySelector('.conn-label').textContent = labels[state] || state;
}

async function checkConnection() {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 5000);
    const r = await fetch(`${DB_URL}/.json?auth=${API_KEY}&shallow=true`, { signal: controller.signal });
    clearTimeout(tid);
    isOnline = r.ok;
  } catch { isOnline = false; }
  updateConnBadge(isOnline ? 'ok' : 'offline');
  return isOnline;
}

/* ════════════════════════════════════════════════
   UTILS
═══════════════════════════════════════════════════ */
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function ts() { return Date.now(); }
function fmt(n, d = 2) { return new Intl.NumberFormat('es-MX', { minimumFractionDigits: d, maximumFractionDigits: d }).format(n || 0); }
function fmtM(n) { return '$' + fmt(n); }
function dateStr(d) { if (!d) return '—'; const dt = new Date(d + 'T12:00:00'); return dt.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }); }
function today() { return new Date().toISOString().slice(0, 10); }
function addDays(d, n) { const dt = new Date(d + 'T12:00:00'); dt.setDate(dt.getDate() + n); return dt.toISOString().slice(0, 10); }
function diffDays(a, b) { return Math.round((new Date(b) - new Date(a)) / 86400000); }
function isoWeek(d) { const dt = new Date(d + 'T12:00:00'); dt.setHours(0,0,0,0); dt.setDate(dt.getDate() + 3 - (dt.getDay() + 6) % 7); const w = new Date(dt.getFullYear(), 0, 4); return 1 + Math.round(((dt - w) / 86400000 - 3 + (w.getDay() + 6) % 7) / 7); }

function toast(msg, type = 'info', duration = 3500) {
  const c = document.getElementById('toast-container');
  const icons = { success: 'fa-check-circle', error: 'fa-times-circle', info: 'fa-info-circle', warning: 'fa-exclamation-triangle' };
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<i class="fas ${icons[type]}"></i><span>${msg}</span>`;
  c.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateX(100%)'; t.style.transition = '.3s'; setTimeout(() => t.remove(), 300); }, duration);
}

function showSyncOverlay(msg = 'Sincronizando…') {
  document.getElementById('sync-msg').textContent = msg;
  document.getElementById('sync-overlay').classList.add('show');
}
function hideSyncOverlay() { document.getElementById('sync-overlay').classList.remove('show'); }

function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

/* ════════════════════════════════════════════════
   AUTH
═══════════════════════════════════════════════════ */
function login() {
  const u = document.getElementById('login-user').value.trim();
  const p = document.getElementById('login-pass').value;
  const found = USERS.find(x => x.user === u && x.pass === p);
  if (!found) {
    document.getElementById('login-error').style.display = 'block';
    document.getElementById('login-pass').value = '';
    return;
  }
  currentUser = found;
  localStorage.setItem('session', JSON.stringify(found));
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').classList.add('visible');
  initApp();
}

function selectLoginUser(user) {
  // Marcar chip seleccionado
  document.querySelectorAll('.user-chip').forEach(c => c.classList.remove('selected'));
  event.target.closest('.user-chip').classList.add('selected');
  // Guardar usuario en campo oculto
  document.getElementById('login-user').value = user;
  // Mostrar nombre seleccionado
  const display = document.getElementById('login-user-display');
  const nameSpan = document.getElementById('login-user-name');
  if (display && nameSpan) {
    nameSpan.textContent = user;
    display.style.display = 'flex';
  }
  // Revelar campo contraseña y botón con animación
  const passLabel = document.getElementById('login-pass-label');
  const passInput = document.getElementById('login-pass');
  const loginBtn = document.getElementById('login-btn');
  if (passLabel) passLabel.style.display = 'block';
  if (passInput) {
    passInput.style.display = 'block';
    passInput.value = '';
    passInput.focus();
  }
  if (loginBtn) loginBtn.style.display = 'block';
  // Ocultar error previo
  document.getElementById('login-error').style.display = 'none';
}

function logout() {
  localStorage.removeItem('session');
  currentUser = null;
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app').classList.remove('visible');
  document.getElementById('login-user').value = '';
  document.getElementById('login-pass').value = '';
}

function checkSession() {
  try {
    const s = JSON.parse(localStorage.getItem('session'));
    if (s && USERS.find(x => x.user === s.user && x.pass === s.pass)) {
      currentUser = s;
      document.getElementById('login-screen').style.display = 'none';
      document.getElementById('app').classList.add('visible');
      initApp();
      return true;
    }
  } catch {}
  return false;
}

/* ════════════════════════════════════════════════
   NAVIGATION
═══════════════════════════════════════════════════ */
let currentPage = 'dashboard';
function navigate(page) {
  currentPage = page;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`page-${page}`)?.classList.add('active');
  document.querySelector(`[data-page="${page}"]`)?.classList.add('active');
  // close sidebar on mobile
  document.getElementById('sidebar').classList.remove('open');
  renderCurrentPage();
}

function renderCurrentPage() {
  const renderers = {
    dashboard: renderDashboard,
    contabilidad: renderContabilidad,
    insumos: renderInsumos,
    bodega: renderBodega,
    reproduccion: renderReproduccion,
    configuracion: renderConfiguracion
  };
  renderers[currentPage]?.();
}

/* ════════════════════════════════════════════════
   APP INIT
═══════════════════════════════════════════════════ */
async function initApp() {
  // User info in sidebar
  document.getElementById('sidebar-username').textContent = currentUser.label;
  document.getElementById('sidebar-nivel').textContent = `Nivel ${currentUser.nivel}`;

  // Hide nivel-restricted nav items
  if (currentUser.nivel < 2) {
    document.querySelector('[data-page="configuracion"]')?.style.setProperty('display', 'none');
  }

  // FIX: Remove inline display:none from tab panels — use only CSS classes
  document.querySelectorAll('[data-insumos-panel]').forEach(p => p.style.removeProperty('display'));
  document.querySelectorAll('[data-repro-panel]').forEach(p => p.style.removeProperty('display'));

  // Inject historical 2025 data if not already done
  injectHistorico2025();

  // Check auto respaldo semanal (lunes)
  checkAutoRespaldo();

  // Update last sync label
  updateLastSyncLabel();
  setInterval(updateLastSyncLabel, 60000); // actualizar cada minuto

  // Connection check
  await checkConnection();
  setInterval(checkConnection, 30000);

  // First boot: if no real data (beyond histórico), download from Firebase
  const hasFirebaseData = DATA_KEYS.filter(k => k !== 'contabilidad').some(k => localStorage.getItem(k));
  if (!hasFirebaseData && isOnline) {
    showSyncOverlay('Descargando datos iniciales…');
    await downloadFromFirebase();
    hideSyncOverlay();
  } else if (isOnline) {
    backgroundMerge();
  }

  navigate('dashboard');
  // Mostrar onboarding después de que el dashboard cargue
  setTimeout(showOnboarding, 400);
}

function injectHistorico2025() {
  const KEY = 'hist2025_injected';
  if (localStorage.getItem(KEY)) return; // ya inyectado
  const existing = getData('contabilidad');
  const newRecs = [];
  HIST_2025.forEach((m, idx) => {
    const mesNum = String(idx + 1).padStart(2, '0');
    // Ingreso
    newRecs.push({
      id: `hist2025_ing_${idx}`,
      fecha: `2025-${mesNum}-15`,
      tipo: 'Ingreso',
      categoria: 'Ventas',
      subcategoria: 'Engorde',
      concepto: `Histórico ${m.mes} 2025`,
      importe: m.ing,
      usuario: 'sistema',
      _ts: 1000 + idx
    });
    // Gasto
    newRecs.push({
      id: `hist2025_gas_${idx}`,
      fecha: `2025-${mesNum}-15`,
      tipo: 'Gasto',
      categoria: 'Otros_Gastos',
      subcategoria: 'Imprevistos',
      concepto: `Histórico ${m.mes} 2025`,
      importe: m.gas,
      usuario: 'sistema',
      _ts: 1000 + idx
    });
  });
  // Merge: solo agrega los que no existen (por id)
  const existingIds = new Set(existing.map(r => r.id));
  const toAdd = newRecs.filter(r => !existingIds.has(r.id));
  if (toAdd.length) {
    localStorage.setItem('contabilidad', JSON.stringify([...existing, ...toAdd]));
  }
  localStorage.setItem(KEY, '1');
}

/* ════════════════════════════════════════════════
   ██████  DASHBOARD
═══════════════════════════════════════════════════ */
let dashChart = null;
function renderDashboard() {
  const now = new Date();
  const mes = now.getMonth();
  const anio = now.getFullYear();
  const contab = getData('contabilidad');
  const mesData = contab.filter(r => {
    const d = new Date(r.fecha + 'T12:00:00');
    return d.getMonth() === mes && d.getFullYear() === anio;
  });
  const ing = mesData.filter(r => r.tipo === 'Ingreso').reduce((s, r) => s + (r.importe || 0), 0);
  const gas = mesData.filter(r => r.tipo === 'Gasto').reduce((s, r) => s + (r.importe || 0), 0);
  const util = ing - gas;
  const margen = ing > 0 ? (util / ing * 100) : 0;

  document.getElementById('dash-ing').textContent = fmtM(ing);
  document.getElementById('dash-gas').textContent = fmtM(gas);
  document.getElementById('dash-util').textContent = fmtM(util);
  document.getElementById('dash-util').className = `kpi-val ${util >= 0 ? 'text-green' : 'text-red'}`;
  document.getElementById('dash-margen').textContent = fmt(margen) + '%';
  document.getElementById('dash-mes-label').textContent = `${MESES[mes]} ${anio}`;

  // Alertas partos
  const servicios = getData('servicios');
  const alertasPartos = [];
  servicios.filter(s => s.estado !== 'Fallido').forEach(s => {
    if (!s.fecha_parto_probable) return;
    const dias = diffDays(today(), s.fecha_parto_probable);
    if (dias >= -3 && dias <= 14) {
      const cerda = getData('cerdas').find(c => c.id === s.cerda_id);
      alertasPartos.push({ cerda: cerda?.nombre || s.cerda_id, dias, fecha: s.fecha_parto_probable });
    }
  });
  alertasPartos.sort((a, b) => a.dias - b.dias);

  const alertsList = document.getElementById('dash-alerts');
  if (alertasPartos.length === 0) {
    alertsList.innerHTML = '<div class="alert-item green"><i class="fas fa-check-circle"></i> Sin partos próximos</div>';
  } else {
    alertsList.innerHTML = alertasPartos.map(a => {
      const tipo = a.dias <= 7 ? 'red' : 'amber';
      const label = a.dias < 0 ? `hace ${Math.abs(a.dias)} días` : a.dias === 0 ? 'HOY' : `en ${a.dias} días`;
      return `<div class="alert-item ${tipo}"><i class="fas fa-exclamation-circle"></i><span><b>${a.cerda}</b> — Parto ${label} (${dateStr(a.fecha)})</span></div>`;
    }).join('');
  }

  // Alertas diagnóstico pendiente
  const hoy = today();
  const diagPendientes = [];
  servicios.filter(s => s.estado === 'Activo').forEach(s => {
    const dias = [21, 28, 35, 42];
    const diagRegs = getData('diagnosticos').filter(d => d.servicio_id === s.id);
    dias.forEach(d => {
      const fechaDiag = addDays(s.fecha_servicio, d);
      if (diffDays(hoy, fechaDiag) <= 3 && diffDays(fechaDiag, hoy) <= 3) {
        const yaHecho = diagRegs.some(dr => dr.ventana === d);
        if (!yaHecho) {
          const cerda = getData('cerdas').find(c => c.id === s.cerda_id);
          diagPendientes.push({ cerda: cerda?.nombre || s.cerda_id, d, fecha: fechaDiag });
        }
      }
    });
  });

  const diagEl = document.getElementById('dash-diag-alerts');
  if (diagPendientes.length === 0) {
    diagEl.innerHTML = '<div class="alert-item green"><i class="fas fa-check-circle"></i> Sin diagnósticos pendientes</div>';
  } else {
    diagEl.innerHTML = diagPendientes.map(a =>
      `<div class="alert-item amber"><i class="fas fa-clock"></i> <b>${a.cerda}</b> — Diagnóstico D+${a.d} (${dateStr(a.fecha)})</div>`
    ).join('');
  }

  // Gráfica gastos por categoría
  const gastosCat = {};
  mesData.filter(r => r.tipo === 'Gasto').forEach(r => {
    gastosCat[r.categoria] = (gastosCat[r.categoria] || 0) + (r.importe || 0);
  });
  const labels = Object.keys(gastosCat);
  const vals = Object.values(gastosCat);
  const colors = ['#2ecc71','#3498db','#e74c3c','#f39c12','#9b59b6','#1abc9c','#e67e22'];

  const ctx = document.getElementById('dash-chart')?.getContext('2d');
  if (ctx) {
    if (dashChart) dashChart.destroy();
    dashChart = new Chart(ctx, {
      type: 'doughnut',
      data: { labels, datasets: [{ data: vals, backgroundColor: colors, borderWidth: 0 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'right', labels: { color: '#7a8a9a', font: { family: 'Instrument Sans', size: 11 }, boxWidth: 12 } } }
      }
    });
  }
}

/* ════════════════════════════════════════════════
   ██████  CONTABILIDAD
═══════════════════════════════════════════════════ */
let contabFiltroMes = new Date().getMonth() + 1;
let contabFiltroAnio = new Date().getFullYear();
let cashflowChart = null;

function renderContabilidad() {
  populateContabFilters();
  renderContabTable();
  renderCashflow();
}

function populateContabFilters() {
  const ms = document.getElementById('contab-mes');
  const ay = document.getElementById('contab-anio');
  if (!ms.options.length) {
    MESES.forEach((m, i) => ms.add(new Option(m, i + 1)));
    ms.value = contabFiltroMes;
  }
  if (!ay.options.length) {
    [2025, 2026, 2027].forEach(y => ay.add(new Option(y, y)));
    ay.value = contabFiltroAnio;
  }
}

function renderContabTable() {
  const data = getData('contabilidad').filter(r => {
    const d = new Date(r.fecha + 'T12:00:00');
    return d.getMonth() + 1 === +contabFiltroMes && d.getFullYear() === +contabFiltroAnio;
  }).sort((a, b) => b.fecha.localeCompare(a.fecha));
  const ing = data.filter(r => r.tipo === 'Ingreso').reduce((s, r) => s + r.importe, 0);
  const gas = data.filter(r => r.tipo === 'Gasto').reduce((s, r) => s + r.importe, 0);
  const util = ing - gas;

  document.getElementById('contab-total-ing').textContent = fmtM(ing);
  document.getElementById('contab-total-gas').textContent = fmtM(gas);
  document.getElementById('contab-total-util').textContent = fmtM(util);
  document.getElementById('contab-total-util').className = `kpi-val ${util >= 0 ? 'text-green' : 'text-red'}`;

  const tbody = document.getElementById('contab-tbody');
  if (!data.length) { tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted" style="padding:24px">Sin registros en este período</td></tr>'; return; }
  tbody.innerHTML = data.map(r => `
    <tr>
      <td class="mono">${dateStr(r.fecha)}</td>
      <td><span class="badge ${r.tipo === 'Ingreso' ? 'badge-green' : 'badge-red'}">${r.tipo}</span></td>
      <td>${r.categoria}</td>
      <td>${r.subcategoria || '—'}</td>
      <td>${r.concepto || '—'}</td>
      <td class="mono text-right ${r.tipo === 'Ingreso' ? 'text-green' : 'text-red'}">${fmtM(r.importe)}</td>
      <td>
        ${currentUser.nivel >= 2 ? `<button class="btn btn-danger btn-sm btn-icon" onclick="deleteContab('${r.id}')"><i class="fas fa-trash"></i></button>` : ''}
      </td>
    </tr>`).join('');
}

function renderCashflow() {
  // Build 2026 data from contabilidad
  const contab = getData('contabilidad');
  const data2026 = Array.from({ length: 12 }, (_, i) => {
    const recs = contab.filter(r => {
      const d = new Date(r.fecha + 'T12:00:00');
      return d.getFullYear() === 2026 && d.getMonth() === i;
    });
    return { ing: recs.filter(r => r.tipo === 'Ingreso').reduce((s, r) => s + r.importe, 0), gas: recs.filter(r => r.tipo === 'Gasto').reduce((s, r) => s + r.importe, 0) };
  });

  // Acumulado 2025 base
  let acum = -695728.27; // cierre 2025
  const acumData = data2026.map(m => { acum += (m.ing - m.gas); return acum; });

  const ctx = document.getElementById('cashflow-chart')?.getContext('2d');
  if (!ctx) return;
  if (cashflowChart) cashflowChart.destroy();
  cashflowChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: MESES,
      datasets: [
        { label: 'Ingresos 2026', data: data2026.map(m => m.ing), backgroundColor: 'rgba(46,204,113,.5)', borderColor: '#2ecc71', borderWidth: 1 },
        { label: 'Gastos 2026', data: data2026.map(m => m.gas), backgroundColor: 'rgba(231,76,60,.5)', borderColor: '#e74c3c', borderWidth: 1 },
        { label: 'Flujo Acumulado', data: acumData, type: 'line', borderColor: '#f39c12', borderWidth: 2, fill: false, tension: .3, pointRadius: 3, yAxisID: 'y2' }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        x: { ticks: { color: '#7a8a9a', font: { size: 10 } }, grid: { color: 'rgba(42,58,78,.5)' } },
        y: { ticks: { color: '#7a8a9a', font: { size: 10 }, callback: v => '$' + fmt(v, 0) }, grid: { color: 'rgba(42,58,78,.5)' } },
        y2: { position: 'right', ticks: { color: '#f39c12', font: { size: 10 }, callback: v => '$' + fmt(v, 0) }, grid: { drawOnChartArea: false } }
      },
      plugins: { legend: { labels: { color: '#7a8a9a', font: { size: 11 } } } }
    }
  });
}

function openContabModal() {
  document.getElementById('contab-form').reset();
  document.getElementById('contab-modal-id').value = '';
  updateContabSubcats();
  openModal('contab-modal');
}

function updateContabSubcats() {
  const tipo = document.getElementById('cf-tipo').value;
  const catSel = document.getElementById('cf-categoria');
  catSel.innerHTML = '';
  const cats = tipo === 'Ingreso' ? INGRESOS_CAT : GASTOS_CAT;
  Object.keys(cats).forEach(c => catSel.add(new Option(c, c)));
  updateContabSubSubcats();
}

function updateContabSubSubcats() {
  const tipo = document.getElementById('cf-tipo').value;
  const cat = document.getElementById('cf-categoria').value;
  const subSel = document.getElementById('cf-subcategoria');
  subSel.innerHTML = '<option value="">— Sin subcategoría —</option>';
  const cats = tipo === 'Ingreso' ? INGRESOS_CAT : GASTOS_CAT;
  (cats[cat] || []).forEach(s => subSel.add(new Option(s, s)));
}

async function saveContab() {
  const id = document.getElementById('contab-modal-id').value || uid();
  const rec = {
    id,
    fecha: document.getElementById('cf-fecha').value,
    tipo: document.getElementById('cf-tipo').value,
    categoria: document.getElementById('cf-categoria').value,
    subcategoria: document.getElementById('cf-subcategoria').value,
    concepto: document.getElementById('cf-concepto').value,
    importe: parseFloat(document.getElementById('cf-importe').value) || 0,
    usuario: currentUser.user,
    _ts: ts()
  };
  if (!rec.fecha || !rec.importe) { toast('Completa los campos obligatorios', 'error'); return; }
  const data = getData('contabilidad');
  const idx = data.findIndex(r => r.id === id);
  if (idx >= 0) data[idx] = rec; else data.push(rec);
  await setData('contabilidad', data);
  closeModal('contab-modal');
  renderContabilidad();
  toast('Registro guardado', 'success');
}

async function deleteContab(id) {
  if (!confirm('¿Eliminar este registro?')) return;
  const data = getData('contabilidad').filter(r => r.id !== id);
  await setData('contabilidad', data);
  renderContabilidad();
  toast('Registro eliminado', 'info');
}

/* ════════════════════════════════════════════════
   ██████  INSUMOS / ALIMENTACIÓN
═══════════════════════════════════════════════════ */
let insumosFiltroMes = new Date().getMonth() + 1;
let insumosFiltroAnio = new Date().getFullYear();
let insumosTab = 'lista';

function renderInsumos() {
  renderInsumosTabs();
}

function renderInsumosTabs() {
  const data = getData('insumos').filter(r => {
    const d = new Date(r.fecha + 'T12:00:00');
    return d.getMonth() + 1 === +insumosFiltroMes && d.getFullYear() === +insumosFiltroAnio;
  });

  if (insumosTab === 'lista') renderInsumosLista(data);
  else if (insumosTab === 'ingrediente') renderInsumosIngrediente(data);
  else if (insumosTab === 'etapa') renderInsumosEtapa(data);
}

function renderInsumosLista(data) {
  const sorted = [...data].sort((a, b) => b.fecha.localeCompare(a.fecha));
  const tbody = document.getElementById('insumos-tbody');
  if (!tbody) return;
  if (!sorted.length) { tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted" style="padding:24px">Sin registros</td></tr>'; return; }
  tbody.innerHTML = sorted.map(r => `
    <tr>
      <td class="mono">${dateStr(r.fecha)}</td>
      <td>S${r.semana_iso || isoWeek(r.fecha)}</td>
      <td>${r.etapa}</td>
      <td>${r.ingrediente}</td>
      <td class="mono text-right">${fmt(r.cantidad)} ${r.presentacion || 'kg'}</td>
      <td class="mono text-right">${fmtM(r.cu)}</td>
      <td class="mono text-right">${fmtM(r.importe)}</td>
      <td>
        ${currentUser.nivel >= 2 ? `<button class="btn btn-danger btn-sm btn-icon" onclick="deleteInsumo('${r.id}')"><i class="fas fa-trash"></i></button>` : ''}
      </td>
    </tr>`).join('');
}

function renderInsumosIngrediente(data) {
  const totals = {};
  INGREDIENTES.forEach(i => { totals[i] = 0; });
  data.forEach(r => { if (totals[r.ingrediente] !== undefined) totals[r.ingrediente] += r.importe || 0; });
  const total = Object.values(totals).reduce((s, v) => s + v, 0);
  const tbody = document.getElementById('insumos-ing-tbody');
  if (!tbody) return;
  tbody.innerHTML = INGREDIENTES.map(i => `
    <tr>
      <td>${i}</td>
      <td class="mono text-right">${fmtM(totals[i])}</td>
      <td class="mono text-right">${total > 0 ? fmt(totals[i] / total * 100) + '%' : '—'}</td>
    </tr>`).join('');
  const tfoot = document.getElementById('insumos-ing-tfoot');
  if (tfoot) tfoot.innerHTML = `<tr><td><b>Total</b></td><td class="mono text-right text-green"><b>${fmtM(total)}</b></td><td class="mono text-right">100%</td></tr>`;
}

function renderInsumosEtapa(data) {
  const totals = {};
  ETAPAS.forEach(e => { totals[e] = 0; });
  data.forEach(r => { if (totals[r.etapa] !== undefined) totals[r.etapa] += r.importe || 0; });
  const total = Object.values(totals).reduce((s, v) => s + v, 0);
  const tbody = document.getElementById('insumos-etapa-tbody');
  if (!tbody) return;
  tbody.innerHTML = ETAPAS.map(e => `
    <tr>
      <td>${e}</td>
      <td class="mono text-right">${fmtM(totals[e])}</td>
      <td class="mono text-right">${total > 0 ? fmt(totals[e] / total * 100) + '%' : '—'}</td>
    </tr>`).join('');
}

function openInsumosModal() {
  document.getElementById('ins-form').reset();
  document.getElementById('ins-modal-id').value = '';
  document.getElementById('ins-fecha').value = today();
  updateInsumosCU();
  openModal('insumos-modal');
}

function updateInsumosCU() {
  const ing = document.getElementById('ins-ingrediente').value;
  const precios = getObj('precios_cu');
  const cu = precios[ing] || 0;
  document.getElementById('ins-cu').value = cu;
  calcInsumosImporte();
}

function calcInsumosImporte() {
  const cant = parseFloat(document.getElementById('ins-cantidad').value) || 0;
  const cu = parseFloat(document.getElementById('ins-cu').value) || 0;
  const medio = parseFloat(document.getElementById('ins-medio').value) || 1;
  const imp = cant * cu * medio;
  document.getElementById('ins-importe').value = imp.toFixed(2);
}

async function saveInsumo() {
  const id = document.getElementById('ins-modal-id').value || uid();
  const fecha = document.getElementById('ins-fecha').value;
  const ingrediente = document.getElementById('ins-ingrediente').value;
  const cantidad = parseFloat(document.getElementById('ins-cantidad').value) || 0;
  const medio = parseFloat(document.getElementById('ins-medio').value) || 1;
  const cu = parseFloat(document.getElementById('ins-cu').value) || 0;
  const importe = parseFloat(document.getElementById('ins-importe').value) || 0;
  if (!fecha || !cantidad) { toast('Completa los campos obligatorios', 'error'); return; }

  const rec = {
    id, fecha,
    semana_iso: isoWeek(fecha),
    etapa: document.getElementById('ins-etapa').value,
    ingrediente,
    presentacion: document.getElementById('ins-presentacion').value,
    medio, cantidad, cu, importe,
    usuario: currentUser.user, _ts: ts()
  };
  const data = getData('insumos');
  const idx = data.findIndex(r => r.id === id);
  if (idx >= 0) data[idx] = rec; else data.push(rec);
  await setData('insumos', data);

  // Descontar en bodega automáticamente
  await bodegaMovAuto(ingrediente, cantidad * medio, fecha, `Insumos: ${rec.etapa}`, rec.id);

  closeModal('insumos-modal');
  renderInsumos();
  toast('Insumo guardado y descontado en bodega', 'success');
}

async function deleteInsumo(id) {
  if (!confirm('¿Eliminar este registro de insumo?')) return;
  const data = getData('insumos').filter(r => r.id !== id);
  await setData('insumos', data);
  renderInsumos();
  toast('Registro eliminado', 'info');
}

/* ════════════════════════════════════════════════
   ██████  BODEGA
═══════════════════════════════════════════════════ */
let bodegaFiltroInsumo = 'Maíz';

async function bodegaMovAuto(insumo, cantidad, fecha, concepto, refId) {
  const bodega = getData('bodega');
  // check stock
  const stock = calcStock(insumo, bodega);
  if (stock < cantidad) toast(`⚠️ Stock insuficiente de ${insumo} (${fmt(stock)} disponible)`, 'warning');

  const rec = {
    id: uid(), insumo, tipo: 'Salida', cantidad, cu: 0,
    fecha, concepto, ref_id: refId, auto: true, usuario: currentUser.user, _ts: ts()
  };
  bodega.push(rec);
  await setData('bodega', bodega);
}

function calcStock(insumo, bodega) {
  return bodega.filter(r => r.insumo === insumo).reduce((s, r) => {
    if (r.tipo === 'Entrada') return s + r.cantidad;
    if (r.tipo === 'Salida') return s - r.cantidad;
    if (r.tipo === 'Ajuste') return r.cantidad; // ajuste = fijar valor
    return s;
  }, 0);
}

function renderBodega() {
  // KPIs stock actual
  const bodega = getData('bodega');
  const stockEl = document.getElementById('bodega-stock-grid');
  if (stockEl) {
    stockEl.innerHTML = INSUMOS_BODEGA.map(ins => {
      const stock = calcStock(ins, bodega);
      const unit = INSUMO_UNITS[ins];
      return `<div class="kpi-card ${stock <= 0 ? 'red' : ''}">
        <div class="kpi-label">${ins}</div>
        <div class="kpi-val">${fmt(stock)} <small style="font-size:12px;color:var(--text2)">${unit}</small></div>
      </div>`;
    }).join('');
  }

  // Kardex del insumo seleccionado
  const movs = bodega.filter(r => r.insumo === bodegaFiltroInsumo).sort((a, b) => a.fecha.localeCompare(b.fecha));
  let saldo = 0;
  const rows = movs.map(r => {
    if (r.tipo === 'Entrada') saldo += r.cantidad;
    else if (r.tipo === 'Salida') saldo -= r.cantidad;
    else if (r.tipo === 'Ajuste') saldo = r.cantidad;
    return `<tr>
      <td class="mono">${dateStr(r.fecha)}</td>
      <td>${r.concepto || '—'}</td>
      <td><span class="badge ${r.tipo === 'Entrada' ? 'badge-green' : r.tipo === 'Ajuste' ? 'badge-blue' : 'badge-red'}">${r.tipo}</span>${r.auto ? ' <span class="badge badge-auto" style="font-size:9px">AUTO</span>' : ''}</td>
      <td class="mono text-right">${r.tipo === 'Entrada' ? fmt(r.cantidad) : '—'}</td>
      <td class="mono text-right">${r.tipo === 'Salida' ? fmt(r.cantidad) : r.tipo === 'Ajuste' ? fmt(r.cantidad) : '—'}</td>
      <td class="mono text-right">${fmt(saldo)}</td>
      ${currentUser.nivel >= 2 ? `<td><button class="btn btn-danger btn-sm btn-icon" onclick="deleteBodega('${r.id}')"><i class="fas fa-trash"></i></button></td>` : '<td></td>'}
    </tr>`;
  });
  const tbody = document.getElementById('bodega-tbody');
  if (tbody) {
    tbody.innerHTML = rows.length ? rows.join('') : '<tr><td colspan="7" class="text-center text-muted" style="padding:24px">Sin movimientos</td></tr>';
  }
}

function openBodegaModal() {
  document.getElementById('bod-form').reset();
  document.getElementById('bod-modal-id').value = '';
  document.getElementById('bod-fecha').value = today();
  openModal('bodega-modal');
}

async function saveBodega() {
  const id = document.getElementById('bod-modal-id').value || uid();
  const insumo = document.getElementById('bod-insumo').value;
  const tipo = document.getElementById('bod-tipo').value;
  const cantidad = parseFloat(document.getElementById('bod-cantidad').value) || 0;
  const fecha = document.getElementById('bod-fecha').value;
  if (!fecha || !cantidad) { toast('Completa los campos', 'error'); return; }

  if (tipo === 'Salida') {
    const stock = calcStock(insumo, getData('bodega'));
    if (stock < cantidad) {
      toast(`Stock insuficiente: ${fmt(stock)} ${INSUMO_UNITS[insumo]} disponibles`, 'error');
    }
  }

  const rec = {
    id, insumo, tipo, cantidad,
    cu: parseFloat(document.getElementById('bod-cu').value) || 0,
    fecha, concepto: document.getElementById('bod-concepto').value,
    auto: false, usuario: currentUser.user, _ts: ts()
  };
  const data = getData('bodega');
  data.push(rec);
  await setData('bodega', data);
  closeModal('bodega-modal');
  renderBodega();
  toast('Movimiento registrado', 'success');
}

async function deleteBodega(id) {
  if (!confirm('¿Eliminar este movimiento?')) return;
  await setData('bodega', getData('bodega').filter(r => r.id !== id));
  renderBodega();
}

/* ════════════════════════════════════════════════
   ██████  REPRODUCCIÓN
═══════════════════════════════════════════════════ */
let reproTab = 'cerdas';

function renderReproduccion() {
  if (reproTab === 'cerdas') renderCerdas();
  else if (reproTab === 'servicios') renderServicios();
  else if (reproTab === 'diagnosticos') renderDiagnosticos();
  else if (reproTab === 'partos') renderPartos();
  else if (reproTab === 'sementales') renderSementales();
}

/* ── Cerdas ── */
function renderCerdas() {
  const cerdas = getData('cerdas').sort((a, b) => a.nombre?.localeCompare(b.nombre));
  const tbody = document.getElementById('cerdas-tbody');
  if (!tbody) return;
  tbody.innerHTML = cerdas.length ? cerdas.map(c => `
    <tr>
      <td class="mono">${c.id_cerda || c.id}</td>
      <td><b>${c.nombre}</b></td>
      <td>${c.raza || '—'}</td>
      <td class="mono">${dateStr(c.fecha_nacimiento)}</td>
      <td><span class="badge ${c.estado === 'Activa' ? 'badge-green' : c.estado === 'Descarte' ? 'badge-amber' : 'badge-red'}">${c.estado}</span></td>
      <td>
        <button class="btn btn-secondary btn-sm" onclick="editCerda('${c.id}')"><i class="fas fa-edit"></i></button>
        ${currentUser.nivel >= 2 ? `<button class="btn btn-danger btn-sm btn-icon" onclick="deleteCerda('${c.id}')"><i class="fas fa-trash"></i></button>` : ''}
      </td>
    </tr>`).join('') : '<tr><td colspan="6" class="text-center text-muted" style="padding:24px">Sin cerdas registradas</td></tr>';
}

function openCerdaModal(id = null) {
  document.getElementById('cerda-form').reset();
  if (id) {
    const c = getData('cerdas').find(x => x.id === id);
    if (c) {
      document.getElementById('cerda-modal-id').value = c.id;
      document.getElementById('cf2-id').value = c.id_cerda || '';
      document.getElementById('cf2-nombre').value = c.nombre;
      document.getElementById('cf2-raza').value = c.raza || '';
      document.getElementById('cf2-fnac').value = c.fecha_nacimiento || '';
      document.getElementById('cf2-estado').value = c.estado;
    }
  } else {
    document.getElementById('cerda-modal-id').value = '';
  }
  openModal('cerda-modal');
}

function editCerda(id) { openCerdaModal(id); }

async function saveCerda() {
  const id = document.getElementById('cerda-modal-id').value || uid();
  const rec = {
    id, id_cerda: document.getElementById('cf2-id').value,
    nombre: document.getElementById('cf2-nombre').value,
    raza: document.getElementById('cf2-raza').value,
    fecha_nacimiento: document.getElementById('cf2-fnac').value,
    estado: document.getElementById('cf2-estado').value,
    usuario: currentUser.user, _ts: ts()
  };
  if (!rec.nombre) { toast('El nombre es requerido', 'error'); return; }
  const data = getData('cerdas');
  const idx = data.findIndex(r => r.id === id);
  if (idx >= 0) data[idx] = rec; else data.push(rec);
  await setData('cerdas', data);
  closeModal('cerda-modal');
  renderCerdas();
  toast('Cerda guardada', 'success');
}

async function deleteCerda(id) {
  if (!confirm('¿Eliminar esta cerda?')) return;
  await setData('cerdas', getData('cerdas').filter(r => r.id !== id));
  renderCerdas();
}

/* ── Servicios ── */
function renderServicios() {
  const servicios = getData('servicios').sort((a, b) => b.fecha_servicio.localeCompare(a.fecha_servicio));
  const tbody = document.getElementById('servicios-tbody');
  if (!tbody) return;
  tbody.innerHTML = servicios.length ? servicios.map(s => {
    const cerda = getData('cerdas').find(c => c.id === s.cerda_id);
    const diagFechas = [21, 28, 35, 42].map(d => `D+${d}: ${dateStr(addDays(s.fecha_servicio, d))}`).join(' · ');
    return `<tr>
      <td><b>${cerda?.nombre || s.cerda_id}</b></td>
      <td class="mono">${dateStr(s.fecha_servicio)}</td>
      <td>${s.tipo_servicio}</td>
      <td>${s.semental || s.dosis_codigo || '—'}</td>
      <td class="mono">${dateStr(s.fecha_parto_probable)}</td>
      <td><span class="badge ${s.estado === 'Activo' ? 'badge-green' : s.estado === 'Fallido' ? 'badge-red' : 'badge-amber'}">${s.estado}</span></td>
      <td style="font-size:11px;color:var(--text2)">${diagFechas}</td>
      <td>
        ${currentUser.nivel >= 1 ? `<button class="btn btn-danger btn-sm btn-icon" onclick="deleteServicio('${s.id}')"><i class="fas fa-trash"></i></button>` : ''}
      </td>
    </tr>`;
  }).join('') : '<tr><td colspan="8" class="text-center text-muted" style="padding:24px">Sin servicios registrados</td></tr>';
}

function openServicioModal() {
  document.getElementById('serv-form').reset();
  document.getElementById('serv-modal-id').value = '';
  document.getElementById('sf-fecha').value = today();
  // populate cerdas
  const sel = document.getElementById('sf-cerda');
  sel.innerHTML = '<option value="">— Seleccionar cerda —</option>';
  getData('cerdas').filter(c => c.estado === 'Activa').forEach(c => sel.add(new Option(c.nombre, c.id)));
  calcFechaParto();
  openModal('servicio-modal');
}

function calcFechaParto() {
  const f = document.getElementById('sf-fecha')?.value;
  if (f) document.getElementById('sf-parto').value = addDays(f, 114);
}

async function saveServicio() {
  const id = document.getElementById('serv-modal-id').value || uid();
  const cerda_id = document.getElementById('sf-cerda').value;
  const fecha_servicio = document.getElementById('sf-fecha').value;
  if (!cerda_id || !fecha_servicio) { toast('Completa los campos', 'error'); return; }
  const rec = {
    id, cerda_id, fecha_servicio,
    tipo_servicio: document.getElementById('sf-tipo').value,
    semental: document.getElementById('sf-semental').value,
    dosis_codigo: document.getElementById('sf-dosis').value,
    fecha_parto_probable: addDays(fecha_servicio, 114),
    estado: 'Activo',
    usuario: currentUser.user, _ts: ts()
  };
  const data = getData('servicios');
  data.push(rec);
  await setData('servicios', data);
  closeModal('servicio-modal');
  renderServicios();
  toast('Servicio registrado', 'success');
}

async function deleteServicio(id) {
  if (!confirm('¿Eliminar este servicio?')) return;
  await setData('servicios', getData('servicios').filter(r => r.id !== id));
  renderServicios();
}

/* ── Diagnósticos ── */
function renderDiagnosticos() {
  const diags = getData('diagnosticos').sort((a, b) => b.fecha_diagnostico.localeCompare(a.fecha_diagnostico));
  const tbody = document.getElementById('diag-tbody');
  if (!tbody) return;
  tbody.innerHTML = diags.length ? diags.map(d => {
    const serv = getData('servicios').find(s => s.id === d.servicio_id);
    const cerda = serv ? getData('cerdas').find(c => c.id === serv.cerda_id) : null;
    return `<tr>
      <td><b>${cerda?.nombre || '—'}</b></td>
      <td class="mono">${dateStr(d.fecha_diagnostico)}</td>
      <td>D+${d.ventana}</td>
      <td class="mono">${d.dias_post || '—'} días</td>
      <td><span class="badge ${d.resultado === 'Positivo' ? 'badge-green' : d.resultado === 'Negativo–regresó a celo' ? 'badge-red' : 'badge-amber'}">${d.resultado}</span></td>
      <td>
        ${currentUser.nivel >= 1 ? `<button class="btn btn-danger btn-sm btn-icon" onclick="deleteDiag('${d.id}')"><i class="fas fa-trash"></i></button>` : ''}
      </td>
    </tr>`;
  }).join('') : '<tr><td colspan="6" class="text-center text-muted" style="padding:24px">Sin diagnósticos registrados</td></tr>';
}

function openDiagModal() {
  document.getElementById('diag-form').reset();
  document.getElementById('diag-modal-id').value = '';
  document.getElementById('df-fecha').value = today();
  const sel = document.getElementById('df-servicio');
  sel.innerHTML = '<option value="">— Seleccionar servicio —</option>';
  getData('servicios').filter(s => s.estado === 'Activo').forEach(s => {
    const c = getData('cerdas').find(x => x.id === s.cerda_id);
    sel.add(new Option(`${c?.nombre || s.cerda_id} — ${dateStr(s.fecha_servicio)}`, s.id));
  });
  openModal('diag-modal');
}

function calcDiasPost() {
  const sid = document.getElementById('df-servicio').value;
  const fecha = document.getElementById('df-fecha').value;
  if (sid && fecha) {
    const serv = getData('servicios').find(s => s.id === sid);
    if (serv) {
      const dias = diffDays(serv.fecha_servicio, fecha);
      document.getElementById('df-dias').value = dias;
    }
  }
}

async function saveDiag() {
  const id = document.getElementById('diag-modal-id').value || uid();
  const servicio_id = document.getElementById('df-servicio').value;
  const fecha_diagnostico = document.getElementById('df-fecha').value;
  const resultado = document.getElementById('df-resultado').value;
  const serv = getData('servicios').find(s => s.id === servicio_id);
  if (!servicio_id || !fecha_diagnostico) { toast('Completa los campos', 'error'); return; }
  const dias_post = serv ? diffDays(serv.fecha_servicio, fecha_diagnostico) : 0;
  const rec = {
    id, servicio_id, fecha_diagnostico, resultado,
    ventana: parseInt(document.getElementById('df-ventana').value),
    dias_post, usuario: currentUser.user, _ts: ts()
  };
  const data = getData('diagnosticos');
  data.push(rec);
  await setData('diagnosticos', data);

  // Si negativo, marcar servicio como fallido
  if (resultado === 'Negativo–regresó a celo' && serv) {
    const servicios = getData('servicios');
    const idx = servicios.findIndex(s => s.id === servicio_id);
    if (idx >= 0) { servicios[idx].estado = 'Fallido'; servicios[idx]._ts = ts(); }
    await setData('servicios', servicios);
    toast('Servicio marcado como Fallido — cerda disponible para nuevo servicio', 'warning');
  }

  closeModal('diag-modal');
  renderDiagnosticos();
  toast('Diagnóstico guardado', 'success');
}

async function deleteDiag(id) {
  if (!confirm('¿Eliminar este diagnóstico?')) return;
  await setData('diagnosticos', getData('diagnosticos').filter(r => r.id !== id));
  renderDiagnosticos();
}

/* ── Partos ── */
function renderPartos() {
  const partos = getData('partos').sort((a, b) => b.fecha_parto.localeCompare(a.fecha_parto));
  const tbody = document.getElementById('partos-tbody');
  if (!tbody) return;
  tbody.innerHTML = partos.length ? partos.map(p => {
    const cerda = getData('cerdas').find(c => c.id === p.cerda_id);
    const vivos = (p.hembras_vivas || 0) + (p.machos_vivos || 0);
    const muertos = (p.hembras_muertas || 0) + (p.machos_muertos || 0);
    return `<tr>
      <td><b>${cerda?.nombre || '—'}</b></td>
      <td class="mono">${dateStr(p.fecha_parto)}</td>
      <td class="mono text-green">${vivos}</td>
      <td class="mono text-red">${muertos}</td>
      <td class="mono">${dateStr(p.fecha_destete_probable)}</td>
      <td class="mono">${dateStr(p.fecha_destete_real) || '—'}</td>
      <td class="mono">${p.dias_lactancia || '—'} d</td>
      <td>
        ${currentUser.nivel >= 1 ? `<button class="btn btn-danger btn-sm btn-icon" onclick="deleteParto('${p.id}')"><i class="fas fa-trash"></i></button>` : ''}
      </td>
    </tr>`;
  }).join('') : '<tr><td colspan="8" class="text-center text-muted" style="padding:24px">Sin partos registrados</td></tr>';
}

function openPartoModal() {
  document.getElementById('parto-form').reset();
  document.getElementById('parto-modal-id').value = '';
  document.getElementById('pf-fecha').value = today();
  const sel = document.getElementById('pf-cerda');
  sel.innerHTML = '<option value="">— Seleccionar cerda —</option>';
  getData('cerdas').filter(c => c.estado === 'Activa').forEach(c => sel.add(new Option(c.nombre, c.id)));
  calcDestete();
  openModal('parto-modal');
}

function calcDestete() {
  const f = document.getElementById('pf-fecha')?.value;
  if (f) document.getElementById('pf-destete-prob').value = addDays(f, 21);
}

function calcTotalesParto() {
  const hv = parseInt(document.getElementById('pf-hembras-vivas').value) || 0;
  const mv = parseInt(document.getElementById('pf-machos-vivos').value) || 0;
  const hm = parseInt(document.getElementById('pf-hembras-muertas').value) || 0;
  const mm = parseInt(document.getElementById('pf-machos-muertos').value) || 0;
  document.getElementById('pf-total-vivos').textContent = hv + mv;
  document.getElementById('pf-total-muertos').textContent = hm + mm;
}

function calcDiasLactancia() {
  const fp = document.getElementById('pf-fecha')?.value;
  const fd = document.getElementById('pf-destete-real')?.value;
  if (fp && fd) document.getElementById('pf-dias-lact').value = diffDays(fp, fd);
}

async function saveParto() {
  const id = document.getElementById('parto-modal-id').value || uid();
  const cerda_id = document.getElementById('pf-cerda').value;
  const fecha_parto = document.getElementById('pf-fecha').value;
  if (!cerda_id || !fecha_parto) { toast('Completa los campos', 'error'); return; }
  const fd = document.getElementById('pf-destete-real').value;
  const rec = {
    id, cerda_id, fecha_parto,
    hembras_vivas: parseInt(document.getElementById('pf-hembras-vivas').value) || 0,
    machos_vivos: parseInt(document.getElementById('pf-machos-vivos').value) || 0,
    hembras_muertas: parseInt(document.getElementById('pf-hembras-muertas').value) || 0,
    machos_muertos: parseInt(document.getElementById('pf-machos-muertos').value) || 0,
    destino_machos: document.getElementById('pf-destino').value,
    fecha_destete_probable: addDays(fecha_parto, 21),
    fecha_destete_real: fd || null,
    dias_lactancia: fd ? diffDays(fecha_parto, fd) : null,
    hembras_destetadas: parseInt(document.getElementById('pf-hembras-dest').value) || 0,
    machos_destetados: parseInt(document.getElementById('pf-machos-dest').value) || 0,
    peso_min: parseFloat(document.getElementById('pf-peso-min').value) || null,
    peso_med: parseFloat(document.getElementById('pf-peso-med').value) || null,
    peso_max: parseFloat(document.getElementById('pf-peso-max').value) || null,
    usuario: currentUser.user, _ts: ts()
  };
  if (rec.peso_min && rec.peso_med && rec.peso_max) {
    rec.peso_promedio = (rec.peso_min + rec.peso_med + rec.peso_max) / 3;
  }
  const data = getData('partos');
  data.push(rec);
  await setData('partos', data);
  closeModal('parto-modal');
  renderPartos();
  toast('Parto registrado', 'success');
}

async function deleteParto(id) {
  if (!confirm('¿Eliminar este parto?')) return;
  await setData('partos', getData('partos').filter(r => r.id !== id));
  renderPartos();
}

/* ── Sementales ── */
function renderSementales() {
  const sems = getData('sementales');
  const tbody = document.getElementById('sem-tbody');
  if (!tbody) return;
  tbody.innerHTML = sems.length ? sems.map(s => `
    <tr>
      <td class="mono">${s.id_sem || s.id}</td>
      <td><b>${s.nombre}</b></td>
      <td>${s.raza || '—'}</td>
      <td>${s.procedencia || '—'}</td>
      <td class="mono text-center">${s.dosis_disponibles || 0}</td>
      <td><span class="badge ${s.estado === 'Activo' ? 'badge-green' : 'badge-red'}">${s.estado}</span></td>
      <td>
        <button class="btn btn-secondary btn-sm" onclick="editSemental('${s.id}')"><i class="fas fa-edit"></i></button>
        ${currentUser.nivel >= 2 ? `<button class="btn btn-danger btn-sm btn-icon" onclick="deleteSemental('${s.id}')"><i class="fas fa-trash"></i></button>` : ''}
      </td>
    </tr>`).join('') : '<tr><td colspan="7" class="text-center text-muted" style="padding:24px">Sin sementales registrados</td></tr>';
}

function openSementalModal(id = null) {
  document.getElementById('sem-form').reset();
  if (id) {
    const s = getData('sementales').find(x => x.id === id);
    if (s) {
      document.getElementById('sem-modal-id').value = s.id;
      document.getElementById('smf-id').value = s.id_sem || '';
      document.getElementById('smf-nombre').value = s.nombre;
      document.getElementById('smf-raza').value = s.raza || '';
      document.getElementById('smf-proc').value = s.procedencia || '';
      document.getElementById('smf-dosis').value = s.dosis_disponibles || 0;
      document.getElementById('smf-estado').value = s.estado;
    }
  } else {
    document.getElementById('sem-modal-id').value = '';
  }
  openModal('sem-modal');
}

function editSemental(id) { openSementalModal(id); }

async function saveSemental() {
  const id = document.getElementById('sem-modal-id').value || uid();
  const rec = {
    id, id_sem: document.getElementById('smf-id').value,
    nombre: document.getElementById('smf-nombre').value,
    raza: document.getElementById('smf-raza').value,
    procedencia: document.getElementById('smf-proc').value,
    dosis_disponibles: parseInt(document.getElementById('smf-dosis').value) || 0,
    estado: document.getElementById('smf-estado').value,
    usuario: currentUser.user, _ts: ts()
  };
  if (!rec.nombre) { toast('El nombre es requerido', 'error'); return; }
  const data = getData('sementales');
  const idx = data.findIndex(r => r.id === id);
  if (idx >= 0) data[idx] = rec; else data.push(rec);
  await setData('sementales', data);
  closeModal('sem-modal');
  renderSementales();
  toast('Semental guardado', 'success');
}

async function deleteSemental(id) {
  if (!confirm('¿Eliminar este semental?')) return;
  await setData('sementales', getData('sementales').filter(r => r.id !== id));
  renderSementales();
}

/* ════════════════════════════════════════════════
   ██████  CONFIGURACIÓN
═══════════════════════════════════════════════════ */
function renderConfiguracion() {
  if (currentUser.nivel < 2) {
    document.getElementById('page-configuracion').innerHTML = '<div class="empty-state"><i class="fas fa-lock"></i><p>Acceso restringido</p></div>';
    return;
  }
  renderPreciosCU();
  updateLastSyncLabel();
}

function renderPreciosCU() {
  const precios = getObj('precios_cu');
  const tbody = document.getElementById('precios-tbody');
  if (!tbody) return;
  tbody.innerHTML = INGREDIENTES.map(ing => `
    <tr>
      <td>${ing}</td>
      <td><input type="number" step="0.01" value="${precios[ing] || 0}" class="form-group input" style="width:120px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:5px 8px;" id="cu-${ing}" /></td>
      <td><button class="btn btn-primary btn-sm" onclick="savePrecioCU('${ing}')">Guardar</button></td>
    </tr>`).join('');
}

async function savePrecioCU(ing) {
  const val = parseFloat(document.getElementById(`cu-${ing}`).value) || 0;
  const precios = getObj('precios_cu');
  precios[ing] = val;
  await setObj('precios_cu', precios);
  toast(`Precio de ${ing} actualizado: ${fmtM(val)}`, 'success');
}

function updateLastSyncLabel() {
  const raw = localStorage.getItem('last_sync');
  const ahora = new Date();
  let texto = '';
  let clase = 'text-red';
  if (!raw) {
    texto = 'Nunca sincronizado';
  } else {
    const fecha = new Date(raw);
    const mins = Math.round((ahora - fecha) / 60000);
    if (mins < 1) texto = 'Hace menos de 1 minuto';
    else if (mins < 60) texto = `Hace ${mins} min`;
    else if (mins < 1440) texto = `Hace ${Math.round(mins/60)} h`;
    else texto = `${fecha.toLocaleDateString('es-MX', { day:'2-digit', month:'short' })} ${fecha.toLocaleTimeString('es-MX', { hour:'2-digit', minute:'2-digit' })}`;
    const horas = mins / 60;
    clase = horas > 24 ? 'text-red' : horas > 8 ? 'text-amber' : 'text-green';
  }
  // Header label
  const el = document.getElementById('last-sync-label');
  if (el) { el.textContent = texto; el.className = `sync-label ${clase}`; }
  // Config page label
  const el2 = document.getElementById('last-sync-label-cfg');
  if (el2) {
    el2.textContent = raw ? `Último respaldo en Firebase: ${texto}` : 'Sin sincronización con Firebase aún';
    el2.className = clase;
  }
}

// ── RESPALDO COMPLETO ──
function exportRespaldo() {
  const respaldo = {
    version: APP_VERSION,
    fecha: new Date().toISOString(),
    generado_por: currentUser?.user || 'sistema',
    datos: {}
  };
  DATA_KEYS.forEach(k => { respaldo.datos[k] = getData(k); });
  respaldo.datos.precios_cu = getObj('precios_cu');
  const json = JSON.stringify(respaldo, null, 2);
  const nombre = `AgroSuino_respaldo_${today()}.json`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  a.download = nombre;
  a.click();
  toast(`Respaldo guardado: ${nombre}`, 'success', 5000);
}

function importRespaldo() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const respaldo = JSON.parse(text);
      if (!respaldo.datos) { toast('Archivo inválido: no tiene estructura de respaldo', 'error'); return; }
      if (!confirm(`¿Restaurar respaldo del ${respaldo.fecha?.slice(0,10) || 'fecha desconocida'}?\n\nEsto fusionará los datos del archivo con los actuales (gana el registro más reciente). No se eliminará información.`)) return;
      DATA_KEYS.forEach(k => {
        if (respaldo.datos[k]) {
          const local = getData(k);
          const merged = mergeByTs(local, respaldo.datos[k]);
          localStorage.setItem(k, JSON.stringify(merged));
        }
      });
      if (respaldo.datos.precios_cu) localStorage.setItem('precios_cu', JSON.stringify(respaldo.datos.precios_cu));
      toast('Respaldo restaurado correctamente', 'success');
      renderCurrentPage();
      // Sincronizar a Firebase si hay conexión
      if (isOnline) { await syncToFirebase(); }
    } catch (err) {
      toast('Error al leer el archivo: ' + err.message, 'error');
    }
  };
  input.click();
}

// ── RESPALDO AUTOMÁTICO SEMANAL ──
function checkAutoRespaldo() {
  const KEY = 'last_auto_respaldo';
  const ultimo = localStorage.getItem(KEY);
  const ahora = new Date();
  const lunes = ahora.getDay() === 1; // 1 = lunes
  if (!lunes) return;
  if (ultimo) {
    const ultimaFecha = new Date(ultimo);
    const mismoLunes = ultimaFecha.toDateString() === ahora.toDateString();
    if (mismoLunes) return; // ya se hizo hoy
  }
  // Ejecutar respaldo silencioso
  const respaldo = {
    version: APP_VERSION,
    fecha: ahora.toISOString(),
    generado_por: 'auto',
    datos: {}
  };
  DATA_KEYS.forEach(k => { respaldo.datos[k] = getData(k); });
  respaldo.datos.precios_cu = getObj('precios_cu');
  const json = JSON.stringify(respaldo, null, 2);
  const nombre = `AgroSuino_auto_${today()}.json`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  a.download = nombre;
  a.click();
  localStorage.setItem(KEY, ahora.toISOString());
  toast(`📥 Respaldo automático semanal descargado: ${nombre}`, 'info', 6000);
}
  const data = getData(key);
  if (!data.length) { toast('Sin datos para exportar', 'warning'); return; }
  const headers = Object.keys(data[0]);
  const rows = data.map(r => headers.map(h => `"${r[h] ?? ''}"`).join(','));
  const csv = [headers.join(','), ...rows].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `${key}_${today()}.csv`;
  a.click();
  toast(`${key}.csv exportado`, 'success');
}

function exportJSON(key) {
  const data = getData(key);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  a.download = `${key}_${today()}.json`;
  a.click();
  toast(`${key}.json exportado`, 'success');
}

/* ════════════════════════════════════════════════
   HTML BUILDER — builds dynamic HTML into pages
═══════════════════════════════════════════════════ */
function buildHTML() {
  // This is called from DOMContentLoaded after static HTML is in place
  // Dynamic elements are inserted into pre-existing containers
}

/* ════════════════════════════════════════════════
   ██████  ONBOARDING
═══════════════════════════════════════════════════ */
const OB_TOTAL = 5;
let obCurrentSlide = 0;

function showOnboarding() {
  // Si el usuario marcó "omitir siempre", no mostrar
  if (localStorage.getItem('ob_skip_always') === '1') return;
  obCurrentSlide = 0;
  // Insertar nombre de usuario en slide 1
  const nameEl = document.getElementById('ob-username');
  if (nameEl) nameEl.textContent = currentUser.label;
  // Resetear al primer slide
  goToSlide(0);
  document.getElementById('onboarding-overlay').classList.add('show');
}

function hideOnboarding() {
  document.getElementById('onboarding-overlay').classList.remove('show');
}

function goToSlide(n) {
  obCurrentSlide = n;
  // Slides
  document.querySelectorAll('.ob-slide').forEach((s, i) => {
    s.classList.toggle('active', i === n);
  });
  // Dots
  document.querySelectorAll('.ob-dot').forEach((d, i) => {
    d.classList.toggle('active', i === n);
  });
  // Botón prev
  const prev = document.getElementById('ob-prev-btn');
  if (prev) prev.style.visibility = n === 0 ? 'hidden' : 'visible';
  // Botón next
  const next = document.getElementById('ob-next-btn');
  if (next) {
    if (n === OB_TOTAL - 1) {
      next.innerHTML = '<i class="fas fa-check"></i> Entendido';
    } else {
      next.innerHTML = 'Siguiente <i class="fas fa-arrow-right"></i>';
    }
  }
}

function obNext() {
  if (obCurrentSlide < OB_TOTAL - 1) {
    goToSlide(obCurrentSlide + 1);
  } else {
    hideOnboarding();
  }
}

function obPrev() {
  if (obCurrentSlide > 0) goToSlide(obCurrentSlide - 1);
}

function obSkipAlways() {
  if (!confirm('¿Omitir esta guía en todos los inicios de sesión futuros?\n\nPodrás reactivarla desde Configuración.')) return;
  localStorage.setItem('ob_skip_always', '1');
  hideOnboarding();
  toast('Guía desactivada. Puedes reactivarla en Configuración.', 'info', 4000);
}

function obResetSkip() {
  localStorage.removeItem('ob_skip_always');
  toast('La guía de inicio volverá a mostrarse al próximo inicio de sesión.', 'success');
}

/* ════════════════════════════════════════════════
   SERVICE WORKER REGISTRATION
═══════════════════════════════════════════════════ */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

/* ════════════════════════════════════════════════
   BOOT
═══════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  // Set version strings
  document.querySelectorAll('.version-tag').forEach(el => el.textContent = APP_VERSION);
  document.title = `AgroSuino ${APP_VERSION}`;

  // Mobile sidebar toggle
  document.getElementById('hamburger')?.addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
  });

  // Login
  document.getElementById('login-btn')?.addEventListener('click', login);
  document.getElementById('login-pass')?.addEventListener('keydown', e => { if (e.key === 'Enter') login(); });

  // Nav
  document.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', () => navigate(el.dataset.page));
  });

  // Logout
  document.getElementById('logout-btn')?.addEventListener('click', logout);

  // Connection badge click → sync
  document.getElementById('conn-badge')?.addEventListener('click', () => {
    if (isOnline) syncToFirebase();
    else toast('Sin conexión a internet', 'error');
  });

  // Contabilidad
  document.getElementById('contab-mes')?.addEventListener('change', e => { contabFiltroMes = e.target.value; renderContabTable(); });
  document.getElementById('contab-anio')?.addEventListener('change', e => { contabFiltroAnio = e.target.value; renderContabTable(); });
  document.getElementById('cf-tipo')?.addEventListener('change', updateContabSubcats);
  document.getElementById('cf-categoria')?.addEventListener('change', updateContabSubSubcats);

  // Insumos tabs
  document.querySelectorAll('[data-insumos-tab]').forEach(el => {
    el.addEventListener('click', () => {
      insumosTab = el.dataset.insumosTab;
      document.querySelectorAll('[data-insumos-tab]').forEach(t => t.classList.remove('active'));
      el.classList.add('active');
      document.querySelectorAll('[data-insumos-panel]').forEach(p => {
        p.style.display = 'none';
        p.classList.remove('active');
      });
      const panel = document.querySelector(`[data-insumos-panel="${insumosTab}"]`);
      if (panel) { panel.style.display = 'block'; panel.classList.add('active'); }
      renderInsumosTabs();
    });
  });
  document.getElementById('insumos-mes')?.addEventListener('change', e => { insumosFiltroMes = e.target.value; renderInsumosTabs(); });
  document.getElementById('insumos-anio')?.addEventListener('change', e => { insumosFiltroAnio = e.target.value; renderInsumosTabs(); });
  document.getElementById('ins-ingrediente')?.addEventListener('change', updateInsumosCU);
  document.getElementById('ins-cantidad')?.addEventListener('input', calcInsumosImporte);
  document.getElementById('ins-medio')?.addEventListener('input', calcInsumosImporte);
  document.getElementById('ins-cu')?.addEventListener('input', calcInsumosImporte);

  // Bodega filter
  document.getElementById('bodega-filtro-insumo')?.addEventListener('change', e => { bodegaFiltroInsumo = e.target.value; renderBodega(); });

  // Reproducción tabs
  document.querySelectorAll('[data-repro-tab]').forEach(el => {
    el.addEventListener('click', () => {
      reproTab = el.dataset.reproTab;
      document.querySelectorAll('[data-repro-tab]').forEach(t => t.classList.remove('active'));
      el.classList.add('active');
      document.querySelectorAll('[data-repro-panel]').forEach(p => {
        p.style.display = 'none';
        p.classList.remove('active');
      });
      const panel = document.querySelector(`[data-repro-panel="${reproTab}"]`);
      if (panel) { panel.style.display = 'block'; panel.classList.add('active'); }
      renderReproduccion();
    });
  });

  // Servicio
  document.getElementById('sf-fecha')?.addEventListener('change', calcFechaParto);

  // Parto
  document.getElementById('pf-fecha')?.addEventListener('change', calcDestete);
  document.getElementById('pf-destete-real')?.addEventListener('change', calcDiasLactancia);
  ['pf-hembras-vivas','pf-machos-vivos','pf-hembras-muertas','pf-machos-muertos'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', calcTotalesParto);
  });

  // Diagnóstico
  document.getElementById('df-servicio')?.addEventListener('change', calcDiasPost);
  document.getElementById('df-fecha')?.addEventListener('change', calcDiasPost);

  // Modal closes
  document.querySelectorAll('.modal-close, [data-modal-close]').forEach(el => {
    el.addEventListener('click', () => {
      el.closest('.modal-overlay')?.classList.remove('open');
    });
  });
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('open'); });
  });

  // Config sync buttons
  document.getElementById('btn-sync-all')?.addEventListener('click', syncToFirebase);
  document.getElementById('btn-download-fb')?.addEventListener('click', downloadFromFirebase);
  document.getElementById('btn-check-conn')?.addEventListener('click', async () => {
    await checkConnection();
    toast(isOnline ? 'Firebase conectado ✓' : 'Sin conexión a Firebase', isOnline ? 'success' : 'error');
  });
  document.getElementById('btn-export-respaldo')?.addEventListener('click', exportRespaldo);
  document.getElementById('btn-import-respaldo')?.addEventListener('click', importRespaldo);

  // Onboarding
  document.getElementById('ob-next-btn')?.addEventListener('click', obNext);
  document.getElementById('ob-prev-btn')?.addEventListener('click', obPrev);
  document.getElementById('ob-skip-btn')?.addEventListener('click', obSkipAlways);
  document.querySelectorAll('.ob-dot').forEach(dot => {
    dot.addEventListener('click', () => goToSlide(parseInt(dot.dataset.dot)));
  });

  // Check session or show login
  if (!checkSession()) {
    document.getElementById('login-screen').style.display = 'flex';
  }
});
