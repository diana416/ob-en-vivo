# OB en vivo — Leadsales

Tablero de Onboarding por etapa/persona/KPI. Refresh automático diario **9:00 CDMX**
+ botón manual. Fuentes: ChartMogul API + HubSpot API (objeto WKS).

## Deploy en Railway (10 min)

1. **Nuevo servicio**: Railway → New Project → "Deploy from GitHub repo"
   (sube esta carpeta a un repo) o "Empty Service" + conecta el código.
2. **Variables de entorno** (Settings → Variables):
   - `CHARTMOGUL_API_KEY` — la key NUEVA de ChartMogul (la anterior quedó
     expuesta y debe estar revocada).
   - `HUBSPOT_PAT` — el Private App Token de HubSpot.
   - `TZ` — `America/Mexico_City` (opcional; el cron ya usa esa zona).
3. **Deploy**. Railway detecta Node y corre `npm start`.
4. **Dominio**: Settings → Networking → Generate Domain. Esa URL se comparte
   a la empresa. (Opcional: dominio custom tipo ob.leadsalesapi.com.)

## Qué hace al arrancar

- Fetch inmediato de ambas fuentes (tarda 1–3 min si hay muchos clientes en CM,
  porque pagina `/customers` y `/activities`).
- Cron diario a las 9:00 CDMX.
- `POST /api/refresh` = refresh on-demand (el botón ↻ del dashboard).

## Configuración (src/config.js)

- Valores del atributo que cuentan como conexión exitosa
  (`CM_CONEXION_OK_VALUES`, hoy: Cloud_API, COEX).
- Umbrales de KPI (60% usuarios activos, 80 health score).
- Owner IDs de setupers. **Karla y Rich** se buscan por nombre en
  `/crm/v3/owners`; si hay 0 o >1 coincidencias quedan en s/d —
  hardcodea sus IDs en `HS_OWNERS` en cuanto los tengas.
- Metas por persona: en `public/index.html`, bloque `METAS` al inicio
  del script (sin meta → semáforo gris).

## ⚠️ Checklist de validación ANTES de compartir la URL

1. **Cohortes CM**: abre la tabla de validación (abajo del dashboard) y
   compárala contra el UI de ChartMogul (Cohorts → Customer Retention,
   monthly). Control conocido: **Jul 2025 = 224 clientes, M1 84.38%,
   M2 78.13%**. Si no cuadra al decimal, NO publiques: la lógica de
   churn/reactivación necesita ajuste.
2. **Conexión**: cruza el % del banner contra el segmento
   Conexion_Exitosa_OB en el UI de CM.
3. **HubSpot**: revisa en la tabla de validación qué propiedades internas
   descubrió (`props_usadas`) y que las n por setuper coincidan con las
   vistas de WKS en HubSpot.
4. **Health es proxy**: % de WKS con plan y suscripción activa — NO es
   retención por cohorte M2/M3 real. Está etiquetado así en el dashboard.

## Seguridad

- Credenciales SOLO en variables de entorno de Railway. Nunca en el código,
  nunca en el frontend (el navegador solo ve /api/data ya procesado).
- El PAT de HubSpot da acceso amplio al CRM: no compartas acceso al
  proyecto de Railway más allá de quien lo administre.
