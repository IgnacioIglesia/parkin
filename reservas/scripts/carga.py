#!/usr/bin/env python3
"""Prueba de concurrencia contra un servicio de Reservas en ejecución.

    python3 scripts/carga.py                         # http://localhost:8000, 100 clientes
    python3 scripts/carga.py --url http://localhost:8000 --clientes 300

Lanza muchos requests a la vez (todos arrancan juntos) y comprueba que la base respete la
regla central: nunca hay dos reservas activas solapadas en la misma cochera. No necesita
dependencias. Termina con código 1 si alguna verificación falla.
"""
import argparse
import http.client
import json
import statistics
import sys
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

BASE = (datetime.now(timezone.utc) + timedelta(days=30)).replace(minute=0, second=0, microsecond=0)


def iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


class Cliente:
    def __init__(self, url: str):
        partes = urlparse(url)
        self.host, self.puerto = partes.hostname, partes.port or 80

    def pedir(self, metodo, ruta, cuerpo=None, usuario=None, clave=None):
        conexion = http.client.HTTPConnection(self.host, self.puerto, timeout=60)
        headers = {"Content-Type": "application/json"}
        if usuario:
            headers["X-User-Id"] = str(usuario)
        if clave:
            headers["Idempotency-Key"] = clave
        inicio = time.perf_counter()
        try:
            conexion.request(metodo, ruta, json.dumps(cuerpo) if cuerpo else None, headers)
            respuesta = conexion.getresponse()
            datos = respuesta.read()
            estado = respuesta.status
        except OSError:
            return 0, (time.perf_counter() - inicio) * 1000, None
        finally:
            conexion.close()
        try:
            return estado, (time.perf_counter() - inicio) * 1000, json.loads(datos)
        except ValueError:
            return estado, (time.perf_counter() - inicio) * 1000, datos.decode()

    def reservar(self, cochera, desde, hasta, usuario=None, clave=None):
        cuerpo = {
            "cochera_id": str(cochera), "propietario_id": str(uuid.uuid4()), "monto": 180,
            "desde": iso(desde), "hasta": iso(hasta),
        }
        return self.pedir("POST", "/reservas", cuerpo, usuario or uuid.uuid4(), clave or str(uuid.uuid4()))

    def ocupacion(self, cochera, desde, hasta):
        ruta = f"/cocheras/{cochera}/ocupacion?desde={iso(desde)}&hasta={iso(hasta)}"
        return self.pedir("GET", ruta)[2]

    def metricas(self) -> dict:
        _, _, texto = self.pedir("GET", "/metrics")
        resultado = {}
        for linea in (texto or "").splitlines():
            if linea.startswith(("reservas_creadas_total", "reservas_conflictos_total", "reservas_outbox_pendientes")):
                nombre, valor = linea.rsplit(" ", 1)
                resultado[nombre] = float(valor)
        return resultado


def lanzar(n: int, tarea):
    """Ejecuta `tarea(i)` en n hilos que arrancan a la vez (barrera) para maximizar la contención."""
    barrera = threading.Barrier(n)

    def envuelta(i):
        barrera.wait()
        return tarea(i)

    with ThreadPoolExecutor(max_workers=n) as pool:
        return list(pool.map(envuelta, range(n)))


def resumen(resultados):
    estados = {}
    for estado, _, _ in resultados:
        estados[estado] = estados.get(estado, 0) + 1
    tiempos = sorted(ms for _, ms, _ in resultados)
    p95 = tiempos[max(0, int(len(tiempos) * 0.95) - 1)]
    cuenta = " · ".join(f"{estado or 'sin respuesta'} ×{n}" for estado, n in sorted(estados.items()))
    print(f"  Respuestas: {cuenta}")
    print(f"  Latencia:   p50 {statistics.median(tiempos):.0f} ms · p95 {p95:.0f} ms · máx {tiempos[-1]:.0f} ms")
    return estados


def verificar(descripcion: str, ok: bool, resultados: list) -> None:
    print(f"  {'✔' if ok else '✘ FALLÓ'} {descripcion}")
    resultados.append(ok)


def escenario_misma_franja(c: Cliente, n: int, checks: list):
    print(f"\n1. {n} conductores distintos reservan la MISMA cochera y franja a la vez")
    cochera, desde, hasta = uuid.uuid4(), BASE, BASE + timedelta(hours=2)
    resultados = lanzar(n, lambda i: c.reservar(cochera, desde, hasta))
    estados = resumen(resultados)
    ocupadas = c.ocupacion(cochera, desde - timedelta(hours=1), hasta + timedelta(hours=1))
    verificar("exactamente 1 reserva creada", estados.get(201) == 1, checks)
    verificar(f"las otras {n - 1} recibieron 409", estados.get(409) == n - 1, checks)
    verificar("la cochera tiene 1 sola franja ocupada", len(ocupadas) == 1, checks)


def escenario_doble_click(c: Cliente, n: int, checks: list):
    print(f"\n2. Un conductor toca 'Reservar' {n} veces con la misma Idempotency-Key")
    cochera, conductor, clave = uuid.uuid4(), uuid.uuid4(), str(uuid.uuid4())
    desde, hasta = BASE, BASE + timedelta(hours=2)
    resultados = lanzar(n, lambda i: c.reservar(cochera, desde, hasta, conductor, clave))
    estados = resumen(resultados)
    ids = {cuerpo["id"] for estado, _, cuerpo in resultados if estado in (200, 201)}
    ocupadas = c.ocupacion(cochera, desde - timedelta(hours=1), hasta + timedelta(hours=1))
    verificar("todas las respuestas son 200 o 201", set(estados) <= {200, 201}, checks)
    verificar("todas devuelven la misma reserva", len(ids) == 1, checks)
    verificar("se creó una sola reserva", len(ocupadas) == 1, checks)


def escenario_cocheras_distintas(c: Cliente, n: int, checks: list):
    print(f"\n3. {n} conductores reservan {n} cocheras DISTINTAS a la vez (no debe haber bloqueos)")
    desde, hasta = BASE, BASE + timedelta(hours=2)
    resultados = lanzar(n, lambda i: c.reservar(uuid.uuid4(), desde, hasta))
    estados = resumen(resultados)
    verificar(f"las {n} reservas se crearon", estados.get(201) == n, checks)


def escenario_franjas_solapadas(c: Cliente, n: int, checks: list):
    print(f"\n4. {n} reservas de 2 h desplazadas 30 min entre sí sobre UNA cochera (muchas se pisan)")
    cochera = uuid.uuid4()
    pedidas = [(BASE + timedelta(minutes=30 * i), BASE + timedelta(minutes=30 * i, hours=2)) for i in range(n)]
    resultados = lanzar(n, lambda i: c.reservar(cochera, *pedidas[i]))
    estados = resumen(resultados)
    ocupadas = c.ocupacion(cochera, BASE - timedelta(hours=1), BASE + timedelta(minutes=30 * n, hours=3))
    franjas = sorted((_parse(o["desde"]), _parse(o["hasta"])) for o in ocupadas)
    sin_solapes = all(franjas[i][1] <= franjas[i + 1][0] for i in range(len(franjas) - 1))
    aceptadas = [pedidas[i] for i, (estado, _, _) in enumerate(resultados) if estado == 201]
    rechazadas = [pedidas[i] for i, (estado, _, _) in enumerate(resultados) if estado == 409]
    justificadas = all(any(d < fa_h and fa_d < h for fa_d, fa_h in aceptadas) for d, h in rechazadas)
    verificar("hubo al menos una reserva creada", len(aceptadas) >= 1, checks)
    verificar(f"las {len(aceptadas)} aceptadas coinciden con las franjas ocupadas", len(ocupadas) == len(aceptadas), checks)
    verificar("ninguna de las franjas ocupadas se solapa con otra", sin_solapes, checks)
    verificar("todo rechazo (409) se solapa con alguna reserva aceptada (no hay rechazos injustos)", justificadas, checks)
    verificar("no hubo errores inesperados", set(estados) <= {201, 409}, checks)


def _parse(valor: str) -> datetime:
    return datetime.fromisoformat(valor.replace("Z", "+00:00"))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--url", default="http://localhost:8000")
    parser.add_argument("--clientes", type=int, default=100, help="requests simultáneos por escenario")
    args = parser.parse_args()

    c = Cliente(args.url)
    if c.pedir("GET", "/health")[0] != 200:
        sys.exit(f"No hay un servicio de Reservas en {args.url}")

    print(f"Prueba de concurrencia contra {args.url} ({args.clientes} clientes por escenario)")
    antes = c.metricas()
    checks: list = []
    escenario_misma_franja(c, args.clientes, checks)
    escenario_doble_click(c, args.clientes, checks)
    escenario_cocheras_distintas(c, args.clientes, checks)
    escenario_franjas_solapadas(c, min(args.clientes, 60), checks)
    despues = c.metricas()

    if antes and despues:
        print("\nMétricas del servicio durante la prueba (GET /metrics)")
        for nombre in sorted(despues):
            print(f"  {nombre}: {despues[nombre] - antes.get(nombre, 0):+.0f}")

    fallidos = checks.count(False)
    print(f"\n{'TODO OK' if not fallidos else 'HAY FALLAS'}: {len(checks) - fallidos}/{len(checks)} verificaciones")
    sys.exit(1 if fallidos else 0)


if __name__ == "__main__":
    main()
