# Tablero de agendas + control de carga — Founders

Dos cosas en un mismo sitio de Netlify:
1. **Tablero** (`public/index.html`): embudo del pipeline Agendas por canal, con nombres, y las alertas abiertas.
2. **Control automático** (`netlify/functions/control.mjs`): cada 30 min, de 9 a 20:30 (lun a sáb), cruza GHL con las citas de cada closer (calendario de GHL), #reporte-diario-comercial y #altas-pagos-clientes. Avisa por DM a cada closer lo suyo y a #admin-ops lo de operaciones. A las 21:00 manda el resumen del día a #admin-ops.

## Reglas
A reporte sin oportunidad · B etapa distinta a la del reporte · C alta sin Venta/Seña · D cita pasada sin asistencia · E oportunidad duplicada · F asistencia sin Estado post llamada · G reporte incompleto o Estado fuera de lista · H cita sin reporte · I agenda trabada +48 h (solo en el tablero, sin DM).

Claude revisa cada alerta nueva antes de mandarla. Si la marca como dudosa o falso positivo, no va al closer: va a #admin-ops para que alguien la mire. También lee los mensajes de #altas-pagos-clientes que no traen email.

## Variables de entorno (las 4 claves)
Son las claves secretas que el código necesita para entrar a GHL, Slack y Claude. No van en el código: se cargan en Netlify → tu sitio → **Site configuration → Environment variables → Add a variable**. En cada una ponés el nombre (tal cual, en mayúsculas) y pegás el valor.

| Nombre | De dónde sale |
|---|---|
| `GHL_TOKEN` | GHL → Configuración → Integraciones privadas → Crear. Permisos: View Opportunities, View Contacts y View Calendar Events. |
| `DASH_KEY` | La inventás vos (ej. `founders2026`). Es la clave que se pone una vez para entrar al tablero. |
| `SLACK_BOT_TOKEN` | El token `xoxb-…` de la app de Slack (pasos abajo). |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys → Create Key. |

Los closers (Braian, Kevin, Fabri, Vicky) ya están cargados en `netlify/lib/config.mjs` con sus IDs de GHL y de Slack. Las citas salen del calendario de GHL, así que no hace falta Google.

## Slack
1. api.slack.com/apps → Create New App → From scratch → workspace de Founders.
2. OAuth & Permissions → Bot Token Scopes: `channels:history`, `groups:history`, `chat:write`, `im:write`.
3. Install to Workspace → copiá el Bot User OAuth Token (`xoxb-…`) en `SLACK_BOT_TOKEN`.
4. En Slack, invitá el bot a #reporte-diario-comercial, #altas-pagos-clientes y #admin-ops (`/invite @nombre-del-bot`).

## Publicar
Repo de GitHub → Netlify → Import from Git → cargar variables → Deploy. Netlify instala `@netlify/blobs` solo (está en `package.json`). Las funciones programadas corren únicamente en el deploy de producción.

Para probar sin esperar: en el tablero, botón **Revisar ahora** (corre el control en el momento; si tarda, Claude revisa en la corrida siguiente).

## Formato del reporte de los closers
```
Tipo de llamada: Llamada de venta WEBINAR
Closer: Braian
Fecha y hora: 20/10 18:00
Nombre del lead: Daniel Coronel
Email o teléfono: coronel.daniel@gmail.com
Asistió: Sí
Estado: Calificado sin dinero
Monto y forma de pago: —
Resumen de la llamada: …
Oferta: no hubo
Próximos pasos: …
```
Estados válidos: Venta · Seña · Calificado en seguimiento · Calificado sin dinero · Calificado no interesado · No cualificado · No asistió. La tabla Estado → etapa está en `netlify/lib/config.mjs`.
