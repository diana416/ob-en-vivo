// ================================================================
// OB en vivo — server
// - Fetch al arrancar + cron diario 9:00 CDMX + POST /api/refresh
// - Sirve el dashboard estático (public/) y /api/data
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
  actualizado: null,          // timestamp del último refresh exitoso (por fuente)
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

app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/api/data", (_req, res) => res.json(state));

app.post("/api/refresh", async (_req, res) => {
  if (state.refrescando) return res.status(409).json({ ok: false, msg: "Refresh en curso" });
  refresh("manual"); // no await: responde ya, el front hace polling
  res.json({ ok: true });
});

app.get("/health", (_req, res) => res.json({ ok: true }));

cron.schedule(CFG.CRON_EXPR, () => refresh("cron"), { timezone: CFG.TZ });

app.listen(PORT, () => {
  console.log(`OB en vivo escuchando en :${PORT} — cron ${CFG.CRON_EXPR} ${CFG.TZ}`);
  refresh("boot");
});
