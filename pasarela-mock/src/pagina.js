const escapar = (texto) =>
  String(texto).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Página de pago de mentira: dos botones para decidir el resultado.
export function paginaCheckout(orden) {
  const monto = new Intl.NumberFormat('es-UY', { style: 'currency', currency: orden.moneda }).format(orden.monto);
  const resuelta = orden.estado !== 'pendiente';
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pasarela de prueba · ParkIN</title>
<style>
  :root { color-scheme: dark; }
  body { font-family: system-ui, sans-serif; background: #0b0c0e; color: #e8e8e8; margin: 0; display: grid; place-items: center; min-height: 100vh; padding: 16px; }
  main { width: min(440px, 100%); border: 1px solid #2a2d33; border-radius: 12px; padding: 28px; background: #14161a; }
  small { color: #9aa0a8; }
  h1 { font-size: 1.1rem; margin: 0 0 4px; }
  .monto { font-size: 2.2rem; font-weight: 700; margin: 18px 0; }
  .aviso { background: #3a2f10; color: #ffcf66; border-radius: 8px; padding: 10px 12px; font-size: .85rem; margin-bottom: 18px; }
  button { width: 100%; padding: 14px; border: 0; border-radius: 8px; font-size: 1rem; font-weight: 600; cursor: pointer; margin-top: 10px; }
  .aprobar { background: #2e9d5b; color: #fff; }
  .rechazar { background: #3a1f22; color: #ff8a8a; border: 1px solid #6b2c31; }
  button:disabled { opacity: .5; cursor: default; }
  #resultado { margin-top: 18px; font-weight: 600; }
</style>
</head>
<body>
<main>
  <h1>Pasarela de prueba</h1>
  <small>Orden ${escapar(orden.idExterno)}</small>
  <div class="monto">${escapar(monto)}</div>
  <div class="aviso">Simulación para la demo: acá no se cobra nada. Elegí cómo termina el pago.</div>
  <button class="aprobar" ${resuelta ? 'disabled' : ''} onclick="resolver('approved')">Aprobar pago</button>
  <button class="rechazar" ${resuelta ? 'disabled' : ''} onclick="resolver('rejected')">Rechazar (fondos insuficientes)</button>
  <div id="resultado">${resuelta ? `Esta orden ya fue ${orden.estado === 'approved' ? 'aprobada' : 'rechazada'}.` : ''}</div>
</main>
<script>
async function resolver(estado) {
  document.querySelectorAll('button').forEach((b) => (b.disabled = true));
  // Relativa a la página (/checkout/<id>): sigue funcionando si la sirve un gateway con prefijo.
  const r = await fetch('${escapar(orden.idExterno)}/resultado', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ estado, motivo: estado === 'rejected' ? 'fondos_insuficientes' : null }),
  });
  const datos = await r.json().catch(() => ({}));
  document.getElementById('resultado').textContent = r.ok
    ? (estado === 'approved' ? '¡Pago aprobado! Ya podés volver a la app.' : 'Pago rechazado. Ya podés volver a la app.')
    : 'No se pudo registrar el resultado: ' + (datos.error || r.status);
}
</script>
</body>
</html>`;
}
