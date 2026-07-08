// ================================================================
// OB en vivo — server (estructura plana: todos los archivos en raíz)
// - Fetch al arrancar + cron diario 9:00 CDMX + POST /api/refresh
// - Sirve el dashboard (index.html) y /api/data (incluye METAS)
// - Si una fuente falla, conserva el último dato bueno y lo marca.
// ================================================================
const express = require("express");
const cron = require("node-cron");
const path = require("path");
const CFG = require("./config");
const { fetchChartMogul } = require("./chartmogul");
const { fetchHubSpot } = require("./hubspot");

const app = express();
const PORT = process.env.PORT || 3000;

let state = {
  actualizado: null,
  chartmogul: { data: null, actualizado: null, error: null },
  hubspot: { data: null, actualizado: null, error: null },
  refrescando: false,
};

async function refresh(origen = "cron") {
  if (state.refrescando) return;
  state.refrescando = true;
  console.log(`[refresh] inicio (${origen}) ${new Date().toISOString()}`);
  const ts = new Date().toISOString();

  try {
    const cm = await fetchChartMogul();
    if (cm.error) state.chartmogul.error = cm.error;
    else state.chartmogul = { data: cm, actualizado: ts, error: null };
  } catch (e) {
    state.chartmogul.error = String(e.message || e);
    console.error("[refresh] ChartMogul falló:", e.message);
  }

  try {
    const hs = await fetchHubSpot();
    if (hs.error) state.hubspot.error = hs.error;
    else state.hubspot = { data: hs, actualizado: ts, error: null };
  } catch (e) {
    state.hubspot.error = String(e.message || e);
    console.error("[refresh] HubSpot falló:", e.message);
  }

  state.actualizado = ts;
  state.refrescando = false;
  console.log(`[refresh] fin ${new Date().toISOString()}`);
}

// Solo servimos el dashboard — no exponemos el resto de archivos del repo
app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "index.html")));

app.get("/api/data", (_req, res) => res.json({ ...state, metas: CFG.METAS }));

app.post("/api/refresh", async (_req, res) => {
  if (state.refrescando) return res.status(409).json({ ok: false, msg: "Refresh en curso" });
  refresh("manual");
  res.json({ ok: true });
});

app.get("/health", (_req, res) => res.json({ ok: true }));

// Diagnóstico: estructura real de pipelines y propiedades de owner del WKS
app.get("/api/debug", async (_req, res) => {
  try {
    const { debugEstructura } = require("./hubspot");
    res.json(await debugEstructura());
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

cron.schedule(CFG.CRON_EXPR, () => refresh("cron"), { timezone: CFG.TZ });

app.listen(PORT, () => {
  console.log(`OB en vivo escuchando en :${PORT} — cron ${CFG.CRON_EXPR} ${CFG.TZ}`);
  refresh("boot");
});
