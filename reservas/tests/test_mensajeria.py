from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest

from app.outbox import drenar
from app.procesador import EventoInvalido, procesar_evento

from .conftest import cuerpo
from .test_reservas import con, crear, post


def eventos_en_outbox(client):
    with client.app.state.pool.connection() as conn:
        return [
            (rk, payload, publicada is not None)
            for rk, payload, publicada in conn.execute(
                "SELECT routing_key, payload, publicada_en FROM outbox ORDER BY id"
            )
        ]


def evento_de_pago(tipo, reserva_id, event_id=None):
    return {
        "eventId": str(event_id or uuid4()),
        "tipo": tipo,
        "ocurridoEn": "2026-10-21T14:03:22Z",
        "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
        "datos": {"reservaId": reserva_id, "pagoId": "p-1", "monto": 180.0, "moneda": "UYU"},
    }


def estado_de(client, reserva_id):
    with client.app.state.pool.connection() as conn:
        return conn.execute("SELECT estado FROM reserva WHERE id = %s", (reserva_id,)).fetchone()[0]


# --- Eventos que Reservas publica ---


def test_crear_reserva_encola_reserva_creada(client, franja):
    reserva = crear(client, uuid4(), franja)
    [(rk, evento, publicada)] = eventos_en_outbox(client)
    assert rk == "reserva.creada"
    assert publicada is False
    assert evento["tipo"] == "reserva.creada"
    assert evento["datos"]["reservaId"] == reserva["id"]
    assert evento["datos"]["moneda"] == "UYU"
    assert evento["datos"]["estado"] == "PENDIENTE_PAGO"
    assert {"eventId", "ocurridoEn", "traceId"} <= set(evento)


def test_reserva_rechazada_por_franja_ocupada_no_encola_nada(client, franja):
    cochera = uuid4()
    crear(client, cochera, franja)
    assert post(client, cuerpo(cochera, *franja)).status_code == 409
    assert len(eventos_en_outbox(client)) == 1


def test_idempotency_key_repetida_no_duplica_el_evento(client, franja):
    conductor, clave = uuid4(), str(uuid4())
    body = cuerpo(uuid4(), *franja)
    post(client, body, conductor, clave)
    post(client, body, conductor, clave)
    assert len(eventos_en_outbox(client)) == 1


def test_traceparent_se_copia_al_evento(client, franja):
    trace = "4bf92f3577b34da6a3ce929d0e0e4736"
    r = client.post(
        "/reservas",
        json=cuerpo(uuid4(), *franja),
        headers={
            "X-User-Id": str(uuid4()),
            "Idempotency-Key": str(uuid4()),
            "traceparent": f"00-{trace}-00f067aa0ba902b7-01",
        },
    )
    assert r.status_code == 201
    assert eventos_en_outbox(client)[0][1]["traceId"] == trace


def test_cancelar_encola_reserva_cancelada(client, franja):
    conductor = uuid4()
    reserva = crear(client, uuid4(), franja, conductor)
    client.post(f"/reservas/{reserva['id']}/cancelar", headers=con(conductor))
    claves = [rk for rk, _, _ in eventos_en_outbox(client)]
    assert claves == ["reserva.creada", "reserva.cancelada"]
    assert eventos_en_outbox(client)[1][1]["datos"]["motivo"] == "cancelada_por_usuario"


# --- Publicación del outbox ---


def test_drenar_publica_en_orden_y_marca_como_publicados(client, franja):
    crear(client, uuid4(), franja)
    crear(client, uuid4(), franja)
    enviados = []
    assert drenar(client.app.state.pool, lambda rk, ev: enviados.append((rk, ev["eventId"]))) == 2
    assert [rk for rk, _ in enviados] == ["reserva.creada", "reserva.creada"]
    assert all(publicada for _, _, publicada in eventos_en_outbox(client))
    assert drenar(client.app.state.pool, lambda rk, ev: enviados.append(rk)) == 0


def test_si_el_broker_falla_el_evento_queda_pendiente_y_se_reintenta(client, franja):
    crear(client, uuid4(), franja)

    def broker_caido(rk, ev):
        raise ConnectionError("broker caído")

    with pytest.raises(ConnectionError):
        drenar(client.app.state.pool, broker_caido)
    assert [publicada for _, _, publicada in eventos_en_outbox(client)] == [False]

    enviados = []
    assert drenar(client.app.state.pool, lambda rk, ev: enviados.append(rk)) == 1
    assert enviados == ["reserva.creada"]


def test_dos_publicadores_en_paralelo_no_duplican_eventos(client, franja):
    for _ in range(5):
        crear(client, uuid4(), franja)
    enviados = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(lambda _: drenar(client.app.state.pool, lambda rk, ev: enviados.append(ev["eventId"])), range(4)))
    assert len(enviados) == 5
    assert len(set(enviados)) == 5


# --- Eventos que Reservas consume ---


def test_pago_aprobado_confirma_la_reserva_y_encola_reserva_confirmada(client, franja):
    reserva = crear(client, uuid4(), franja)
    assert procesar_evento(client.app.state.pool, evento_de_pago("pago.aprobado", reserva["id"])) == "aplicado"

    assert estado_de(client, reserva["id"]) == "CONFIRMADA"
    ultimo = eventos_en_outbox(client)[-1]
    assert ultimo[0] == "reserva.confirmada"
    assert ultimo[1]["datos"]["estado"] == "CONFIRMADA"
    assert ultimo[1]["traceId"] == "4bf92f3577b34da6a3ce929d0e0e4736"


def test_pago_rechazado_cancela_y_libera_la_franja(client, franja):
    cochera = uuid4()
    reserva = crear(client, cochera, franja)
    assert procesar_evento(client.app.state.pool, evento_de_pago("pago.rechazado", reserva["id"])) == "aplicado"

    assert estado_de(client, reserva["id"]) == "CANCELADA"
    ultimo = eventos_en_outbox(client)[-1]
    assert ultimo[0] == "reserva.cancelada"
    assert ultimo[1]["datos"]["motivo"] == "pago_rechazado"
    assert post(client, cuerpo(cochera, *franja)).status_code == 201


def test_evento_repetido_se_procesa_una_sola_vez(client, franja):
    reserva = crear(client, uuid4(), franja)
    evento = evento_de_pago("pago.aprobado", reserva["id"])
    assert procesar_evento(client.app.state.pool, evento) == "aplicado"
    assert procesar_evento(client.app.state.pool, evento) == "duplicado"
    assert [rk for rk, _, _ in eventos_en_outbox(client)].count("reserva.confirmada") == 1


def test_mismo_evento_en_paralelo_se_aplica_una_sola_vez(client, franja):
    reserva = crear(client, uuid4(), franja)
    evento = evento_de_pago("pago.aprobado", reserva["id"])
    with ThreadPoolExecutor(max_workers=10) as pool:
        resultados = list(pool.map(lambda _: procesar_evento(client.app.state.pool, evento), range(10)))
    assert resultados.count("aplicado") == 1
    assert resultados.count("duplicado") == 9


def test_pago_sobre_reserva_que_ya_no_esta_pendiente_se_ignora(client, franja):
    conductor = uuid4()
    reserva = crear(client, uuid4(), franja, conductor)
    client.post(f"/reservas/{reserva['id']}/cancelar", headers=con(conductor))
    assert procesar_evento(client.app.state.pool, evento_de_pago("pago.aprobado", reserva["id"])) == "ignorado"
    assert estado_de(client, reserva["id"]) == "CANCELADA"


def test_pago_de_reserva_inexistente_se_ignora(client):
    assert procesar_evento(client.app.state.pool, evento_de_pago("pago.aprobado", str(uuid4()))) == "ignorado"


@pytest.mark.parametrize(
    "evento",
    [
        {},
        {"eventId": "no-es-uuid", "tipo": "pago.aprobado", "datos": {"reservaId": str(uuid4())}},
        {"eventId": str(uuid4()), "tipo": "pago.aprobado", "datos": {}},
        {"eventId": str(uuid4()), "tipo": "otro.evento", "datos": {"reservaId": str(uuid4())}},
    ],
)
def test_evento_invalido_se_rechaza(client, evento):
    with pytest.raises(EventoInvalido):
        procesar_evento(client.app.state.pool, evento)
