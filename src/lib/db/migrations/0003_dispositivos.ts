/**
 * Intentos de ingreso por dispositivo de confianza: los errores de un dispositivo que ya
 * ingresó antes cuentan solo para ese dispositivo (no bloquean al resto del consultorio,
 * que suele compartir la misma IP).
 */
export const sql = `
alter table login_attempts add column device text;
create index login_attempts_device_idx on login_attempts (device, attempted_at desc) where device is not null;
`;
