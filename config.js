// ================================================================
// CONFIG — todo lo ajustable vive aquí. NO pongas credenciales:
// esas van en variables de entorno de Railway.
// ================================================================
module.exports = {
  // ---- Cron: hora de refresh diario (CDMX) ----
  CRON_EXPR: "0 9 * * *",            // 9:00 am todos los días
  TZ: "America/Mexico_City",

  // ---- ChartMogul ----
  CM_BASE: "https://api.chartmogul.com/v1",
  // Atributo custom que define el segmento de conexión exitosa
  CM_CONEXION_ATTR: "Conexion_Exitosa_OB_M",
  // Valores del atributo que cuentan como "conexión exitosa".
  // Vacío / null / "No_Exitosa" NO cuentan.
  CM_CONEXION_OK_VALUES: ["Cloud_API", "COEX"],
  // Días mínimos transcurridos para que un cohorte cuente en el KPI de Conexión
  CM_CONEXION_MIN_DIAS: 14,
  // Cuántos meses de cohortes calcular para la cabecera (M1/M2/M3)
  CM_COHORT_MONTHS: 12,

  // ---- HubSpot ----
  HS_BASE: "https://api.hubapi.com",
  HS_WKS_OBJECT: "2-31662723",
  HS_PIPELINE: "127077535",
  // Owners conocidos (setuper_owner). Karla y Rich se buscan por nombre
  // en /crm/v3/owners si no están aquí; si los consigues, hardcodéalos.
  HS_OWNERS: {
    activacion: { Manu: "80424381", Eli: "1177408266" },
    adopcion: { Mar: "529758793", Kari: "723729026", Karla: null },
    health: { Ana: "529786548", Rich: null },
  },
  // Nombres para búsqueda en /crm/v3/owners cuando el ID es null
  HS_OWNER_LOOKUP: { Karla: "Karla", Rich: "Ricardo" },
  // Labels (como se ven en el UI) de las propiedades del WKS.
  // El código descubre el nombre interno buscando estos labels en
  // /crm/v3/properties — NUNCA adivina nombres internos.
  HS_PROP_LABELS: {
    usuarios_activos: ["% usuarios activos"],
    health_score: ["WAPI - Health Score", "WAPI – Health Score", "WAPI Health Score"],
    subscription_status: ["Subscription Status"],
    plan_contratado: ["fecha_plan_contratado"], // este sí es nombre interno conocido
  },
  // Overrides directos (si ya conoces el nombre interno, ponlo aquí y
  // te saltas el discovery): ej. usuarios_activos: "porcentaje_usuarios_activos"
  HS_PROP_OVERRIDES: {
    plan_contratado: "fecha_plan_contratado",
  },
  // Umbrales de KPI
  KPI_ACTIVACION_MIN: 60, // % usuarios activos >= 60 → equipo activo
  KPI_ADOPCION_MIN: 80,   // health score >= 80 → cuenta sana
  // Estatus de suscripción que cuentan como retenido (Health)
  HS_SUB_ACTIVE_VALUES: ["ACTIVE", "active", "PAUSED", "paused", "PAST_DUE", "past_due"],
};
