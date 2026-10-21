// Configuración fija de la cuenta. Lo que cambia seguido va en variables de entorno.
export const LOCATION = 'x7nYndpXUc1dmpunATsZ';
export const PIPELINE = 'Hdnl2Kgw5kRk1rCNrwYW'; // Agendas
export const CAMPO_FUENTE_OP = 'AYMUH5mbdgrzUp754A6z'; // Fuente (oportunidad)
export const CAMPO_ESTADO_POST = 'Fyq7gYZmwoByzMgnELwo'; // Estado post llamada (contacto)
export const CRM = 'https://ghl.foundersbs.com';
export const SLACK_REPORTES = 'C0AFE1J5HT8'; // #reporte-diario-comercial
export const SLACK_ALTAS = 'C0AFNR0JJCV'; // #altas-pagos-clientes
export const SLACK_OPS = 'C0AFG0TMFR8'; // #admin-ops

// Closers: id de usuario en GHL (sus citas salen del calendario de GHL) y id de Slack para el aviso directo.
// Fabricio no tiene usuario de Slack: lo suyo va a #admin-ops.
export const CLOSERS = [
  { nombre: 'Braian', ghlUser: 'XbTDbHraC9GbkrfG8QFa', slack: 'U0AST7NV3HQ' },
  { nombre: 'Kevin', ghlUser: 'NzfqRkIVHB35jbowZzq9', slack: 'U0AF826DU05' },
  { nombre: 'Fabri', ghlUser: 'q8FpMiPw3nUCEGiBVs1T', slack: null },
  { nombre: 'Vicky', ghlUser: 'ytbSjEqJ0QqmYT7yfVFM', slack: 'U0AEZKQHBNY' },
];

export const ETAPAS = {
  sinCita: '73b006f8-0bd9-4139-a483-5dd528525f3f',
  nichoSinDinero: 'd94bca6a-8f74-49cc-9d71-4b709b3baa8b',
  nuevoLead: 'ffce6347-55fd-4de4-9f1e-8be998f14612',
  confirmarNicho: 'd2521380-080f-49fa-89f8-b2aa933e25eb',
  triajeBio: '478830fe-ae33-45bf-b2a7-c297a274840d',
  masAdelante: '40ca0460-22c2-401e-abdc-f25e3fdb7239',
  conversando: 'f6db291b-a166-4080-a7ef-6a8ef105112b',
  formEnviado: '34f9495f-3012-467b-95ef-66d2be9c8b14',
  noResponde: '5600b3d7-8ca6-4ea0-a833-c59ef3359120',
  descInversion: '26a12464-b8c5-4479-b395-81bb0055ce4a',
  descNicho: '9d0be400-6169-44db-b51d-0c48135bb8fb',
  canceladoSetter: '0e9f05f1-5cc8-45d7-9826-8fe7a7190d50',
  interesadosSinDinero: 'a974dea6-d07e-4f56-bb29-1c9d9b201b71',
  triajeConfirmado: 'a2293b95-6756-412c-a3a7-1443889be0fe',
  nutricionConfirmacion: 'b340fd17-1239-48a2-a155-c44a713ca9d5',
  asistCualificada: '6d7e9c82-450c-4613-9ef1-26d42e10bf97',
  asistSinDinero: '53407c49-b9de-4af9-a777-d5c05fac7005',
  asistNoEncaja: 'cb4fe580-9695-4ffb-b6f9-856b65b9f24b',
  noAsistio: 'b7c0eff7-3cef-422e-8f2e-e31764efe11e',
  sena: '9b814aaa-e9e0-4d95-b217-e61c1efd61cf',
  venta: 'd9f852a9-b4a8-40fc-b40b-c6cefc2060e0',
};
const E = ETAPAS;
export const ETAPAS_ASISTENCIA = [E.asistCualificada, E.asistSinDinero, E.asistNoEncaja];
export const ETAPAS_RESULTADO = [...ETAPAS_ASISTENCIA, E.noAsistio, E.sena, E.venta, E.interesadosSinDinero];
export const ETAPAS_PRE_LLAMADA = [E.sinCita, E.nuevoLead, E.confirmarNicho, E.triajeBio, E.masAdelante, E.conversando, E.formEnviado, E.triajeConfirmado, E.nutricionConfirmacion];

// Estado del reporte → etapa(s) válidas en Agendas y Estado post llamada esperado.
// Las dos filas que van a "Asistencia no encaja" están para validar con Male.
export const ESTADOS = {
  'venta': { etapas: [E.venta], post: 'Cerrado' },
  'sena': { etapas: [E.sena], post: 'Seña' },
  'calificado en seguimiento': { etapas: [E.asistCualificada], post: 'Calificado en seguimiento' },
  'calificado sin dinero': { etapas: [E.asistSinDinero, E.interesadosSinDinero], post: 'Calificado sin dinero' },
  'calificado no interesado': { etapas: [E.asistNoEncaja], post: 'Calificado pero no interesado' },
  'no cualificado': { etapas: [E.asistNoEncaja], post: 'No cualificado' },
  'no asistio': { etapas: [E.noAsistio], post: null },
};

export const REGLAS = {
  A: 'Reporte sin oportunidad en Agendas',
  B: 'La etapa en GHL no coincide con el reporte',
  C: 'Alta o pago sin Venta/Seña en GHL',
  D: 'Cita pasada sin asistencia cargada',
  E: 'Oportunidad duplicada abierta',
  F: 'Asistencia sin Estado post llamada',
  G: 'Reporte incompleto o con Estado fuera de la lista',
  H: 'Cita pasada sin reporte en Slack',
  I: 'Agenda trabada más de 48 h sin movimiento',
};
