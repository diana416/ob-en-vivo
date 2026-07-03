// ================================================================
// ChartMogul fetcher
// El API público de CM NO expone la tabla de cohortes del UI, así
// que se calcula desde datos crudos:
//   - /v1/customers  → cohorte (customer-since), status, atributos
//   - /v1/activities → eventos churn / reactivation con fecha
// Retención Mk de un cohorte = % de clientes del cohorte que estaban
// activos k meses después de su customer-since (replicando la lógica
// de "Customer Retention" de CM: churn resta, reactivación suma).
// VALIDAR contra el UI antes de publicar (control: Jul 2025 = 224
// clientes, M1 84.38%, M2 78.13%).
// ================================================================
const CFG = require("./config");

const KEY = process.env.CHARTMOGUL_API_KEY;

function authHeader() {
  return "Basic " + Buffer.from(`${KEY}:`).toString("base64");
}

async function cmGet(path, params = {}) {
  const url = new URL(CFG.CM_BASE + path);
  Object.entries(params).forEach(([k, v]) => v != null && url.searchParams.set(k, v));
  const res = await fetch(url, { headers: { Authorization: authHeader() } });
  if (!res.ok) throw new Error(`ChartMogul ${path} → ${res.status} ${await res.text().catch(() => "")}`);
  return res.json();
}

// Paginación: soporta cursor (API actual) y page (legacy)
async function cmGetAll(path, params, entriesKey = "entries") {
  const all = [];
  let cursor = null;
  let page = 1;
  for (let i = 0; i < 500; i++) { // tope de seguridad
    const data = await cmGet(path, { ...params, per_page: 200, ...(cursor ? { cursor } : { page }) });
    const entries = data[entriesKey] || [];
    all.push(...entries);
    if (data.cursor && data.has_more) { cursor = data.cursor; }
    else if (data.has_more || (data.total_pages && page < data.total_pages)) { page += 1; cursor = null; }
    else break;
    if (entries.length === 0) break;
  }
  return all;
}

const monthKey = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
const addMonths = (d, n) => { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + n); return x; };

async function fetchChartMogul() {
  if (!KEY) return { error: "CHARTMOGUL_API_KEY no configurada", cohortes: null, conexion: null };

  // 1) Clientes pagados: customer-since ≠ null
  const customers = await cmGetAll("/customers", {});
  const paid = customers.filter((c) => c["customer-since"]);

  // 2) Timeline de churn/reactivación por cliente
  const churnActs = await cmGetAll("/activities", { type: "churn" });
  const reactActs = await cmGetAll("/activities", { type: "reactivation" });
  const events = {}; // uuid → [{t, type}] ordenados
  for (const a of churnActs) (events[a["customer-uuid"]] ||= []).push({ t: new Date(a.date), type: "churn" });
  for (const a of reactActs) (events[a["customer-uuid"]] ||= []).push({ t: new Date(a.date), type: "react" });
  Object.values(events).forEach((l) => l.sort((a, b) => a.t - b.t));

  // Activo en fecha X = último evento antes de X no es churn
  function activeAt(uuid, date) {
    const list = events[uuid];
    if (!list) return true; // nunca churneó
    let active = true;
    for (const e of list) {
      if (e.t > date) break;
      active = e.type !== "churn";
    }
    return active;
  }

  // 3) Cohortes mensuales M1/M2/M3
  const now = new Date();
  const cohorts = {}; // "2026-01" → {n, m1, m2, m3, since: []}
  for (const c of paid) {
    const since = new Date(c["customer-since"]);
    const key = monthKey(since);
    (cohorts[key] ||= { n: 0, ret: [0, 0, 0], evaluable: [0, 0, 0] });
    cohorts[key].n += 1;
    for (let k = 1; k <= 3; k++) {
      const checkpoint = addMonths(since, k);
      if (checkpoint <= now) {
        cohorts[key].evaluable[k - 1] += 1;
        if (activeAt(c.uuid, checkpoint)) cohorts[key].ret[k - 1] += 1;
      }
    }
  }

  const keys = Object.keys(cohorts).sort().slice(-CFG.CM_COHORT_MONTHS);
  const tabla = keys.map((k) => {
    const c = cohorts[k];
    const pct = (i) => (c.evaluable[i] === c.n && c.n > 0 ? +((c.ret[i] / c.n) * 100).toFixed(2) : null);
    return { cohorte: k, n: c.n, m1: pct(0), m2: pct(1), m3: pct(2) };
  });
  // Cabecera: cohorte más reciente con M3 completo (para M1/M2/M3 consistentes)
  const cabecera = [...tabla].reverse().find((r) => r.m3 != null) || null;

  // 4) KPI Conexión: atributo Conexion_Exitosa_OB_M en cohorte reciente con ≥14 días
  const cutoff = new Date(now.getTime() - CFG.CM_CONEXION_MIN_DIAS * 86400000);
  const conKey = monthKey(cutoff); // cohorte del mes que ya tiene ≥14 días para sus primeros clientes
  const cohortCustomers = paid.filter((c) => {
    const since = new Date(c["customer-since"]);
    return monthKey(since) === conKey && since <= cutoff; // solo los que ya cumplieron la ventana
  });
  let nSeg = 0;
  for (const c of cohortCustomers) {
    const v = c.attributes?.custom?.[CFG.CM_CONEXION_ATTR];
    if (v != null && CFG.CM_CONEXION_OK_VALUES.includes(String(v))) nSeg += 1;
  }
  const conexion = cohortCustomers.length > 0
    ? {
        valor: +((nSeg / cohortCustomers.length) * 100).toFixed(1),
        n_segmento: nSeg,
        n_total: cohortCustomers.length,
        cohorte: conKey,
        nota: `Clientes del cohorte ${conKey} con ≥${CFG.CM_CONEXION_MIN_DIAS} días transcurridos y ${CFG.CM_CONEXION_ATTR} ∈ {${CFG.CM_CONEXION_OK_VALUES.join(", ")}}. Vacío/No_Exitosa no cuentan. Proxy: no valida plantilla ni 7 días sin caída.`,
      }
    : { valor: null, n_segmento: null, n_total: 0, cohorte: conKey, nota: "Sin clientes evaluables en la ventana." };

  return { cohortes: { tabla, cabecera }, conexion, error: null };
}

module.exports = { fetchChartMogul };
