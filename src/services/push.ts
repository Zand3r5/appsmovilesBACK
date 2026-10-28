import { fail } from '../utils/http';
export async function registerPushDevice(_userId: number, body: any) {
  if (!body || typeof body.id !== 'string' || !['ios', 'android'].includes(body.platform)) fail(400, 'Registro de dispositivo inválido');
  return { id: body.id, enabled: false };
}
export async function unregisterPushDevice(_userId: number, _id: string, _secret: unknown) {}
export async function pushDeviceStatus(_userId: number) { return { devices: [], deliveries: [] }; }
export async function sendPushTest(_userId: number) {
  return { accepted: 0, message: 'Las notificaciones push no están disponibles en esta entrega. Los avisos quedan guardados.' };
}
