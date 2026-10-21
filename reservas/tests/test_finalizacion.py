import logging
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from uuid import uuid4

from prometheus_client import REGISTRY

from app.expiracion import Expirador, finalizar_terminadas

from .conftest import cuerpo
from .test_mensajeria import estado_de, eventos_en_outbox
from .test_reservas import con, crear, post


def confirmar(client, reserva_id):
    with client.app.state.pool.connection() as conn:
        conn.execute("UPDATE reserva SET estado = 'CONFIRMADA' WHERE id = %s", (reserva_id,))


def mover(client, reserva_id, desde, hasta):
    """Cambia la franja de una reserva (ej. '-3 hours', '-1 hour')."""
    with client.app.state.pool.connection() as conn:
        conn.execute(
            "UPDATE reserva SET franja = tstzrange(now() + %s::interval, now() + %s::interval) WHERE id = %s",
            (desde, hasta, reserva_id),
        )


def confirmada_terminada(client, franja):
    reserva = crear(client, uuid4(), franja)
    confirmar(client, reserva["id"])
    mover(client, reserva["id"], "-3 hours", "-1 hour")
    return reserva


def test_finaliza_las_confirmadas_cuya_franja_termino(client, franja):
    reserva = confirmada_terminada(client, franja)
    assert finalizar_terminadas(client.app.state.pool) == 1
    assert estado_de(client, reserva["id"]) == "FINALIZADA"


def test_no_toca_reservas_en_curso_ni_futuras(client, franja):
    en_curso = crear(client, uuid4(), franja)
    confirmar(client, en_curso["id"])
    mover(client, en_curso["id"], "-1 hour", "+1 hour")
    futura = crear(client, uuid4(), franja)
    confirmar(client, futura["id"])

    assert finalizar_terminadas(client.app.state.pool) == 0
    assert estado_de(client, en_curso["id"]) == "CONFIRMADA"
    assert estado_de(client, futura["id"]) == "CONFIRMADA"


def test_solo_finaliza_las_confirmadas(client, franja):
    pendiente = crear(client, uuid4(), franja)
    cancelada = crear(client, uuid4(), franja)
    with client.app.state.pool.connection() as conn:
        conn.execute("UPDATE reserva SET estado = 'CANCELADA' WHERE id = %s", (cancelada["id"],))
    mover(client, pendiente["id"], "-3 hours", "-1 hour")
    mover(client, cancelada["id"], "-3 hours", "-1 hour")

    assert finalizar_terminadas(client.app.state.pool) == 0
    assert estado_de(client, pendiente["id"]) == "PENDIENTE_PAGO"
    assert estado_de(client, cancelada["id"]) == "CANCELADA"


def test_deja_historial_y_sube_la_version(client, franja):
    reserva = confirmada_terminada(client, franja)
    finalizar_terminadas(client.app.state.pool)
    with client.app.state.pool.connection() as conn:
        historial = conn.execute(
            "SELECT estado_anterior, estado_nuevo FROM reserva_historial WHERE reserva_id = %s ORDER BY id",
            (reserva["id"],),
        ).fetchall()
        (version,) = conn.execute("SELECT version FROM reserva WHERE id = %s", (reserva["id"],)).fetchone()
    assert historial[-1] == ("CONFIRMADA", "FINALIZADA")
    assert version == 2


def test_no_publica_eventos(client, franja):
    confirmada_terminada(client, franja)
    antes = len(eventos_en_outbox(client))
    finalizar_terminadas(client.app.state.pool)
    assert len(eventos_en_outbox(client)) == antes


def test_correrlo_dos_veces_no_repite(client, franja):
    confirmada_terminada(client, franja)
    assert finalizar_terminadas(client.app.state.pool) == 1
    assert finalizar_terminadas(client.app.state.pool) == 0


def test_varias_replicas_finalizando_a_la_vez_no_duplican(client, franja):
    for _ in range(20):
        confirmada_terminada(client, franja)
    with ThreadPoolExecutor(max_workers=4) as pool:
        totales = list(pool.map(lambda _: finalizar_terminadas(client.app.state.pool), range(4)))
    assert sum(totales) == 20
    with client.app.state.pool.connection() as conn:
        (historiales,) = conn.execute(
            "SELECT count(*) FROM reserva_historial WHERE estado_nuevo = 'FINALIZADA'"
        ).fetchone()
    assert historiales == 20


def test_la_finalizacion_se_cuenta(client, franja):
    def valor():
        return REGISTRY.get_sample_value("reservas_finalizadas_total") or 0.0

    antes = valor()
    for _ in range(3):
        confirmada_terminada(client, franja)
    finalizar_terminadas(client.app.state.pool)
    assert valor() == antes + 3


def test_el_proceso_en_segundo_plano_tambien_finaliza(client, franja):
    reserva = confirmada_terminada(client, franja)
    proceso = Expirador(client.app.state.pool, intervalo=0.1)
    proceso.start()
    try:
        for _ in range(30):
            if estado_de(client, reserva["id"]) == "FINALIZADA":
                break
            time.sleep(0.1)
    finally:
        proceso.detener()
        proceso.join(timeout=5)
    assert estado_de(client, reserva["id"]) == "FINALIZADA"


def test_una_reserva_finalizada_no_se_puede_cancelar(client, franja):
    conductor = uuid4()
    reserva = crear(client, uuid4(), franja, conductor)
    confirmar(client, reserva["id"])
    mover(client, reserva["id"], "-3 hours", "-1 hour")
    finalizar_terminadas(client.app.state.pool)
    assert client.post(f"/reservas/{reserva['id']}/cancelar", headers=con(conductor)).status_code == 409


def test_no_se_pueden_crear_reservas_en_el_pasado(client, franja):
    desde, hasta = franja
    ayer = (desde - timedelta(days=3), hasta - timedelta(days=3))
    assert post(client, cuerpo(uuid4(), *ayer)).status_code == 422
