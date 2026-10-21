CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE cochera (
    id                   UUID PRIMARY KEY,
    -- Referencia a Usuarios solo por id (database per service: sin FK).
    propietario_id       UUID NOT NULL,
    titulo               TEXT NOT NULL CHECK (length(titulo) BETWEEN 1 AND 120),
    precio_hora          NUMERIC(10,2) NOT NULL CHECK (precio_hora > 0),
    tipo_vehiculo        TEXT NOT NULL CHECK (tipo_vehiculo IN ('MOTO', 'AUTO', 'CAMIONETA')),
    direccion_exacta     TEXT NOT NULL,
    ubicacion            GEOGRAPHY(Point, 4326) NOT NULL,
    -- Desplazada 100-300 m de la real y fija: es lo único que ve la búsqueda.
    ubicacion_aproximada GEOGRAPHY(Point, 4326) NOT NULL,
    fotos                TEXT[] NOT NULL DEFAULT '{}',
    eliminada_en         TIMESTAMPTZ,
    creada_en            TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizada_en       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX cochera_ubicacion_aproximada_idx ON cochera USING gist (ubicacion_aproximada)
    WHERE eliminada_en IS NULL;
CREATE INDEX cochera_propietario_idx ON cochera (propietario_id) WHERE eliminada_en IS NULL;

-- Disponibilidad semanal en hora de Montevideo. Las horas se guardan en minutos desde
-- la medianoche (0-1440) para poder comparar rangos.
CREATE TABLE franja_disponible (
    cochera_id UUID NOT NULL REFERENCES cochera (id) ON DELETE CASCADE,
    dia_semana SMALLINT NOT NULL CHECK (dia_semana BETWEEN 1 AND 7),
    desde_min  SMALLINT NOT NULL,
    hasta_min  SMALLINT NOT NULL,
    CHECK (desde_min >= 0 AND hasta_min <= 1440 AND desde_min < hasta_min),
    CHECK (desde_min % 30 = 0 AND hasta_min % 30 = 0),
    PRIMARY KEY (cochera_id, dia_semana, desde_min),
    -- Dos franjas del mismo día no pueden solaparse.
    EXCLUDE USING gist (cochera_id WITH =, dia_semana WITH =, int4range(desde_min, hasta_min) WITH &&)
);

-- Conductores con reserva confirmada: son los únicos que ven la dirección exacta.
-- La llena el consumidor de eventos reserva.confirmada / reserva.cancelada.
CREATE TABLE acceso_direccion (
    reserva_id   UUID PRIMARY KEY,
    cochera_id   UUID NOT NULL,
    conductor_id UUID NOT NULL
);

CREATE INDEX acceso_direccion_cochera_conductor_idx ON acceso_direccion (cochera_id, conductor_id);
