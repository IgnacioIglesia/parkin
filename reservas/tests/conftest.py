import os
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import NAMESPACE_URL, uuid4, uuid5

import pytest
from fastapi.testclient import TestClient

from app.cocheras import CocheraNoEncontrada, CocherasNoDisponible

# Los tests necesitan un Postgres real (la restricción de exclusión es lo que se prueba).
# Ejemplo: TEST_DATABASE_URL=postgres://app:app@localhost:5443/reservas_test pytest
TEST_DB = os.environ.get("TEST_DATABASE_URL")


@pytest.fixture(scope="session")
def client():
    if not TEST_DB:
        pytest.skip("Definir TEST_DATABASE_URL")
    os.environ["DATABASE_URL"] = TEST_DB
    os.environ["COCHERAS_URL"] = "http://cocheras.invalid:4000"  # los tests inyectan un Cocheras falso
    # Los tests llaman a la expiración a mano; el ciclo automático no debe interferir.
    os.environ["EXPIRACION_INTERVALO_SEGUNDOS"] = "3600"
    from app.main import app

    with TestClient(app) as c:
        yield c


class CocherasFalso:
    """Reemplaza a Cocheras en los tests. Por defecto toda cochera existe, cobra $90 la hora y
    tiene un propietario estable derivado de su id."""

    def __init__(self):
        self.precio = Decimal("90")
        self.propietarios = {}
        self.inexistentes = set()
        self.caido = False
        self.consultas = []

    def cochera(self, cochera_id, trace_id):
        self.consultas.append((cochera_id, trace_id))
        if self.caido:
            raise CocherasNoDisponible()
        if cochera_id in self.inexistentes:
            raise CocheraNoEncontrada()
        return self.propietarios.get(cochera_id) or uuid5(NAMESPACE_URL, str(cochera_id)), self.precio

    def cerrar(self):
        pass


@pytest.fixture(autouse=True)
def cocheras_falso(client):
    client.app.state.cocheras = CocherasFalso()
    return client.app.state.cocheras


@pytest.fixture(autouse=True)
def limpiar(client):
    with client.app.state.pool.connection() as conn:
        conn.execute("TRUNCATE reserva_historial, reserva, evento_procesado, outbox")
    yield


@pytest.fixture
def franja():
    desde = datetime.now(timezone.utc).replace(microsecond=0) + timedelta(days=1)
    return desde, desde + timedelta(hours=2)


def cuerpo(cochera_id, desde, hasta):
    return {
        "cochera_id": str(cochera_id),
        "desde": desde.isoformat(),
        "hasta": hasta.isoformat(),
    }
