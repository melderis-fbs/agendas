// El tablero lee las alertas. Con ?correr=1 corre el control en el momento (botón "Revisar ahora").
import { getStore } from '@netlify/blobs';
import { correrControl } from '../lib/control.mjs';
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
export default async (req) => {
  if (process.env.DASH_KEY && req.headers.get('x-dash-key') !== process.env.DASH_KEY) return json({ error: 'Clave incorrecta' }, 401);
  const store = getStore('control');
  if (new URL(req.url).searchParams.get('correr') === '1') {
    try { return json(await correrControl({ env: process.env, store, presupuestoMs: 9000 })); }
    catch (e) { return json({ error: String(e.message || e) }, 502); }
  }
  return json((await store.get('estado', { type: 'json' })) || { alertas: [], corrida: null });
};
