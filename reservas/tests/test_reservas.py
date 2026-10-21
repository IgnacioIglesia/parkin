from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from uuid import uuid4

from .conftest import cuerpo


def post(client, body, conductor=None, clave=None):
    return client.post(
        "/reservas",
        json=body,
        headers={
            "X-User-Id": str(conductor or uuid4()),
            "Idempotency-Key": clave or str(uuid4()),
        },
    )


def test_crea_reserva_pendiente_de_pago(client, franja):
    r = post(client, cuerpo(uuid4(), *franja))
    assert r.status_code == 201
    assert r.json()["estado"] == "PENDIENTE_PAGO"
    assert r.json()["expira_en"] is not None


def test_franja_solapada_devuelve_409(client, franja):
    cochera = uuid4()
    desde, hasta = franja
    assert post(client, cuerpo(cochera, desde, hasta)).status_code == 201
    solapada = cuerpo(cochera, desde + timedelta(hours=1), hasta + timedelta(hours=1))
    assert post(client, solapada).status_code == 409


def test_franjas_contiguas_no_se_solapan(client, franja):
    cochera = uuid4()
    desde, hasta = franja
    assert post(client, cuerpo(cochera, desde, hasta)).status_code == 201
    assert post(client, cuerpo(cochera, hasta, hasta + timedelta(hours=2))).status_code == 201


def test_misma_franja_en_otra_cochera_es_valida(client, franja):
    assert post(client, cuerpo(uuid4(), *franja)).status_code == 201
    assert post(client, cuerpo(uuid4(), *franja)).status_code == 201


def test_reserva_cancelada_libera_la_franja(client, franja):
    cochera = uuid4()
    assert post(client, cuerpo(cochera, *franja)).status_code == 201
    with client.app.state.pool.connection() as conn:
        conn.execute("UPDATE reserva SET estado = 'CANCELADA'")
    assert post(client, cuerpo(cochera, *franja)).status_code == 201


def test_idempotency_key_repetida_devuelve_la_misma_reserva(client, franja):
    cochera, conductor, clave = uuid4(), uuid4(), str(uuid4())
    body = cuerpo(cochera, *franja)
    primera = post(client, body, conductor, clave)
    segunda = post(client, body, conductor, clave)
    assert primera.status_code == 201
    assert segunda.status_code == 200
    assert primera.json()["id"] == segunda.json()["id"]


def test_idempotency_key_de_otro_usuario_devuelve_409(client, franja):
    clave = str(uuid4())
    assert post(client, cuerpo(uuid4(), *franja), uuid4(), clave).status_code == 201
    assert post(client, cuerpo(uuid4(), *franja), uuid4(), clave).status_code == 409


def test_sin_idempotency_key_devuelve_422(client, franja):
    r = client.post("/reservas", json=cuerpo(uuid4(), *franja), headers={"X-User-Id": str(uuid4())})
    assert r.status_code == 422


def test_sin_usuario_devuelve_401(client, franja):
    r = client.post(
        "/reservas", json=cuerpo(uuid4(), *franja), headers={"Idempotency-Key": str(uuid4())}
    )
    assert r.status_code == 401


def test_franja_invertida_devuelve_422(client, franja):
    desde, hasta = franja
    assert post(client, cuerpo(uuid4(), hasta, desde)).status_code == 422


def test_concurrencia_solo_una_reserva_gana(client, franja):
    """30 conductores piden la misma cochera y franja a la vez: exactamente uno la obtiene."""
    cochera = uuid4()
    body = cuerpo(cochera, *franja)

    with ThreadPoolExecutor(max_workers=30) as pool:
        respuestas = list(pool.map(lambda _: post(client, body), range(30)))

    codigos = [r.status_code for r in respuestas]
    assert codigos.count(201) == 1
    assert codigos.count(409) == 29
    with client.app.state.pool.connection() as conn:
        (activas,) = conn.execute(
            "SELECT count(*) FROM reserva WHERE cochera_id = %s", (cochera,)
        ).fetchone()
    assert activas == 1


def test_concurrencia_misma_idempotency_key_crea_una_sola(client, franja):
    """El usuario toca 'Reservar' 20 veces seguidas con la misma clave: una sola reserva."""
    conductor, clave = uuid4(), str(uuid4())
    body = cuerpo(uuid4(), *franja)

    with ThreadPoolExecutor(max_workers=20) as pool:
        respuestas = list(pool.map(lambda _: post(client, body, conductor, clave), range(20)))

    assert {r.status_code for r in respuestas} <= {200, 201}
    assert len({r.json()["id"] for r in respuestas}) == 1
    with client.app.state.pool.connection() as conn:
        (total,) = conn.execute("SELECT count(*) FROM reserva").fetchone()
    assert total == 1


# --- Paso 5: consulta, listado, cancelación y ocupación ---


def crear(client, cochera, franja, conductor=None, propietario=None):
    body = cuerpo(cochera, *franja)
    if propietario:
        client.app.state.cocheras.propietarios[cochera] = propietario
    r = post(client, body, conductor)
    assert r.status_code == 201
    return r.json()


def con(usuario):
    return {"X-User-Id": str(usuario)}


def test_obtener_reserva_como_conductor_y_propietario(client, franja):
    conductor, propietario = uuid4(), uuid4()
    reserva = crear(client, uuid4(), franja, conductor, propietario)
    for usuario in (conductor, propietario):
        r = client.get(f"/reservas/{reserva['id']}", headers=con(usuario))
        assert r.status_code == 200
        assert r.json()["id"] == reserva["id"]


def test_obtener_reserva_ajena_devuelve_404(client, franja):
    reserva = crear(client, uuid4(), franja)
    assert client.get(f"/reservas/{reserva['id']}", headers=con(uuid4())).status_code == 404
    assert client.get(f"/reservas/{uuid4()}", headers=con(uuid4())).status_code == 404


def test_listar_por_rol(client, franja):
    conductor, propietario = uuid4(), uuid4()
    crear(client, uuid4(), franja, conductor, propietario)
    crear(client, uuid4(), franja)  # de otro conductor

    como_conductor = client.get("/reservas?rol=conductor", headers=con(conductor)).json()
    como_propietario = client.get("/reservas?rol=propietario", headers=con(propietario)).json()
    assert len(como_conductor) == 1
    assert len(como_propietario) == 1
    assert client.get("/reservas?rol=propietario", headers=con(conductor)).json() == []
    assert client.get("/reservas?rol=otro", headers=con(conductor)).status_code == 422


def test_cancelar_libera_la_franja_y_deja_historial(client, franja):
    cochera, conductor = uuid4(), uuid4()
    reserva = crear(client, cochera, franja, conductor)

    r = client.post(f"/reservas/{reserva['id']}/cancelar", headers=con(conductor))
    assert r.status_code == 200
    assert r.json()["estado"] == "CANCELADA"
    assert post(client, cuerpo(cochera, *franja)).status_code == 201
    with client.app.state.pool.connection() as conn:
        historial = conn.execute(
            "SELECT estado_anterior, estado_nuevo FROM reserva_historial "
            "WHERE reserva_id = %s ORDER BY id",
            (reserva["id"],),
        ).fetchall()
    assert historial == [(None, "PENDIENTE_PAGO"), ("PENDIENTE_PAGO", "CANCELADA")]


def test_propietario_tambien_puede_cancelar(client, franja):
    conductor, propietario = uuid4(), uuid4()
    reserva = crear(client, uuid4(), franja, conductor, propietario)
    r = client.post(f"/reservas/{reserva['id']}/cancelar", headers=con(propietario))
    assert r.status_code == 200


def test_cancelar_ajena_devuelve_404(client, franja):
    reserva = crear(client, uuid4(), franja)
    r = client.post(f"/reservas/{reserva['id']}/cancelar", headers=con(uuid4()))
    assert r.status_code == 404


def test_cancelar_dos_veces_devuelve_409(client, franja):
    conductor = uuid4()
    reserva = crear(client, uuid4(), franja, conductor)
    assert client.post(f"/reservas/{reserva['id']}/cancelar", headers=con(conductor)).status_code == 200
    assert client.post(f"/reservas/{reserva['id']}/cancelar", headers=con(conductor)).status_code == 409


def test_cancelar_reserva_ya_comenzada_devuelve_409(client, franja):
    conductor = uuid4()
    reserva = crear(client, uuid4(), franja, conductor)
    with client.app.state.pool.connection() as conn:
        conn.execute(
            "UPDATE reserva SET franja = tstzrange(now() - interval '1 hour', now() + interval '1 hour')"
        )
    assert client.post(f"/reservas/{reserva['id']}/cancelar", headers=con(conductor)).status_code == 409


def test_cancelaciones_simultaneas_solo_una_aplica(client, franja):
    conductor = uuid4()
    reserva = crear(client, uuid4(), franja, conductor)
    with ThreadPoolExecutor(max_workers=10) as pool:
        respuestas = list(
            pool.map(
                lambda _: client.post(f"/reservas/{reserva['id']}/cancelar", headers=con(conductor)),
                range(10),
            )
        )
    codigos = [r.status_code for r in respuestas]
    assert codigos.count(200) == 1
    assert codigos.count(409) == 9


def test_ocupacion_devuelve_franjas_activas_en_el_rango(client, franja):
    cochera = uuid4()
    desde, hasta = franja
    crear(client, cochera, franja)
    cancelada = crear(client, cochera, (hasta, hasta + timedelta(hours=2)))
    with client.app.state.pool.connection() as conn:
        conn.execute("UPDATE reserva SET estado = 'CANCELADA' WHERE id = %s", (cancelada["id"],))

    r = client.get(
        f"/cocheras/{cochera}/ocupacion",
        params={"desde": (desde - timedelta(hours=1)).isoformat(), "hasta": (hasta + timedelta(hours=5)).isoformat()},
    )
    assert r.status_code == 200
    assert len(r.json()) == 1
    assert set(r.json()[0]) == {"desde", "hasta", "estado"}


def test_ocupacion_fuera_de_rango_o_de_otra_cochera_esta_vacia(client, franja):
    cochera = uuid4()
    desde, hasta = franja
    crear(client, cochera, franja)
    params = {"desde": (hasta + timedelta(hours=1)).isoformat(), "hasta": (hasta + timedelta(hours=3)).isoformat()}
    assert client.get(f"/cocheras/{cochera}/ocupacion", params=params).json() == []
    params = {"desde": desde.isoformat(), "hasta": hasta.isoformat()}
    assert client.get(f"/cocheras/{uuid4()}/ocupacion", params=params).json() == []


def test_ocupacion_con_rango_invalido_devuelve_422(client, franja):
    desde, hasta = franja
    r = client.get(f"/cocheras/{uuid4()}/ocupacion", params={"desde": hasta.isoformat(), "hasta": desde.isoformat()})
    assert r.status_code == 422
