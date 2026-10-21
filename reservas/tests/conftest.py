import os
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

# Los tests necesitan un Postgres real (la restricción de exclusión es lo que se prueba).
# Ejemplo: TEST_DATABASE_URL=postgres://app:app@localhost:5443/reservas_test pytest
TEST_DB = os.environ.get("TEST_DATABASE_URL")


@pytest.fixture(scope="session")
def client():
    if not TEST_DB:
        pytest.skip("Definir TEST_DATABASE_URL")
    os.environ["DATABASE_URL"] = TEST_DB
    # Los tests llaman a la expiración a mano; el ciclo automático no debe interferir.
    os.environ["EXPIRACION_INTERVALO_SEGUNDOS"] = "3600"
    from app.main import app

    with TestClient(app) as c:
        yield c


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
        "propietario_id": str(uuid4()),
        "monto": 180.0,
        "desde": desde.isoformat(),
        "hasta": hasta.isoformat(),
    }
