import { LOCATION, PIPELINE } from './config.mjs';

// ---------- GHL ----------
export function ghl(env, f = fetch) {
  const headers = {
    Authorization: `Bearer ${env.GHL_TOKEN}`, Version: '2021-07-28',
    Accept: 'application/json', 'Content-Type': 'application/json',
  };
  const API = 'https://services.leadconnectorhq.com';
  return {
    async etapas() {
      const r = await f(`${API}/opportunities/pipelines?locationId=${LOCATION}`, { headers });
      if (!r.ok) throw new Error(`GHL pipelines ${r.status}`);
      const p = ((await r.json()).pipelines || []).find((x) => x.id === PIPELINE);
      return p ? p.stages.map((s) => ({ id: s.id, nombre: s.name })) : [];
    },
    async oportunidades(desdeISO, hastaISO, maxPaginas = 15) {
      const filters = [
        { field: 'pipeline_id', operator: 'eq', value: PIPELINE },
        { field: 'date_added', operator: 'range', value: { gte: desdeISO, lte: hastaISO } },
      ];
      const out = []; let searchAfter;
      for (let i = 0; i < maxPaginas; i++) {
        const body = { locationId: LOCATION, filters, limit: 100 };
        if (searchAfter) body.searchAfter = searchAfter;
        const r = await f(`${API}/opportunities/search`, { method: 'POST', headers, body: JSON.stringify(body) });
        if (!r.ok) throw new Error(`GHL búsqueda ${r.status}: ${(await r.text()).slice(0, 200)}`);
        const lote = (await r.json()).opportunities || [];
        out.push(...lote);
        if (lote.length < 100) break;
        searchAfter = lote[lote.length - 1].sort;
      }
      return out;
    },
    async citas(userId, desdeMs, hastaMs) {
      const q = new URLSearchParams({ locationId: LOCATION, userId, startTime: String(desdeMs), endTime: String(hastaMs) });
      const r = await f(`${API}/calendars/events?${q}`, { headers });
      if (!r.ok) throw new Error(`GHL calendario ${r.status}`);
      return ((await r.json()).events || []).filter((e) => !e.deleted && e.appointmentStatus !== 'cancelled');
    },
    async contacto(id) {
      const r = await f(`${API}/contacts/${id}`, { headers });
      if (!r.ok) return null;
      return (await r.json()).contact || null;
    },
  };
}

// ---------- Slack ----------
export function slack(env, f = fetch) {
  const h = { Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json; charset=utf-8' };
  return {
    async historial(canal, oldestSec) {
      const out = []; let cursor = '';
      for (let i = 0; i < 5; i++) {
        const q = new URLSearchParams({ channel: canal, oldest: String(oldestSec), limit: '200' });
        if (cursor) q.set('cursor', cursor);
        const r = await f(`https://slack.com/api/conversations.history?${q}`, { headers: h });
        const d = await r.json();
        if (!d.ok) throw new Error(`Slack ${canal}: ${d.error}`);
        out.push(...(d.messages || []));
        cursor = d.response_metadata && d.response_metadata.next_cursor;
        if (!cursor) break;
      }
      return out;
    },
    async enviar(canal, texto) {
      const r = await f('https://slack.com/api/chat.postMessage', { method: 'POST', headers: h, body: JSON.stringify({ channel: canal, text: texto, unfurl_links: false }) });
      const d = await r.json();
      if (!d.ok) throw new Error(`Slack envío: ${d.error}`);
    },
  };
}

// ---------- Claude ----------
export function claude(env, f = fetch) {
  if (!env.ANTHROPIC_API_KEY) return null;
  return {
    async json(sistema, usuario, maxTokens = 800) {
      const r = await f('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model: env.CLAUDE_MODEL || 'claude-sonnet-5-5', max_tokens: maxTokens, system: sistema,
          messages: [{ role: 'user', content: usuario }],
        }),
      });
      if (!r.ok) throw new Error(`Claude ${r.status}`);
      const d = await r.json();
      const txt = (d.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('').replace(/```json|```/g, '').trim();
      return JSON.parse(txt);
    },
  };
}
