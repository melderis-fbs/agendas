// Corre solo: cada 30 min, de 9 a 20:30 (hora Argentina), lunes a sábado.
import { getStore } from '@netlify/blobs';
import { correrControl } from '../lib/control.mjs';
export default async () => {
  const estado = await correrControl({ env: process.env, store: getStore('control') });
  console.log(`Control: ${estado.alertas.length} alertas, ${estado.duracionMs} ms`, estado.fuentes);
};
export const config = { schedule: '*/30 12-23 * * 1-6' };
