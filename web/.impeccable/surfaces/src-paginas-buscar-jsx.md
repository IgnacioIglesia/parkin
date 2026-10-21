---
version: 1
slug: "src-paginas-buscar-jsx"
primary_target: "src/paginas/Buscar.jsx"
related_targets: ["src/paginas/Ingresar.jsx","src/paginas/Registro.jsx","src/paginas/Perfil.jsx"]
---

# Surface brief: ParkIN web (shell, auth, búsqueda del conductor)

Scope: app shell, ingreso/registro, perfil y búsqueda en mapa (datos mock de Cocheras). Mode: Operate.
Audience/job: conductor que busca cochera para una franja; propietario que administra; docentes viendo la demo en proyector.
Constraints: voseo uruguayo; legible en proyector; estados de reserva inequívocos; nada recargado; nada que parezca plantilla.
Unresolved: panel del propietario, reserva/pago y notificaciones vivas llegan en el próximo slice dentro de este mismo mundo.

## Direction contract

THESIS: Las pantallas de ParkIN se leen como un tablero de partidas: cada cochera y cada reserva es una fila cuyo código, horario, precio y estado viven en celdas fijas que se dan vuelta cuando cambia algo. Rechaza el mapa blanco con pines de precio y cards con foto.

OWN-WORLD: Fondo marco de acero #2A2D31, paneles negro paleta #0B0B0D, costuras acero medio #5B5E63, texto secundario acero claro #A7AAAF, letra blanca #F2F2F2. Estados encima: ámbar #FFB000 = retenida/pendiente y acción primaria; verde señal #3DD68C = confirmada; rojo #F0524D = cancelada, vencida u ocupada. Barlow Condensed para celdas, códigos y cifras; Barlow para lectura en minúscula. Celdas sin radio o radio 2px.

STORY: El conductor dice dónde y cuándo, ve al instante cuántas cocheras quedan libres en esa franja, elige una por su código en el mapa o en el tablero y entiende el estado sin leer una explicación.

FIRST VIEWPORT: Barra superior negra de 72px: marca ParkIN en celdas, campos Dónde, Desde, Hasta, Vehículo y botón ámbar «Buscá»; usuario a la derecha. Debajo, mapa oscuro a la izquierda (~62%) con pines-placa «PO14 · $90»; a la derecha, tablero de 520px: encabezado «COCHERAS LIBRES · MAR 27 · 09:00–13:00» y filas CÓDIGO / COCHERA / $ POR HORA / DISTANCIA / ESTADO. Fila y pin seleccionados comparten borde ámbar. En celular: mapa arriba (45vh) y tablero debajo.

FORM: Challenger signals-instruments-split-flap-concourse, elegido por la usuaria sobre la dirección asignada (Rambla, 6 de 7 en la lista propia). seed:8696633f265b4cae. Firma: celdas de paleta con giro en cascada carácter por carácter cuando cambia un valor (desactivado con prefers-reduced-motion), tabla semántica debajo.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
