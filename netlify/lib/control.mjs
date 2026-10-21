import {
  CAMPO_ESTADO_POST, CLOSERS, CRM, LOCATION, SLACK_ALTAS, SLACK_OPS, SLACK_REPORTES,
  ESTADOS, ETAPAS, ETAPAS_ASISTENCIA, ETAPAS_PRE_LLAMADA, REGLAS,
} from './config.mjs';
import { claude, ghl, slack } from './fuentes.mjs';

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9@.+ ]/g, ' ').replace(/\s+/g, ' ').trim();
const soloDigitos = (s) => String(s || '').replace(/\D/g, '').slice(-10);
const isoAR = (d) => new Date(d.getTime() - 3 * 3600e3).toISOString().slice(0, 19) + '-03:00';
const link = (contactId) => contactId ? `${CRM}/v2/location/${LOCATION}/contacts/detail/${contactId}` : '';

// ---------- lectura del reporte de Slack ----------
const ETIQUETAS = {
  'tipo de llamada': 'tipo', 'closer': 'closer', 'fecha y hora': 'fecha', 'nombre del lead': 'nombre',
  'email o telefono': 'contacto', 'email': 'contacto', 'telefono': 'contacto', 'asistio': 'asistio',
  'resumen de la llamada': 'resumen', 'oferta': 'oferta', 'estado': 'estado',
  'monto y forma de pago': 'monto', 'proximos pasos': 'proximos',
};
export function leerReporte(texto) {
  const r = {}; let actual = null;
  for (const linea of String(texto).split('\n')) {
    const m = linea.match(/^\s*\*?([^:*]{3,30})\*?\s*:\s*(.*)$/);
    const k = m && ETIQUETAS[norm(m[1])];
    if (k) { actual = k; r[k] = m[2].trim(); }
    else if (actual === 'resumen') r.resumen += '\n' + linea;
  }
  return r.nombre ? r : null;
}

export async function correrControl({ env, store, f = fetch, ahora = new Date(), presupuestoMs = 24000 }) {
  const t0 = Date.now();
  const quedaTiempo = (ms) => Date.now() - t0 < presupuestoMs - ms;
  const closers = env.CLOSERS ? JSON.parse(env.CLOSERS) : CLOSERS;
  const opsCanal = env.SLACK_OPS || SLACK_OPS;
  const G = ghl(env, f), S = env.SLACK_BOT_TOKEN ? slack(env, f) : null;
  const IA = claude(env, f);
  const fuentes = { ghl: 'ok', calendario: 'ok', slack: S ? 'ok' : 'sin configurar', claude: IA ? 'ok' : 'sin configurar' };

  // ---- GHL ----
  const etapas = await G.etapas();
  const nombreEtapa = Object.fromEntries(etapas.map((e) => [e.id, e.nombre]));
  const desde = new Date(ahora.getTime() - 21 * 864e5);
  const ops = (await G.oportunidades(isoAR(desde), isoAR(ahora))).filter((o) => o.status === 'open' || o.status === 'won');
  const porContacto = new Map();
  const porEmail = new Map(), porTel = new Map(), porNombre = new Map();
  for (const o of ops) {
    const c = o.contact || {};
    const arr = porContacto.get(o.contactId) || []; arr.push(o); porContacto.set(o.contactId, arr);
    if (c.email) porEmail.set(norm(c.email), o.contactId);
    if (c.phone) porTel.set(soloDigitos(c.phone), o.contactId);
    const n = norm(o.name || c.name); if (n) porNombre.set(n, [...(porNombre.get(n) || []), o.contactId]);
  }
  // oportunidad "principal" de un contacto: la más avanzada / más reciente
  const principal = (cid) => (porContacto.get(cid) || []).slice().sort((a, b) => (b.lastStageChangeAt || '').localeCompare(a.lastStageChangeAt || ''))[0];
  const buscar = ({ contacto, nombre }) => {
    const v = String(contacto || '');
    const em = v.match(/[^\s<>|]+@[^\s<>|]+\.[a-z]{2,}/i);
    if (em && porEmail.has(norm(em[0]))) return porEmail.get(norm(em[0]));
    const tel = soloDigitos(v); if (tel.length >= 8 && porTel.has(tel)) return porTel.get(tel);
    const n = norm(nombre); if (!n) return null;
    if (porNombre.has(n) && porNombre.get(n).length === 1) return porNombre.get(n)[0];
    const tokens = n.split(' ').filter((t) => t.length > 2);
    const cands = [...porNombre.entries()].filter(([k]) => tokens.length > 1 && tokens.every((t) => k.includes(t)));
    return cands.length === 1 && cands[0][1].length === 1 ? cands[0][1][0] : null;
  };
  const closerDe = (nombre) => closers.find((c) => norm(c.nombre) === norm(nombre)) || null;
  const closerPorSlack = (uid) => closers.find((c) => c.slack === uid) || null;

  const alertas = [];
  const agregar = (a) => alertas.push({ ...a, id: `${a.regla}:${a.contactId || norm(a.lead)}`, link: link(a.contactId), titulo: REGLAS[a.regla] });

  // ---- E: duplicadas ----
  for (const [cid, arr] of porContacto) {
    const abiertas = arr.filter((o) => o.status === 'open');
    if (abiertas.length > 1) agregar({ regla: 'E', contactId: cid, lead: abiertas[0].name, responsable: 'Operaciones', detalle: `${abiertas.length} oportunidades abiertas: ${abiertas.map((o) => nombreEtapa[o.pipelineStageId] || 'etapa').join(' y ')}. Dejar una sola.` });
  }

  // ---- I: trabadas ----
  const trabadas = [ETAPAS.nuevoLead, ETAPAS.conversando, ETAPAS.confirmarNicho, ETAPAS.formEnviado];
  for (const o of ops) {
    if (o.status !== 'open' || !trabadas.includes(o.pipelineStageId)) continue;
    const h = (ahora - new Date(o.lastStageChangeAt || o.createdAt)) / 36e5;
    if (h > 48) agregar({ regla: 'I', contactId: o.contactId, lead: o.name, responsable: 'Setters', sinDM: true, detalle: `Hace ${Math.round(h / 24)} días en ${nombreEtapa[o.pipelineStageId]}.` });
  }

  // ---- Slack: reportes ----
  const reportes = [];
  if (S) {
    try {
      const msgs = await S.historial(env.SLACK_REPORTES || SLACK_REPORTES, Math.floor(ahora / 1000) - 72 * 3600);
      for (const m of msgs) {
        const r = leerReporte(m.text || ''); if (!r) continue;
        const closer = closerDe(r.closer) || closerPorSlack(m.user);
        reportes.push({ ...r, ts: m.ts, closer: closer ? closer.nombre : (r.closer || 'Sin closer'), closerSlack: closer && closer.slack, texto: (m.text || '').slice(0, 3000) });
      }
    } catch (e) { fuentes.slack = String(e.message || e); }
  }
  const reportadosCid = new Set();
  for (const r of reportes) {
    const faltan = [];
    if (!r.contacto || r.contacto === '—') faltan.push('email o teléfono');
    const est = ESTADOS[norm(r.estado)];
    if (!est) faltan.push(`Estado "${r.estado || 'vacío'}" fuera de la lista`);
    if (est && (norm(r.estado) === 'venta' || norm(r.estado) === 'sena') && (!r.monto || r.monto === '—')) faltan.push('monto y forma de pago');
    const cid = buscar(r);
    r.contactId = cid; r.ok = true;
    if (faltan.length) { r.ok = false; agregar({ regla: 'G', contactId: cid, lead: r.nombre, responsable: r.closer, slack: r.closerSlack, detalle: `Falta: ${faltan.join(', ')}.`, reporte: r.texto }); }
    if (!cid) { r.ok = false; agregar({ regla: 'A', lead: r.nombre, responsable: r.closer, slack: r.closerSlack, detalle: 'No encontré su oportunidad en Agendas (ni por email/teléfono ni por nombre).', reporte: r.texto }); continue; }
    reportadosCid.add(cid);
    const op = principal(cid);
    if (est && op && !est.etapas.includes(op.pipelineStageId)) {
      r.ok = false;
      agregar({ regla: 'B', contactId: cid, lead: r.nombre, responsable: r.closer, slack: r.closerSlack, detalle: `Está en "${nombreEtapa[op.pipelineStageId]}"; según el reporte (${r.estado}) debería estar en "${est.etapas.map((e) => nombreEtapa[e]).join('" o "')}".`, reporte: r.texto });
    }
  }

  // ---- Calendario de GHL (citas de cada closer): D y H ----
  for (const c of closers.filter((x) => x.ghlUser)) {
    if (!quedaTiempo(8000)) break;
    try {
      const citas = await G.citas(c.ghlUser, ahora - 3 * 864e5, ahora.getTime());
      for (const ev of citas) {
        const fin = new Date(ev.endTime || ev.startTime);
        const horas = (ahora - fin) / 36e5;
        if (horas < 2 || !ev.contactId) continue;
        const cid = ev.contactId;
        const op = principal(cid);
        if (!op) continue; // cita de alguien que no está en Agendas (onboarding, interna, etc.)
        const cuando = fin.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
        if (ETAPAS_PRE_LLAMADA.includes(op.pipelineStageId)) {
          agregar({ regla: 'D', contactId: cid, lead: op.name, responsable: c.nombre, slack: c.slack, detalle: `Cita del ${cuando}, sigue en "${nombreEtapa[op.pipelineStageId]}". Cargar asistencia o "No asistió".` });
        }
        if (S && horas > 4 && !reportadosCid.has(cid) && op.pipelineStageId !== ETAPAS.noAsistio) {
          agregar({ regla: 'H', contactId: cid, lead: op.name, responsable: c.nombre, slack: c.slack, detalle: `Cita del ${cuando} sin reporte en #reporte-diario-comercial.` });
        }
      }
    } catch (e) { fuentes.calendario = String(e.message || e); }
  }

  // ---- F: asistencias sin Estado post llamada ----
  const asist = ops.filter((o) => ETAPAS_ASISTENCIA.includes(o.pipelineStageId) && ahora - new Date(o.lastStageChangeAt) < 7 * 864e5).slice(0, 25);
  if (quedaTiempo(9000)) {
    const contactos = await Promise.all(asist.map((o) => G.contacto(o.contactId).catch(() => null)));
    contactos.forEach((c, i) => {
      if (!c) return;
      const campo = (c.customFields || []).find((x) => x.id === CAMPO_ESTADO_POST);
      if (!campo || !campo.value) {
        const cl = closers.find((x) => x.ghlUser && x.ghlUser === asist[i].assignedTo);
        agregar({ regla: 'F', contactId: asist[i].contactId, lead: asist[i].name, responsable: cl ? cl.nombre : 'Closer', slack: cl && cl.slack, detalle: `En "${nombreEtapa[asist[i].pipelineStageId]}" sin Estado post llamada cargado.` });
      }
    });
  }

  // ---- C: altas sin Venta/Seña (necesita Claude para leer el mensaje) ----
  if (S && quedaTiempo(9000)) {
    try {
      const msgs = await S.historial(env.SLACK_ALTAS || SLACK_ALTAS, Math.floor(ahora / 1000) - 72 * 3600);
      const cache = (await store.get('altas', { type: 'json' })) || {};
      for (const m of msgs) {
        if (!cache[m.ts]) {
          const email = (m.text || '').match(/[^\s<>|]+@[^\s<>|]+\.[a-z]{2,}/i);
          if (email) cache[m.ts] = { nombre: '', contacto: email[0] };
          else if (IA && quedaTiempo(10000)) {
            try {
              cache[m.ts] = await IA.json('Extraés datos de mensajes de altas de clientes. Respondé solo JSON: {"nombre": string|null, "contacto": string|null, "es_alta": boolean}. es_alta es true solo si el mensaje informa una venta, seña o pago de un cliente.', m.text || '', 200);
            } catch { continue; }
          } else continue;
        }
        const x = cache[m.ts];
        if (x.es_alta === false) continue;
        const cid = buscar(x); if (!cid) continue;
        const op = principal(cid);
        if (op && ![ETAPAS.venta, ETAPAS.sena].includes(op.pipelineStageId)) {
          agregar({ regla: 'C', contactId: cid, lead: op.name, responsable: 'Operaciones', detalle: `Figura en #altas-pagos-clientes y en Agendas está en "${nombreEtapa[op.pipelineStageId]}".` });
        }
      }
      await store.setJSON('altas', cache);
    } catch (e) { fuentes.slack = String(e.message || e); }
  }

  // ---- comparar con la corrida anterior ----
  const unicas = [...new Map(alertas.map((a) => [a.id, a])).values()];
  const previo = (await store.get('estado', { type: 'json' })) || { alertas: [] };
  const prevMap = new Map(previo.alertas.map((a) => [a.id, a]));
  for (const a of unicas) {
    const p = prevMap.get(a.id);
    a.desde = p ? p.desde : ahora.toISOString();
    a.notificada = p ? p.notificada : false;
    a.revision = p && p.detalle === a.detalle ? p.revision : null;
  }
  const resueltas = previo.alertas.filter((a) => !unicas.some((u) => u.id === a.id)).length;

  // ---- Claude revisa las alertas nuevas (por las dudas) ----
  if (IA) {
    const pendientes = unicas.filter((a) => !a.revision && a.regla !== 'I').slice(0, 6);
    if (pendientes.length && quedaTiempo(12000)) {
      const sistema = 'Sos auditor del CRM comercial de Founders (GoHighLevel). Te paso una alerta generada por reglas automáticas, con el reporte del closer si existe, y nombres de leads parecidos. Decidí si la alerta es real. Respondé solo JSON: {"veredicto": "real" | "dudosa" | "falso_positivo", "explicacion": string (una oración), "arreglo": string (qué hay que tocar en GHL, una oración)}. Si el nombre del reporte parece un typo de un lead existente, decilo en arreglo.';
      await Promise.all(pendientes.map(async (a) => {
        const parecidos = [...porNombre.keys()].filter((k) => norm(a.lead).split(' ').some((t) => t.length > 3 && k.includes(t))).slice(0, 8);
        try {
          a.revision = await IA.json(sistema, JSON.stringify({ alerta: { regla: a.titulo, lead: a.lead, detalle: a.detalle }, reporte: a.reporte || null, leads_parecidos: parecidos }), 300);
        } catch { a.revision = null; }
      }));
    }
  }

  // ---- avisar por Slack las nuevas ----
  if (S) {
    const nuevas = unicas.filter((a) => !a.notificada && !a.sinDM);
    const grupos = {};
    for (const a of nuevas) {
      const dudosa = a.revision && a.revision.veredicto !== 'real';
      const destino = !dudosa && a.slack ? a.slack : opsCanal;
      (grupos[destino] = grupos[destino] || []).push(a);
    }
    for (const [destino, lista] of Object.entries(grupos)) {
      const lineas = lista.map((a) => {
        const rev = a.revision ? `\n   _${a.revision.veredicto === 'real' ? 'Arreglo' : 'Revisar: ' + a.revision.explicacion}_ ${a.revision.arreglo || ''}` : '';
        return `• *${a.lead}* · ${a.regla} · ${a.detalle}${a.link ? ` <${a.link}|Abrir en GHL>` : ''}${rev}`;
      });
      try {
        await S.enviar(destino, `Control de carga GHL: ${lista.length} ${lista.length === 1 ? 'cosa para corregir' : 'cosas para corregir'}\n${lineas.join('\n')}`);
        lista.forEach((a) => { a.notificada = true; });
      } catch (e) { fuentes.slack = String(e.message || e); }
    }
  }

  const estado = {
    corrida: ahora.toISOString(), duracionMs: Date.now() - t0, fuentes, resueltas,
    reportes: reportes.map((r) => ({ closer: r.closer, lead: r.nombre, ok: r.ok, ts: r.ts })),
    alertas: unicas.map(({ reporte, ...a }) => a),
  };
  await store.setJSON('estado', estado);
  return estado;
}

export async function resumenDiario({ env, store, f = fetch, ahora = new Date() }) {
  const estado = (await store.get('estado', { type: 'json' })) || null;
  if (!estado || !env.SLACK_BOT_TOKEN) return null;
  const hoy = new Date(ahora - 3 * 3600e3).toISOString().slice(0, 10);
  const deHoy = estado.reportes.filter((r) => new Date(Number(r.ts) * 1000 - 3 * 3600e3).toISOString().slice(0, 10) === hoy);
  const porCloser = {};
  deHoy.forEach((r) => { const c = (porCloser[r.closer] = porCloser[r.closer] || { tot: 0, ok: 0 }); c.tot++; if (r.ok) c.ok++; });
  const okTot = deHoy.filter((r) => r.ok).length;
  const porRegla = {};
  estado.alertas.forEach((a) => { porRegla[a.regla] = (porRegla[a.regla] || 0) + 1; });
  const lineas = [
    `*Control de carga GHL · cierre del día*`,
    `${deHoy.length} llamadas reportadas hoy · ${okTot} bien cargadas (${deHoy.length ? Math.round((okTot / deHoy.length) * 100) : 0}%) · ${estado.alertas.length} alertas abiertas · ${estado.resueltas} resueltas en la última corrida`,
    ...Object.entries(porCloser).map(([c, v]) => `• ${c}: ${v.ok}/${v.tot} bien cargadas`),
    Object.keys(porRegla).length ? `Abiertas por regla: ${Object.entries(porRegla).map(([r, n]) => `${r} ${n}`).join(' · ')}` : 'Sin alertas abiertas.',
    `Fuentes: ${Object.entries(estado.fuentes).map(([k, v]) => `${k} ${v}`).join(' · ')}`,
  ];
  await slack(env, f).enviar(env.SLACK_OPS || SLACK_OPS, lineas.join('\n'));
  return lineas;
}
