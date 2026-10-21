import time
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

from app.expiracion import Expirador, expirar_vencidas
from app.procesador import procesar_evento

from .conftest import cuerpo
from .test_mensajeria import estado_de, eventos_en_outbox
from .test_reservas import con, crear, post


def vencer(client, reserva_id):
    with client.app.state.pool.connection() as conn:
        conn.execute(
            "UPDATE reserva SET expira_en = now() - interval '1 minute' WHERE id = %s", (reserva_id,)
        )


def test_expira_reservas_vencidas_y_libera_la_franja(client, franja):
    cochera = uuid4()
    reserva = crear(client, cochera, franja)
    vencer(client, reserva["id"])

    assert expirar_vencidas(client.app.state.pool) == 1
    assert estado_de(client, reserva["id"]) == "EXPIRADA"
    assert post(client, cuerpo(cochera, *franja)).status_code == 201


def test_no_expira_reservas_dentro_del_plazo(client, franja):
    reserva = crear(client, uuid4(), franja)
    assert expirar_vencidas(client.app.state.pool) == 0
    assert estado_de(client, reserva["id"]) == "PENDIENTE_PAGO"


def test_no_expira_reservas_confirmadas_ni_canceladas(client, franja):
    confirmada = crear(client, uuid4(), franja)
    cancelada = crear(client, uuid4(), franja)
    with client.app.state.pool.connection() as conn:
        conn.execute("UPDATE reserva SET estado = 'CONFIRMADA' WHERE id = %s", (confirmada["id"],))
        conn.execute("UPDATE reserva SET estado = 'CANCELADA' WHERE id = %s", (cancelada["id"],))
    vencer(client, confirmada["id"])
    vencer(client, cancelada["id"])

    assert expirar_vencidas(client.app.state.pool) == 0
    assert estado_de(client, confirmada["id"]) == "CONFIRMADA"
    assert estado_de(client, cancelada["id"]) == "CANCELADA"


def test_expirar_publica_reserva_expirada_y_deja_historial(client, franja):
    reserva = crear(client, uuid4(), franja)
    vencer(client, reserva["id"])
    expirar_vencidas(client.app.state.pool)

    ultimo = eventos_en_outbox(client)[-1]
    assert ultimo[0] == "reserva.expirada"
    assert ultimo[1]["datos"]["reservaId"] == reserva["id"]
    assert ultimo[1]["datos"]["estado"] == "EXPIRADA"
    assert ultimo[1]["datos"]["motivo"] == "plazo_vencido"
    with client.app.state.pool.connection() as conn:
        historial = conn.execute(
            "SELECT estado_anterior, estado_nuevo FROM reserva_historial "
            "WHERE reserva_id = %s ORDER BY id",
            (reserva["id"],),
        ).fetchall()
    assert historial[-1] == ("PENDIENTE_PAGO", "EXPIRADA")


def test_correr_la_expiracion_dos_veces_no_repite_el_evento(client, franja):
    reserva = crear(client, uuid4(), franja)
    vencer(client, reserva["id"])
    assert expirar_vencidas(client.app.state.pool) == 1
    assert expirar_vencidas(client.app.state.pool) == 0
    assert [rk for rk, _, _ in eventos_en_outbox(client)].count("reserva.expirada") == 1


def test_varias_replicas_expirando_a_la_vez_no_duplican(client, franja):
    for _ in range(20):
        vencer(client, crear(client, uuid4(), franja)["id"])

    with ThreadPoolExecutor(max_workers=4) as pool:
        totales = list(pool.map(lambda _: expirar_vencidas(client.app.state.pool), range(4)))

    assert sum(totales) == 20
    assert [rk for rk, _, _ in eventos_en_outbox(client)].count("reserva.expirada") == 20


def test_pago_aprobado_y_expiracion_a_la_vez_dejan_un_solo_resultado(client, franja):
    """Carrera: cada reserva termina CONFIRMADA o EXPIRADA, y emite un solo evento de cierre."""
    ids = []
    for _ in range(20):
        reserva = crear(client, uuid4(), franja)
        vencer(client, reserva["id"])
        ids.append(reserva["id"])

    def pago(reserva_id):
        return procesar_evento(
            client.app.state.pool,
            {"eventId": str(uuid4()), "tipo": "pago.aprobado", "datos": {"reservaId": reserva_id}},
        )

    with ThreadPoolExecutor(max_workers=8) as pool:
        expiracion = pool.submit(expirar_vencidas, client.app.state.pool)
        resultados = list(pool.map(pago, ids))
        expiradas = expiracion.result()

    confirmadas = resultados.count("aplicado")
    assert confirmadas + expiradas == 20
    estados = [estado_de(client, i) for i in ids]
    assert estados.count("CONFIRMADA") == confirmadas
    assert estados.count("EXPIRADA") == expiradas
    claves = [rk for rk, _, _ in eventos_en_outbox(client)]
    assert claves.count("reserva.confirmada") == confirmadas
    assert claves.count("reserva.expirada") == expiradas


def test_expirador_automatico_expira_en_segundo_plano(client, franja):
    reserva = crear(client, uuid4(), franja)
    vencer(client, reserva["id"])

    expirador = Expirador(client.app.state.pool, intervalo=0.1)
    expirador.start()
    try:
        for _ in range(30):
            if estado_de(client, reserva["id"]) == "EXPIRADA":
                break
            time.sleep(0.1)
    finally:
        expirador.detener()
        expirador.join(timeout=5)
    assert estado_de(client, reserva["id"]) == "EXPIRADA"


def test_reserva_expirada_ya_no_se_puede_cancelar(client, franja):
    conductor = uuid4()
    reserva = crear(client, uuid4(), franja, conductor)
    vencer(client, reserva["id"])
    expirar_vencidas(client.app.state.pool)
    assert client.post(f"/reservas/{reserva['id']}/cancelar", headers=con(conductor)).status_code == 409
