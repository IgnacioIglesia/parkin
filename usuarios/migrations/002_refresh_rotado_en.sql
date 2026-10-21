-- Momento en que un refresh token se rotó (null si se revocó por logout o por robo).
-- Permite una ventana de gracia corta: si el navegador no llegó a guardar el token nuevo
-- (recarga o navegación justo durante el refresh), el viejo sigue sirviendo unos segundos.
ALTER TABLE refresh_token ADD COLUMN rotado_en TIMESTAMPTZ;
