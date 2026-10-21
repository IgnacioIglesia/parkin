#!/usr/bin/env python3
"""Cocheras de mentira para probar Reservas sin el servicio real (por ejemplo con carga.py).

Responde a `cochera(id)` con cualquier id: propietario derivado del id y precio fijo.
    python3 scripts/cocheras_falso.py [--puerto 4000] [--precio 90]
No usar fuera de pruebas.
"""
import argparse
import json
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def crear_handler(precio: float):
    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            if self.path != "/graphql":
                return self._responder(404, {"errors": [{"message": "no existe"}]})
            cuerpo = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
            cochera_id = (cuerpo.get("variables") or {}).get("id", "")
            propietario = str(uuid.uuid5(uuid.NAMESPACE_URL, cochera_id))
            self._responder(200, {"data": {"cochera": {"propietario": {"id": propietario}, "precioHora": precio}}})

        def do_GET(self):
            self._responder(200, {"status": "ok"})

        def _responder(self, estado, cuerpo):
            datos = json.dumps(cuerpo).encode()
            self.send_response(estado)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(datos)))
            self.end_headers()
            self.wfile.write(datos)

        def log_message(self, *args):
            pass

    return Handler


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--puerto", type=int, default=4000)
    parser.add_argument("--precio", type=float, default=90)
    args = parser.parse_args()
    print(f"Cocheras falso en http://localhost:{args.puerto}/graphql (precioHora {args.precio})")
    ThreadingHTTPServer(("0.0.0.0", args.puerto), crear_handler(args.precio)).serve_forever()
