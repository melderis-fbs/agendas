// Resumen al cierre: 21:00 hora Argentina, lunes a sábado.
import { getStore } from '@netlify/blobs';
import { resumenDiario } from '../lib/control.mjs';
export default async () => { await resumenDiario({ env: process.env, store: getStore('control') }); };
export const config = { schedule: '0 0 * * 0,2-6' };
