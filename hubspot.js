// ================================================================
// HubSpot fetcher v3 — guiado por las CARDS del Overview del WKS
// (no por etapas de pipeline, que están por reestructurarse).
//
// Lógica de avance (hilo Slack requests-ob, jul 2026):
//  CONEXIÓN lograda:   Sesiones OB >= 1 AND (WAPI connected = Sí OR Tipo conexión poblado)
//  ACTIVACIÓN lograda: Sesiones OB >= 2 AND Lead Agent poblado AND (Plantillas > 0 OR Calidad poblada)
//  ADOPCIÓN lograda:   Health Score poblado AND (Health Tier poblado OR Estado != "No conectado")
//
// Owners por especialización:
//  Conexión/Activación → setuper_owner
//  Adopción/Health     → adoption owner (Ana y Rich viven ahí hoy;
//                        cuando exista "health owner" se cambia en config)
//
// Termómetro: todo se calcula sobre el COHORTE DEL MES
// (WKS con plan contratado en el mes en curso).
// ================================================================
const CFG = require("./config");

const PAT = process.env.HUBSPOT_PAT;
const H = () => ({ Authorization: `Bearer ${PAT}`, "Content-Type": "application/json" });

async function hsGet(path) {
  const res = await fetch(CFG.HS_BASE + path, { headers: H() });
  if (!res.ok) throw new Error(`HubSpot GET ${path} → ${res.status} ${await res.text().catch(() => "")}`);
  return res.json();
}
async function hsPost(path, body) {
  const res = await fetch(CFG.HS_BASE + path, { method: "POST", headers: H(), body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`HubSpot POST ${path} → ${res.status} ${await res.text().catch(() => "")}`);
  return res.json();
}

// ---- Discovery de propiedades por label (nunca adivinar nombres) ----
async function discoverProps() {
  const data = await hsGet(`/crm/v3/properties/${CFG.HS_WKS_OBJECT}`);
  const norm = (s) => (s || "").toLowerCase().replace(/[–—-]/g, "-").replace(/\(auto\)/g, "").replace(/\s+/g, " ").trim();
  const found = {};
  for (const [key, labels] of Object.entries(CFG.HS_PROP_LABELS)) {
    if (CFG.HS_PROP_OVERRIDES[key]) { found[key] = CFG.HS_PROP_OVERRIDES[key]; continue; }
    const wanted = labels.map(norm);
    const match = data.results.find((p) => wanted.some((w) => norm(p.label) === w))
      || data.results.find((p) => wanted.some((w) => norm(p.label).includes(w)));
    found[key] = match ? match.name : null;
  }
  return found;
}

// ---- Owners faltantes por nombre/email ----
async function resolveOwners() {
  const owners = JSON.parse(JSON.stringify(CFG.HS_OWNERS));
  const missing = [];
  for (const etapa of Object.keys(owners))
    for (const [nombre, id] of Object.entries(owners[etapa]))
      if (!id) missing.push({ etapa, nombre });
  if (missing.length === 0) return { owners, notas: [] };

  const all = [];
  let after = null;
  do {
    const data = await hsGet(`/crm/v3/owners?limit=100${after ? `&after=${after}` : ""}`);
    all.push(...(data.results || []));
    after = data.paging?.next?.after || null;
  } while (after);

  const notas = [];
  for (const m of missing) {
    const q = (CFG.HS_OWNER_LOOKUP[m.nombre] || m.nombre).toLowerCase();
    const hits = all.filter((o) =>
      `${o.firstName || ""} ${o.lastName || ""} ${o.email || ""}`.toLowerCase().includes(q)
    );
    if (hits.length === 1) {
      owners[m.etapa][m.nombre] = String(hits[0].id);
      notas.push(`${m.nombre} → owner ${hits[0].id}`);
    } else {
      notas.push(`${m.nombre}: ${hits.length} coincidencias — s/d. Hardcodea el ID en config.js.`);
    }
  }
  return { owners, notas };
}

// ---- Search paginado ----
async function searchWKS(filters, properties) {
  const results = [];
  let after = undefined;
  do {
    const body = { filterGroups: [{ filters }], properties, limit: 200, ...(after ? { after } : {}) };
    const data = await hsPost(`/crm/v3/objects/${CFG.HS_WKS_OBJECT}/search`, body);
    results.push(...(data.results || []));
    after = data.paging?.next?.after;
  } while (after && results.length < 10000);
  return results;
}

// ---- helpers de evaluación ----
const poblado = (v) => v != null && String(v).trim() !== "" && String(v).trim() !== "--";
const esSi = (v) => poblado(v) && ["sí", "si", "yes", "true", "1"].includes(String(v).toLowerCase().trim());
// Sesiones puede ser número o multi-select ("a;b;c") → cuenta
function nSesiones(v) {
  if (!poblado(v)) return 0;
  const num = parseFloat(v);
  if (!isNaN(num) && /^\d+(\.\d+)?$/.test(String(v).trim())) return num;
  return String(v).split(";").filter((x) => x.trim()).length;
}

// ---- Condiciones de avance (cards del Overview) ----
function conexionLograda(p, pr) {
  return nSesiones(p[pr.sesiones]) >= 1 && (esSi(p[pr.wapi_connected]) || poblado(p[pr.tipo_conexion]));
}
function activacionLograda(p, pr) {
  return nSesiones(p[pr.sesiones]) >= 2 && poblado(p[pr.lead_agent]) &&
    (parseFloat(p[pr.plantillas]) > 0 || poblado(p[pr.calidad_plantillas]));
}
function adopcionLograda(p, pr) {
  return poblado(p[pr.health_score]) &&
    (poblado(p[pr.health_tier]) || (poblado(p[pr.estado_wapi]) && String(p[pr.estado_wapi]).toLowerCase().trim() !== "no conectado"));
}

const pct = (hits, n) => (n > 0 ? +((hits / n) * 100).toFixed(1) : null);

async function fetchHubSpot() {
  if (!PAT) return { error: "HUBSPOT_PAT no configurada" };

  const props = await discoverProps();
  const { owners, notas } = await resolveOwners();
  const out = { activacion: {}, adopcion: {}, health: {}, conexion_hs: {}, props_usadas: props, notas, error: null };

  // ================= COHORTE DEL MES (una sola búsqueda alimenta todo) =================
  const now = new Date();
  const mes = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const iniMes = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const planProp = props.plan_contratado || "fecha_plan_contratado";
  const ownerAdopProp = props.adoption_owner; // puede ser null si no se descubre

  const propsNecesarias = [
    planProp, "setuper_owner", ...(ownerAdopProp ? [ownerAdopProp] : []),
    props.sesiones, props.wapi_connected, props.tipo_conexion,
    props.lead_agent, props.plantillas, props.calidad_plantillas,
    props.usuarios_activos, props.health_score, props.health_tier, props.estado_wapi,
    props.subscription_status,
  ].filter(Boolean);

  const pipeFilter = CFG.HS_PIPELINES?.length
    ? [{ propertyName: "hs_pipeline", operator: "IN", values: CFG.HS_PIPELINES }]
    : [];

  let cohorte = await searchWKS(
    [...pipeFilter, { propertyName: planProp, operator: "GTE", value: String(iniMes) }],
    propsNecesarias
  ).catch(() => []);

  let notaFmt = "";
  if (!cohorte.length) {
    const hace90d = Date.now() - 90 * 86400000;
    const todos = await searchWKS(
      [...pipeFilter,
        { propertyName: planProp, operator: "HAS_PROPERTY" },
        { propertyName: "hs_lastmodifieddate", operator: "GTE", value: String(hace90d) }],
      propsNecesarias
    );
    cohorte = todos.filter((w) => {
      const v = w.properties[planProp];
      if (!v) return false;
      const d = /^\d+$/.test(String(v)) ? new Date(Number(v)) : new Date(String(v));
      return !isNaN(d) && d.getTime() >= iniMes;
    });
    notaFmt = " (filtro de fecha aplicado localmente)";
  }

  // ================= EMBUDO (condiciones de las cards, no stages) =================
  const nConex = cohorte.filter((w) => conexionLograda(w.properties, props)).length;
  const nActiv = cohorte.filter((w) => activacionLograda(w.properties, props)).length;
  const nAdop = cohorte.filter((w) => adopcionLograda(w.properties, props)).length;
  out.embudo = {
    mes,
    vendidos_hs: cohorte.length,
    etapas: [
      { label: "Conexión lograda", n: nConex },
      { label: "Activación lograda", n: nActiv },
      { label: "Adopción lograda (→ handoff)", n: nAdop },
    ],
    nota: `Cohorte: WKS con plan contratado en ${mes}${notaFmt}. Avance evaluado con las condiciones de las cards del Overview (no con etapas de pipeline, que están por cambiar).`,
  };

  // ================= TERMÓMETRO POR PERSONA (mismo cohorte del mes) =================
  const delMesDe = (ownerProp, ownerId) => cohorte.filter((w) => String(w.properties[ownerProp] || "") === String(ownerId));

  // Conexión (Zahid/Fer): % de SUS cuentas del mes con conexión lograda
  for (const [nombre, ownerId] of Object.entries(owners.conexion || {})) {
    if (!ownerId) { out.conexion_hs[nombre] = { valor: null, n: null }; continue; }
    const mias = delMesDe("setuper_owner", ownerId);
    out.conexion_hs[nombre] = { valor: pct(mias.filter((w) => conexionLograda(w.properties, props)).length, mias.length), n: mias.length };
  }

  // Activación (Manu/Eli): % de sus cuentas del mes con % usuarios activos >= 60
  for (const [nombre, ownerId] of Object.entries(owners.activacion)) {
    if (!ownerId || !props.usuarios_activos) { out.activacion[nombre] = { valor: null, n: null }; continue; }
    const mias = delMesDe("setuper_owner", ownerId);
    const conDato = mias.filter((w) => poblado(w.properties[props.usuarios_activos]));
    out.activacion[nombre] = {
      valor: pct(conDato.filter((w) => parseFloat(w.properties[props.usuarios_activos]) >= CFG.KPI_ACTIVACION_MIN).length, conDato.length),
      n: conDato.length, n_sin_dato: mias.length - conDato.length,
    };
  }

  // Adopción (Mar/Kari/Karla): % de sus cuentas del mes (adoption owner) con health >= 80
  for (const [nombre, ownerId] of Object.entries(owners.adopcion)) {
    if (!ownerId || !ownerAdopProp || !props.health_score) { out.adopcion[nombre] = { valor: null, n: null }; continue; }
    const mias = delMesDe(ownerAdopProp, ownerId);
    const conDato = mias.filter((w) => poblado(w.properties[props.health_score]));
    out.adopcion[nombre] = {
      valor: pct(conDato.filter((w) => parseFloat(w.properties[props.health_score]) >= CFG.KPI_ADOPCION_MIN).length, conDato.length),
      n: conDato.length, n_sin_dato: mias.length - conDato.length,
    };
  }

  // Health (Ana/Rich): % de su cartera (adoption owner hoy) con suscripción activa.
  // Nota: es STOCK (toda su cartera con plan), no cohorte del mes — el handoff no tiene fecha propia.
  for (const [nombre, ownerId] of Object.entries(owners.health)) {
    if (!ownerId || !ownerAdopProp || !props.subscription_status) { out.health[nombre] = { valor: null, n: null }; continue; }
    const filters = [
      ...pipeFilter,
      { propertyName: ownerAdopProp, operator: "EQ", value: ownerId },
      { propertyName: planProp, operator: "HAS_PROPERTY" },
    ];
    const wks = await searchWKS(filters, [props.subscription_status]);
    const conDato = wks.filter((w) => poblado(w.properties[props.subscription_status]));
    out.health[nombre] = {
      valor: pct(conDato.filter((w) => CFG.HS_SUB_ACTIVE_VALUES.includes(w.properties[props.subscription_status])).length, conDato.length),
      n: conDato.length, proxy: true,
    };
  }

  return out;
}

// ---- Diagnóstico: pipelines reales + propiedades de owner del WKS ----
async function debugEstructura() {
  const out = { pipelines: [], owner_properties: [], props_descubiertas: null, error: null };
  try {
    const pipes = await hsGet(`/crm/v3/pipelines/${CFG.HS_WKS_OBJECT}`);
    out.pipelines = (pipes.results || []).map((p) => ({
      id: p.id, label: p.label,
      etapas: (p.stages || []).sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0)).map((s) => ({ id: s.id, label: s.label })),
    }));
  } catch (e) { out.error = "pipelines: " + String(e.message || e); }
  try {
    const props = await hsGet(`/crm/v3/properties/${CFG.HS_WKS_OBJECT}`);
    out.owner_properties = (props.results || [])
      .filter((p) => (p.type === "enumeration" && p.referencedObjectType === "OWNER") || /owner/i.test(p.name) || /owner/i.test(p.label))
      .map((p) => ({ name: p.name, label: p.label }));
    out.props_descubiertas = await discoverProps();
  } catch (e) { out.error = (out.error ? out.error + " · " : "") + "props: " + String(e.message || e); }
  return out;
}

module.exports = { fetchHubSpot, debugEstructura };
