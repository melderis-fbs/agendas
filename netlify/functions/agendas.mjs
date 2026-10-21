// Lee el pipeline "Agendas" de GHL y devuelve solo lo que el tablero necesita.
// Variables de entorno en Netlify: GHL_TOKEN (Private Integration, scope opportunities.readonly)
// y DASH_KEY (clave que Vicky carga una vez en el tablero).
import { CLOSERS } from '../lib/config.mjs';
import { ghl } from '../lib/fuentes.mjs';

const API = 'https://services.leadconnectorhq.com';
const LOCATION = 'x7nYndpXUc1dmpunATsZ';
const PIPELINE = 'Hdnl2Kgw5kRk1rCNrwYW'; // Agendas
const CAMPO_FUENTE = 'AYMUH5mbdgrzUp754A6z'; // Fuente (oportunidad)

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

const canalDe = (op) => {
  const f = (op.customFields || []).find((c) => c.id === CAMPO_FUENTE);
  const v = f && (f.fieldValueString || f.value);
  if (v) return v === 'ADS VSL' ? 'VSL / Anuncios' : v === 'BIO IG' ? 'Bio IG' : v;
  const tags = (op.contact && op.contact.tags) || [];
  if (tags.some((t) => t === 'agenda-webinar' || t === 'agenda_landing_webinar' || t.startsWith('webina'))) return 'Masterclass';
  if (tags.includes('agenda_vsl_bio')) return 'Bio IG';
  if (tags.includes('agenda_vsl')) return 'VSL / Anuncios';
  if (tags.some((t) => t.startsWith('repesca'))) return 'Repesca';
  return 'Sin fuente';
};

export default async (req) => {
  if (!process.env.GHL_TOKEN) return json({ error: 'Falta GHL_TOKEN en Netlify' }, 500);
  if (process.env.DASH_KEY && req.headers.get('x-dash-key') !== process.env.DASH_KEY) {
    return json({ error: 'Clave incorrecta' }, 401);
  }
  const url = new URL(req.url);
  const desde = url.searchParams.get('desde');
  const hasta = url.searchParams.get('hasta');
  const fecha = /^\d{4}-\d{2}-\d{2}$/;
  if (!fecha.test(desde || '') || !fecha.test(hasta || '')) return json({ error: 'Fechas inválidas' }, 400);

  const headers = {
    Authorization: `Bearer ${process.env.GHL_TOKEN}`,
    Version: '2021-07-28',
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };

  try {
    const pr = await fetch(`${API}/opportunities/pipelines?locationId=${LOCATION}`, { headers });
    if (!pr.ok) return json({ error: `GHL pipelines respondió ${pr.status}` }, 502);
    const pipes = (await pr.json()).pipelines || [];
    const pipe = pipes.find((p) => p.id === PIPELINE);
    const etapas = pipe ? pipe.stages.map((s) => ({ id: s.id, nombre: s.name, pos: s.position })) : [];

    const filtros = [
      { field: 'pipeline_id', operator: 'eq', value: PIPELINE },
      { field: 'date_added', operator: 'range', value: { gte: `${desde}T00:00:00-03:00`, lte: `${hasta}T23:59:59-03:00` } },
    ];
    const ops = [];
    let searchAfter;
    let cortado = false;
    for (let pagina = 0; pagina < 30; pagina++) {
      const body = { locationId: LOCATION, filters: filtros, limit: 100 };
      if (searchAfter) body.searchAfter = searchAfter;
      const r = await fetch(`${API}/opportunities/search`, { method: 'POST', headers, body: JSON.stringify(body) });
      if (!r.ok) return json({ error: `GHL búsqueda respondió ${r.status}`, detalle: (await r.text()).slice(0, 300) }, 502);
      const d = await r.json();
      const lote = d.opportunities || [];
      for (const op of lote) {
        ops.push({
          id: op.id,
          contactId: op.contactId,
          nombre: op.name || (op.contact && op.contact.name) || 'Sin nombre',
          etapa: op.pipelineStageId,
          estado: op.status,
          canal: canalDe(op),
          creado: op.createdAt,
          cambioEtapa: op.lastStageChangeAt,
          valor: op.monetaryValue || 0,
        });
      }
      if (lote.length < 100) break;
      searchAfter = lote[lote.length - 1].sort;
      if (pagina === 29) cortado = true;
    }
    // Llamadas: citas de los closers con fecha en el período (calendario de GHL), con la etapa actual de su oportunidad.
    let llamadas = [];
    let llamadasError = null;
    try {
      const G = ghl(process.env);
      const ini = new Date(`${desde}T00:00:00-03:00`).getTime();
      const fin = new Date(`${hasta}T23:59:59-03:00`).getTime();
      const porCloser = await Promise.all(CLOSERS.map((c) => G.citas(c.ghlUser, ini, fin).then((evs) => evs.map((ev) => ({ ev, closer: c.nombre })))));
      const citas = porCloser.flat().filter((x) => x.ev.contactId);
      const porContacto = new Map(ops.map((o) => [o.contactId, o]));
      if (citas.some((x) => !porContacto.has(x.ev.contactId))) {
        // Agendas que entraron antes del período: se buscan en una ventana de 60 días más.
        const antes = new Date(ini - 60 * 864e5).toISOString();
        const viejas = await G.oportunidades(antes, `${hasta}T23:59:59-03:00`);
        const preferida = (a, b) => (b.status === 'open' || b.status === 'won') && !(a.status === 'open' || a.status === 'won') ? b : a;
        for (const op of viejas) {
          if (porContacto.has(op.contactId) && ops.includes(porContacto.get(op.contactId))) continue;
          const o = {
            id: op.id, contactId: op.contactId, nombre: op.name || (op.contact && op.contact.name) || 'Sin nombre',
            etapa: op.pipelineStageId, estado: op.status, canal: canalDe(op), creado: op.createdAt, cambioEtapa: op.lastStageChangeAt,
          };
          const prev = porContacto.get(op.contactId);
          porContacto.set(op.contactId, prev ? preferida(prev, o) : o);
        }
      }
      const vistos = new Set();
      for (const { ev, closer } of citas) {
        const k = ev.contactId + '|' + ev.startTime;
        if (vistos.has(k)) continue;
        vistos.add(k);
        const op = porContacto.get(ev.contactId);
        llamadas.push({
          contactId: ev.contactId,
          nombre: op ? op.nombre : ev.title || 'Sin nombre',
          closer,
          inicio: new Date(ev.startTime).toISOString(),
          etapa: op ? op.etapa : null,
          canal: op ? op.canal : 'Sin fuente',
        });
      }
    } catch (e) {
      llamadasError = String(e.message || e);
    }
    return json({ actualizado: new Date().toISOString(), desde, hasta, etapas, ops, cortado, llamadas, llamadasError });
  } catch (e) {
    return json({ error: 'No se pudo hablar con GHL', detalle: String(e) }, 502);
  }
};
