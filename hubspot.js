// ================================================================
// HubSpot fetcher (objeto WKS 2-31662723, pipeline Setups 3.0)
// - Descubre nombres internos de propiedades por LABEL (no adivina).
// - WKS activos = sin estado_del_setup y sin razon_del_setup_*.
// - Activación: % WKS activos con [% usuarios activos] >= 60.
// - Adopción:   % WKS activos con [Health Score] >= 80.
// - Health:     % WKS con plan contratado y suscripción activa
//               (PROXY de retención M2/M3 — no es cohorte real).
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

// ---- Discovery de propiedades por label ----
async function discoverProps() {
  const data = await hsGet(`/crm/v3/properties/${CFG.HS_WKS_OBJECT}`);
  const norm = (s) => (s || "").toLowerCase().replace(/[–—-]/g, "-").replace(/\s+/g, " ").trim();
  const found = {};
  for (const [key, labels] of Object.entries(CFG.HS_PROP_LABELS)) {
    if (CFG.HS_PROP_OVERRIDES[key]) { found[key] = CFG.HS_PROP_OVERRIDES[key]; continue; }
    const wanted = labels.map(norm);
    const match = data.results.find((p) => wanted.some((w) => norm(p.label) === w || norm(p.label).includes(w)));
    found[key] = match ? match.name : null;
  }
  return found;
}

// ---- Owners faltantes por nombre ----
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
      notas.push(`${m.nombre} → owner ${hits[0].id} (${hits[0].email || hits[0].firstName})`);
    } else {
      notas.push(`${m.nombre}: ${hits.length} coincidencias en owners — queda en s/d. Hardcodea el ID en config.js.`);
    }
  }
  return { owners, notas };
}

// ---- Search paginado de WKS ----
async function searchWKS(filters, properties) {
  const results = [];
  let after = undefined;
  do {
    const body = {
      filterGroups: [{ filters }],
      properties,
      limit: 200,
      ...(after ? { after } : {}),
    };
    const data = await hsPost(`/crm/v3/objects/${CFG.HS_WKS_OBJECT}/search`, body);
    results.push(...(data.results || []));
    after = data.paging?.next?.after;
  } while (after && results.length < 10000);
  return results;
}

const baseActiveFilters = (ownerId) => [
  { propertyName: "hs_pipeline", operator: "EQ", value: CFG.HS_PIPELINE },
  { propertyName: "setuper_owner", operator: "EQ", value: ownerId },
  { propertyName: "estado_del_setup", operator: "NOT_HAS_PROPERTY" },
  { propertyName: "razon_del_setup_ganado", operator: "NOT_HAS_PROPERTY" },
  { propertyName: "razon_del_setup_perdido", operator: "NOT_HAS_PROPERTY" },
];

function pct(hits, n) {
  return n > 0 ? +((hits / n) * 100).toFixed(1) : null;
}

async function fetchHubSpot() {
  if (!PAT) return { error: "HUBSPOT_PAT no configurada" };

  const props = await discoverProps();
  const { owners, notas } = await resolveOwners();
  const out = { activacion: {}, adopcion: {}, health: {}, props_usadas: props, notas, error: null };

  // ---- Activación: % usuarios activos >= 60 ----
  for (const [nombre, ownerId] of Object.entries(owners.activacion)) {
    if (!ownerId || !props.usuarios_activos) { out.activacion[nombre] = { valor: null, n: null }; continue; }
    const wks = await searchWKS(baseActiveFilters(ownerId), [props.usuarios_activos]);
    const conDato = wks.filter((w) => w.properties[props.usuarios_activos] != null && w.properties[props.usuarios_activos] !== "");
    const hits = conDato.filter((w) => parseFloat(w.properties[props.usuarios_activos]) >= CFG.KPI_ACTIVACION_MIN).length;
    out.activacion[nombre] = { valor: pct(hits, conDato.length), n: conDato.length, n_sin_dato: wks.length - conDato.length };
  }

  // ---- Adopción: health score >= 80 ----
  for (const [nombre, ownerId] of Object.entries(owners.adopcion)) {
    if (!ownerId || !props.health_score) { out.adopcion[nombre] = { valor: null, n: null }; continue; }
    const wks = await searchWKS(baseActiveFilters(ownerId), [props.health_score]);
    const conDato = wks.filter((w) => w.properties[props.health_score] != null && w.properties[props.health_score] !== "");
    const hits = conDato.filter((w) => parseFloat(w.properties[props.health_score]) >= CFG.KPI_ADOPCION_MIN).length;
    out.adopcion[nombre] = { valor: pct(hits, conDato.length), n: conDato.length, n_sin_dato: wks.length - conDato.length };
  }

  // ---- Health: PROXY — % con plan contratado y suscripción activa ----
  for (const [nombre, ownerId] of Object.entries(owners.health)) {
    if (!ownerId || !props.subscription_status || !props.plan_contratado) { out.health[nombre] = { valor: null, n: null }; continue; }
    const filters = [
      { propertyName: "hs_pipeline", operator: "EQ", value: CFG.HS_PIPELINE },
      { propertyName: "setuper_owner", operator: "EQ", value: ownerId },
      { propertyName: props.plan_contratado, operator: "HAS_PROPERTY" },
    ];
    const wks = await searchWKS(filters, [props.subscription_status]);
    const conDato = wks.filter((w) => w.properties[props.subscription_status]);
    const hits = conDato.filter((w) => CFG.HS_SUB_ACTIVE_VALUES.includes(w.properties[props.subscription_status])).length;
    out.health[nombre] = { valor: pct(hits, conDato.length), n: conDato.length, proxy: true };
  }

  return out;
}

module.exports = { fetchHubSpot };
