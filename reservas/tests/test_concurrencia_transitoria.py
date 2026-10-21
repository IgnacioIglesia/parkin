import threading
import time
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
from prometheus_client import REGISTRY
from psycopg import errors

from app import repository
from app.repository import ConflictoTransitorio

from .conftest import cuerpo
from .test_mensajeria import eventos_en_outbox
from .test_reservas import post


def reintentos(motivo):
    return REGISTRY.get_sample_value("reservas_reintentos_transaccion_total", {"motivo": motivo}) or 0.0


# --- Reservas simultáneas sobre la misma franja: nunca un 500 ---


@pytest.mark.parametrize("simultaneas, rondas", [(10, 60), (30, 25)])
def test_reservas_simultaneas_dan_un_201_y_el_resto_409_sin_ningun_500(client, franja, simultaneas, rondas):
    """Regresión: con PostgreSQL real, dos INSERT concurrentes sobre la misma cochera podían
    terminar en DeadlockDetected (500) aunque nunca hubiera doble reserva."""
    for _ in range(rondas):  # muchas rondas: el deadlock era intermitente (~1 de cada 10)
        cochera = uuid4()
        body = cuerpo(cochera, *franja)
        barrera = threading.Barrier(simultaneas)

        def pedir(_):
            barrera.wait()
            return post(client, body).status_code

        with ThreadPoolExecutor(max_workers=simultaneas) as pool:
            codigos = list(pool.map(pedir, range(simultaneas)))

        assert codigos.count(201) == 1, codigos
        assert codigos.count(409) == simultaneas - 1, codigos
        assert 500 not in codigos and 503 not in codigos
        with client.app.state.pool.connection() as conn:
            (activas,) = conn.execute("SELECT count(*) FROM reserva WHERE cochera_id = %s", (cochera,)).fetchone()
        assert activas == 1


def test_cocheras_distintas_no_se_bloquean_entre_si(client, franja):
    """El lock es por cochera: una alta lenta en la cochera A no frena a la cochera B."""
    cochera_a, cochera_b = uuid4(), uuid4()
    pool = client.app.state.pool
    with pool.connection() as retenida:
        # Simula una alta en curso sobre A que todavía no confirmó.
        retenida.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (str(cochera_a),))

        resultado_a = {}
        hilo = threading.Thread(target=lambda: resultado_a.update(estado=post(client, cuerpo(cochera_a, *franja)).status_code))
        hilo.start()
        time.sleep(0.3)
        assert hilo.is_alive(), "el pedido sobre A debe esperar al lock"

        inicio = time.perf_counter()
        assert post(client, cuerpo(cochera_b, *franja)).status_code == 201
        assert time.perf_counter() - inicio < 1.0, "la cochera B no debía esperar a la A"

        retenida.commit()  # libera el lock de A
    hilo.join(timeout=5)
    assert resultado_a["estado"] == 201


# --- Reintento ante deadlock o fallo de serialización (simulados a mitad de la transacción) ---


@pytest.fixture
def fallar_antes_de_confirmar(monkeypatch):
    """Hace que las primeras N transacciones de alta fallen con el error dado DESPUÉS de haber
    insertado (como un deadlock real), para comprobar que se revierte todo y se reintenta."""
    original = repository.eventos.encolar

    def instalar(error, veces):
        restantes = {"n": veces}

        def encolar(conn, *args, **kwargs):
            if restantes["n"] > 0:
                restantes["n"] -= 1
                raise error("simulado")
            return original(conn, *args, **kwargs)

        monkeypatch.setattr(repository.eventos, "encolar", encolar)

    return instalar


@pytest.mark.parametrize("error", [errors.DeadlockDetected, errors.SerializationFailure])
@pytest.mark.parametrize("fallos", [1, 2])
def test_reintenta_y_crea_la_reserva(client, franja, fallar_antes_de_confirmar, error, fallos):
    antes = reintentos(error.__name__)
    fallar_antes_de_confirmar(error, fallos)
    r = post(client, cuerpo(uuid4(), *franja))
    assert r.status_code == 201
    assert reintentos(error.__name__) == antes + fallos
    # Los intentos fallidos se revirtieron por completo: una sola reserva, un solo evento.
    with client.app.state.pool.connection() as conn:
        assert conn.execute("SELECT count(*) FROM reserva").fetchone()[0] == 1
        assert conn.execute("SELECT count(*) FROM reserva_historial").fetchone()[0] == 1
    assert [rk for rk, _, _ in eventos_en_outbox(client)] == ["reserva.creada"]


def test_si_tras_el_reintento_la_franja_esta_ocupada_responde_409(client, franja, fallar_antes_de_confirmar):
    cochera = uuid4()
    assert post(client, cuerpo(cochera, *franja)).status_code == 201  # el "ganador"
    fallar_antes_de_confirmar(errors.DeadlockDetected, 1)
    r = post(client, cuerpo(cochera, *franja))
    assert r.status_code == 409  # el reintento ve la reserva confirmada: ExclusionViolation


def test_si_agota_los_reintentos_responde_503_con_retry_after_y_no_deja_nada(client, franja, fallar_antes_de_confirmar):
    fallar_antes_de_confirmar(errors.DeadlockDetected, 99)
    r = post(client, cuerpo(uuid4(), *franja))
    assert r.status_code == 503
    assert r.headers["retry-after"] == "1"
    with client.app.state.pool.connection() as conn:
        assert conn.execute("SELECT count(*) FROM reserva").fetchone()[0] == 0
    assert eventos_en_outbox(client) == []


def test_hace_exactamente_tres_intentos(client, franja, fallar_antes_de_confirmar):
    llamadas = []
    original = repository.eventos.encolar

    def contar(conn, *a, **k):
        llamadas.append(1)
        raise errors.DeadlockDetected("simulado")

    repository.eventos.encolar = contar
    try:
        with pytest.raises(ConflictoTransitorio):
            repository.crear_reserva(
                client.app.state.pool, conductor_id=uuid4(), cochera_id=uuid4(), propietario_id=uuid4(),
                desde=franja[0], hasta=franja[1], monto=1, idempotency_key=str(uuid4()),
                retencion_minutos=10, trace_id="t",
            )
    finally:
        repository.eventos.encolar = original
    assert len(llamadas) == repository.INTENTOS_MAXIMOS == 3


def test_otros_errores_no_se_reintentan(client, franja, monkeypatch):
    llamadas = []

    def romper(conn, *a, **k):
        llamadas.append(1)
        raise errors.DataError("no es transitorio")

    monkeypatch.setattr(repository.eventos, "encolar", romper)
    with pytest.raises(errors.DataError):
        repository.crear_reserva(
            client.app.state.pool, conductor_id=uuid4(), cochera_id=uuid4(), propietario_id=uuid4(),
            desde=franja[0], hasta=franja[1], monto=1, idempotency_key=str(uuid4()),
            retencion_minutos=10, trace_id="t",
        )
    assert len(llamadas) == 1
