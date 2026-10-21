// Lee el pipeline "Agendas" de GHL y devuelve solo lo que el tablero necesita.
// Variables de entorno en Netlify: GHL_TOKEN (Private Integration, scope opportunities.readonly)
// y DASH_KEY (clave que Vicky carga una vez en el tablero).
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
    return json({ actualizado: new Date().toISOString(), desde, hasta, etapas, ops, cortado });
  } catch (e) {
    return json({ error: 'No se pudo hablar con GHL', detalle: String(e) }, 502);
  }
};
