import json
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID, uuid4

import httpx
import pytest

from app.cocheras import CocheraNoEncontrada, CocherasNoDisponible, ClienteCocheras, calcular_monto
from app.cocheras import CONSULTA

from .conftest import cuerpo
from .test_reservas import con, crear, post

TRACE = "4bf92f3577b34da6a3ce929d0e0e4736"


def cliente_con(handler) -> ClienteCocheras:
    return ClienteCocheras("http://cocheras:4000", transport=httpx.MockTransport(handler))


def responde(datos, estado=200):
    return cliente_con(lambda request: httpx.Response(estado, json=datos))


# --- Cliente de Cocheras (sin base de datos) ---


def test_el_cliente_devuelve_propietario_y_precio():
    propietario = uuid4()
    c = responde({"data": {"cochera": {"propietario": {"id": str(propietario)}, "precioHora": 90.5}}})
    assert c.cochera(uuid4(), TRACE) == (propietario, Decimal("90.5"))


def test_el_cliente_manda_la_query_el_id_y_el_traceparent():
    vistos = []

    def handler(request):
        vistos.append(request)
        return httpx.Response(200, json={"data": {"cochera": {"propietario": {"id": str(uuid4())}, "precioHora": 50}}})

    cochera = uuid4()
    cliente_con(handler).cochera(cochera, TRACE)
    [request] = vistos
    assert str(request.url) == "http://cocheras:4000/graphql"
    assert json.loads(request.content) == {"query": CONSULTA, "variables": {"id": str(cochera)}}
    partes = request.headers["traceparent"].split("-")
    assert partes[0] == "00" and partes[1] == TRACE and len(partes[2]) == 16 and partes[3] == "01"


def test_cochera_inexistente():
    with pytest.raises(CocheraNoEncontrada):
        responde({"data": {"cochera": None}}).cochera(uuid4(), TRACE)


@pytest.mark.parametrize(
    "respuesta",
    [
        httpx.Response(200, json={"errors": [{"message": "id no es un UUID válido"}], "data": None}),
        httpx.Response(500, text="boom"),
        httpx.Response(200, text="no es json"),
        httpx.Response(200, json={"data": {"cochera": {"propietario": {"id": "no-uuid"}, "precioHora": 10}}}),
        httpx.Response(200, json={"data": {"cochera": {"propietario": {"id": str(uuid4())}, "precioHora": 0}}}),
        httpx.Response(200, json={"data": {"cochera": {"propietario": {"id": str(uuid4())}}}}),
    ],
)
def test_respuestas_raras_cuentan_como_cocheras_no_disponible(respuesta):
    with pytest.raises(CocherasNoDisponible):
        cliente_con(lambda request: respuesta).cochera(uuid4(), TRACE)


def test_si_cocheras_no_responde_es_no_disponible():
    def caido(request):
        raise httpx.ConnectError("sin conexión")

    with pytest.raises(CocherasNoDisponible):
        cliente_con(caido).cochera(uuid4(), TRACE)


# --- Monto ---


@pytest.mark.parametrize(
    "precio, minutos, esperado",
    [
        ("90", 120, "180.00"),
        ("100", 90, "150.00"),
        ("33.33", 60, "33.33"),
        ("90", 20, "30.00"),
        ("10", 1, "0.17"),  # 0.1666… se redondea a centavos
    ],
)
def test_monto_es_precio_por_horas(precio, minutos, esperado):
    desde = datetime(2030, 1, 1, 10, tzinfo=timezone.utc)
    assert calcular_monto(Decimal(precio), desde, desde + timedelta(minutes=minutos)) == Decimal(esperado)


# --- POST /reservas usando Cocheras ---


def test_el_monto_sale_del_precio_de_la_cochera(client, franja, cocheras_falso):
    cocheras_falso.precio = Decimal("75.50")
    reserva = crear(client, uuid4(), franja)  # franja de 2 horas
    assert reserva["monto"] == 151.0


def test_el_propietario_sale_de_cocheras(client, franja, cocheras_falso):
    cochera, propietario = uuid4(), uuid4()
    cocheras_falso.propietarios[cochera] = propietario
    reserva = crear(client, cochera, franja)
    assert reserva["propietario_id"] == str(propietario)


def test_lo_que_mande_el_cliente_como_propietario_o_monto_se_ignora(client, franja, cocheras_falso):
    cochera, propietario = uuid4(), uuid4()
    cocheras_falso.propietarios[cochera] = propietario
    body = cuerpo(cochera, *franja) | {"propietario_id": str(uuid4()), "monto": 1}
    r = post(client, body)
    assert r.status_code == 201
    assert r.json()["propietario_id"] == str(propietario)
    assert r.json()["monto"] == 180.0


def test_cochera_inexistente_devuelve_404_y_no_crea_nada(client, franja, cocheras_falso):
    cochera = uuid4()
    cocheras_falso.inexistentes.add(cochera)
    assert post(client, cuerpo(cochera, *franja)).status_code == 404
    with client.app.state.pool.connection() as conn:
        assert conn.execute("SELECT count(*) FROM reserva").fetchone()[0] == 0
        assert conn.execute("SELECT count(*) FROM outbox").fetchone()[0] == 0


def test_si_cocheras_esta_caida_devuelve_503_y_no_crea_nada(client, franja, cocheras_falso):
    cocheras_falso.caido = True
    assert post(client, cuerpo(uuid4(), *franja)).status_code == 503
    with client.app.state.pool.connection() as conn:
        assert conn.execute("SELECT count(*) FROM reserva").fetchone()[0] == 0


def test_se_propaga_el_traceid_a_cocheras(client, franja, cocheras_falso):
    r = client.post(
        "/reservas",
        json=cuerpo(uuid4(), *franja),
        headers={
            "X-User-Id": str(uuid4()),
            "Idempotency-Key": str(uuid4()),
            "traceparent": f"00-{TRACE}-00f067aa0ba902b7-01",
        },
    )
    assert r.status_code == 201
    assert cocheras_falso.consultas[-1][1] == TRACE


def test_un_reintento_con_la_misma_clave_no_consulta_a_cocheras(client, franja, cocheras_falso):
    conductor, clave = uuid4(), str(uuid4())
    body = cuerpo(uuid4(), *franja)
    assert post(client, body, conductor, clave).status_code == 201
    consultas = len(cocheras_falso.consultas)

    cocheras_falso.caido = True  # aunque Cocheras esté caída, el reintento responde igual
    r = post(client, body, conductor, clave)
    assert r.status_code == 200
    assert len(cocheras_falso.consultas) == consultas


def test_la_franja_ocupada_sigue_dando_409_con_cocheras(client, franja):
    cochera = uuid4()
    crear(client, cochera, franja)
    assert post(client, cuerpo(cochera, *franja)).status_code == 409


def test_las_consultas_a_cocheras_se_cuentan(client, franja, cocheras_falso):
    # El cliente falso no pasa por las métricas: se prueba con el real y un transporte simulado.
    from prometheus_client import REGISTRY

    def valor(resultado):
        return REGISTRY.get_sample_value("reservas_consultas_cocheras_total", {"resultado": resultado}) or 0.0

    ok, no_encontrada, error = valor("ok"), valor("no_encontrada"), valor("error")
    responde({"data": {"cochera": {"propietario": {"id": str(uuid4())}, "precioHora": 10}}}).cochera(uuid4(), TRACE)
    with pytest.raises(CocheraNoEncontrada):
        responde({"data": {"cochera": None}}).cochera(uuid4(), TRACE)
    with pytest.raises(CocherasNoDisponible):
        responde({}, 500).cochera(uuid4(), TRACE)
    assert (valor("ok") - ok, valor("no_encontrada") - no_encontrada, valor("error") - error) == (1, 1, 1)
