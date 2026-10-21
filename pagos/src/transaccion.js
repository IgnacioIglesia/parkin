// Ejecuta `trabajo(client)` dentro de una transacción: COMMIT si termina, ROLLBACK si lanza.
export async function enTransaccion(pool, trabajo) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const resultado = await trabajo(client);
    await client.query('COMMIT');
    return resultado;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
