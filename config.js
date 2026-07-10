// ================================================================
// CONFIG — todo lo ajustable vive aquí. NO pongas credenciales:
// esas van en variables de entorno de Railway.
//
// PARA EDITAR OBJETIVOS: GitHub → config.js → icono de lápiz →
// cambia los números → Commit changes. Railway se actualiza solo
// en ~1 minuto.
// ================================================================
module.exports = {
  // ================================================
  // OBJETIVOS (lo que pidió David: objetivo vs real)
  // null = sin objetivo definido → se muestra "obj s/d"
  // Todos en % (ej. 90 significa 90%)
  // ================================================
  METAS: {
    // --- Embudo del mes (modelo cascada, Opción A — confirmado jul 2026) ---
    // Base = clientes NUEVOS del mes en ChartMogul, SOLO WAPI (ver CM_WAPI_PLANS).
    // Cada etapa se mide contra lo que REALMENTE recibió de la anterior.
    embudo: {
      vendidos_mes: 140,  // objetivo de ventas del mes (solo referencia visual;
                          // la base del embudo son los cierres REALES, no este número)
      cascada: 90,        // cada etapa debe retener ≥90% de lo que le entregó la anterior
      global_target: 66,  // % de cierres del mes que deben llegar a Health (0.9^4 ≈ 66%)
    },
    // --- Cabecera company-level ---
    outcomes: {
      m1: null,        // Retención M1 objetivo, ej. 90
      m2: null,        // Retención M2 objetivo, ej. 80
      m3: null,        // Retención M3 objetivo, ej. 75
      conexion: null,  // Conexión estable objetivo, ej. 85
    },
    // --- KPI de cada etapa (aplica a todas sus personas) ---
    // Mismo estándar que la cascada: cada persona debe lograr ≥90% de SU base recibida.
    etapas: {
      conexion: 90,   // % del cohorte con conexión estable
      activacion: 90, // % de cuentas con equipo activo
      adopcion: 90,   // % de cuentas sanas al día 31
      health: 90,     // % de cuentas retenidas post-handoff
    },
    // --- Overrides por persona (opcional; si está vacío usa el de su etapa) ---
    personas: {
      // ej.  Kari: 85,
    },
  },

  // ---- Cron: hora de refresh diario (CDMX) ----
  CRON_EXPR: "0 9 * * *",            // 9:00 am todos los días
  TZ: "America/Mexico_City",

  // ---- ChartMogul ----
  CM_BASE: "https://api.chartmogul.com/v1",
  CM_CONEXION_ATTR: "Conexion_Exitosa_OB_M",
  CM_CONEXION_OK_VALUES: ["Cloud_API", "COEX"],
  CM_CONEXION_MIN_DIAS: 14,
  CM_COHORT_MONTHS: 12,
  // Planes que cuentan como WAPI para la base del embudo (New Business).
  // Confirmado por Diana (jul 2026): solo Professional y Advanced.
  CM_WAPI_PLANS: ["Professional", "Advanced"],

  // ---- HubSpot ----
  HS_BASE: "https://api.hubapi.com",
  HS_WKS_OBJECT: "2-31662723",
  // Pipelines a considerar. Cuando la reestructura por especialización
  // esté viva, /api/debug lista los nuevos IDs — se agregan aquí.
  HS_PIPELINES: ["127077535"],
  HS_OWNERS: {
    conexion: { Zahid: "1283824961", Fer: "1947374481" },
    activacion: { Manu: "80424381", Eli: "1177408266" },
    adopcion: { Mar: "529758793", Kari: "723729026", Karla: null },
    health: { Ana: "529786548", Rich: null },
  },
  HS_OWNER_LOOKUP: { Karla: "karla.camarillo@leadsales.io", Rich: "ricardo.garcia@leadsales.io" },
  HS_PROP_LABELS: {
    // — cards del Overview (hilo requests-ob) —
    sesiones: ["Sesiones OB asistidas", "Sesiones OB"],
    wapi_connected: ["WAPI connected"],
    tipo_conexion: ["Tipo de conexión WAPI", "Tipo de conexion WAPI", "Tipo conexión"],
    lead_agent: ["Lead Agent"],
    plantillas: ["Plantillas creadas"],
    calidad_plantillas: ["Calidad de plantillas", "Calidad plantillas"],
    estado_wapi: ["WAPI - Estado", "WAPI – Estado", "WAPI Estado"],
    health_tier: ["WAPI - Health Tier", "WAPI – Health Tier", "WAPI Health Tier"],
    adoption_owner: ["Adoption Owner"],
    usuarios_activos: ["% usuarios activos"],
    health_score: ["WAPI - Health Score", "WAPI – Health Score", "WAPI Health Score"],
    subscription_status: ["Subscription Status"],
    plan_contratado: ["fecha_plan_contratado"],
  },
  HS_PROP_OVERRIDES: {
    plan_contratado: "fecha_plan_contratado",
  },
  KPI_ACTIVACION_MIN: 60,
  KPI_ADOPCION_MIN: 80,
  HS_SUB_ACTIVE_VALUES: ["ACTIVE", "active", "PAUSED", "paused", "PAST_DUE", "past_due"],
};
