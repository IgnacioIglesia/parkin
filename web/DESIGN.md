---
name: ParkIN
description: Cocheras privadas por franja horaria, leídas como un tablero de partidas.
colors:
  acero: "#2a2d31"
  paleta: "#0b0b0d"
  celda: "#17181b"
  costura: "#5b5e63"
  tenue: "#a7aaaf"
  letra: "#f2f2f2"
  ambar: "#ffb000"
  verde: "#3dd68c"
  rojo: "#f0524d"
typography:
  display:
    fontFamily: "Barlow Condensed, Barlow, ui-sans-serif, sans-serif"
    fontSize: "clamp(1.75rem, 9vw, 2.5rem)"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "normal"
  headline:
    fontFamily: "Barlow Condensed, Barlow, ui-sans-serif, sans-serif"
    fontSize: "1.625rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.06em"
  headline-lectura:
    fontFamily: "Barlow, ui-sans-serif, system-ui, sans-serif"
    fontSize: "2rem"
    fontWeight: 600
    lineHeight: 1.25
  title:
    fontFamily: "Barlow Condensed, Barlow, ui-sans-serif, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.06em"
  celda:
    fontFamily: "Barlow Condensed, Barlow, ui-sans-serif, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 600
    lineHeight: 1
  body:
    fontFamily: "Barlow, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  body-tablero:
    fontFamily: "Barlow, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 500
    lineHeight: 1.375
  label:
    fontFamily: "Barlow Condensed, Barlow, ui-sans-serif, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "0.08em"
  button:
    fontFamily: "Barlow Condensed, Barlow, ui-sans-serif, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 700
    lineHeight: 1.5
    letterSpacing: "0.06em"
rounded:
  none: "0px"
  celda: "2px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  gutter: "20px"
  gutter-lg: "24px"
  section: "40px"
  marco: "48px"
components:
  boton-primario:
    backgroundColor: "{colors.ambar}"
    textColor: "{colors.paleta}"
    typography: "{typography.button}"
    rounded: "{rounded.celda}"
    padding: "0.7rem 1.25rem"
  boton-primario-hover:
    backgroundColor: "#ffc340"
    textColor: "{colors.paleta}"
  boton-secundario:
    backgroundColor: "transparent"
    textColor: "{colors.letra}"
    typography: "{typography.button}"
    rounded: "{rounded.celda}"
    padding: "0.7rem 1.25rem"
  boton-secundario-hover:
    backgroundColor: "{colors.paleta}"
    textColor: "{colors.letra}"
  boton-peligro:
    backgroundColor: "transparent"
    textColor: "{colors.rojo}"
    typography: "{typography.button}"
    rounded: "{rounded.celda}"
    padding: "0.7rem 1.25rem"
  boton-inactivo:
    backgroundColor: "transparent"
    textColor: "{colors.tenue}"
    rounded: "{rounded.celda}"
  campo:
    backgroundColor: "{colors.paleta}"
    textColor: "{colors.letra}"
    typography: "{typography.body}"
    rounded: "{rounded.celda}"
    padding: "0.7rem 0.85rem"
  caja:
    backgroundColor: "{colors.celda}"
    textColor: "{colors.letra}"
    rounded: "{rounded.celda}"
    padding: "5px 10px 6px"
  panel:
    backgroundColor: "{colors.paleta}"
    textColor: "{colors.letra}"
    rounded: "{rounded.none}"
  celda:
    backgroundColor: "{colors.celda}"
    textColor: "{colors.letra}"
    typography: "{typography.celda}"
    rounded: "{rounded.celda}"
    width: "0.74em"
    height: "1.16em"
  placa:
    backgroundColor: "{colors.celda}"
    textColor: "{colors.letra}"
    rounded: "{rounded.celda}"
    padding: "4px 9px"
  placa-sel:
    backgroundColor: "{colors.ambar}"
    textColor: "{colors.paleta}"
    rounded: "{rounded.celda}"
    padding: "4px 9px"
  barra-superior:
    backgroundColor: "{colors.paleta}"
    textColor: "{colors.letra}"
    height: "72px"
---

# Design System: ParkIN

## Overview

**Creative North Star: "El Tablero de Partidas"**

ParkIN se lee como el tablero de una terminal: cada cochera y cada reserva es un renglón fijo cuyo código, franja, precio y estado viven en celdas de paleta que se dan vuelta cuando algo cambia. El marco es acero oscuro, los paneles son negro paleta y la información aparece en letra blanca condensada sobre celdas con una bisagra horizontal al medio. El color no decora: ámbar, verde y rojo son señales de estado, y el ámbar además marca la acción primaria y lo que está seleccionado.

La densidad es de instrumento, no de folleto. Las pantallas de trabajo (búsqueda, perfil) llenan la ventana con tablero y mapa, sin aire ornamental; el mapa de OpenStreetMap se oscurece y desatura para quedar como fondo del tablero, y los pines son placas de paleta con el código y el precio. La profundidad es casi toda tonal (acero, paleta, celda) y las esquinas son vivas o apenas suavizadas a 2px. El movimiento tiene un solo gesto propio: el giro de cada celda, en cascada carácter por carácter, que se apaga con `prefers-reduced-motion`.

Lo que el mundo rechaza, confirmado por el contrato de dirección y visible en el build: el mapa blanco con pines de precio redondeados y las cards con foto como unidad de resultado.

**Key Characteristics:**
- Fondo marco de acero, paneles negro paleta, celdas un escalón más claras.
- Datos (códigos, cifras, estados, marca) en celdas de paleta de Barlow Condensed; lectura en Barlow minúscula.
- Tres colores de señal con significado fijo: ámbar, verde, rojo.
- Esquinas a 0 o 2px; separación por costuras de 1px, no por sombras.
- Un único gesto de movimiento: el giro de la celda.

## Colors

Una paleta de acero casi acromático con tres colores de señal saturados que solo aparecen cuando dicen algo.

### Primary
- **Ámbar de Señal** (`ambar`): acción primaria (botón «Buscá», «Ingresá»), selección (fila del tablero con contorno ámbar y fondo ámbar al 10%, placa seleccionada en el mapa), estado retenida/pendiente de pago, cifra de cocheras libres, el «IN» de la marca, foco (`outline` 2px), cursor de texto y selección de texto. También el radio de búsqueda punteado y el punto central del mapa.

### Secondary
- **Verde de Confirmación** (`verde`): solo estados resueltos en positivo: reserva CONFIRMADA, rol «Activo», «Guardado». Siempre como texto en celdas, nunca como fondo.

### Tertiary
- **Rojo de Corte** (`rojo`): reserva cancelada o expirada, errores de campo (borde y texto), avisos de error (fondo rojo al 10% con texto en letra), botón de peligro y el contador «--» del tablero cuando la búsqueda falla.

### Neutral
- **Marco de Acero** (`acero`): fondo de la página (`html`, `body`) y de la columna de formulario en ingreso y registro.
- **Negro Paleta** (`paleta`): barra superior, tablero, paneles, fondo de campos, fondo del mapa y texto sobre ámbar.
- **Celda** (`celda`): fondo de cada celda de paleta, de las cajas de la barra superior, de las placas del mapa, de la fila en hover y del detalle de la cochera elegida.
- **Costura** (`costura`): bordes de campos y botones secundarios, borde punteado de lo inactivo, flecha de la placa y barra de desplazamiento.
- **Acero Claro** (`tenue`): texto secundario, etiquetas, ayudas, hover de bordes y texto de botón inactivo.
- **Letra Blanca** (`letra`): texto principal y caracteres de las celdas.

Costuras finas sin token, observadas en el build: `#1f2024` (borde de barra superior, tablero y panel lateral), `#26282c` (divisorias de sección y de encabezado del tablero), `#1d1e22` (filas del tablero) y `#303237` (borde de la caja en reposo). Placeholder de campo en `#8b8e93`.

### Named Rules
**The Señal Fija Rule.** Cada color de señal tiene un significado y no se presta: ámbar = acción, selección o retenida; verde = confirmada o activo; rojo = cancelada, vencida, ocupada o error. «LIBRE» va en letra blanca, «FINALIZADA» en acero claro. Un color de señal sin estado detrás es un error.

**The Fondo No Compite Rule.** Los fondos son siempre neutros de acero. Los colores de señal aparecen como texto, borde o fondo traslúcido al 10% (fila elegida, aviso de error); el único fondo de señal pleno es el botón primario y la placa seleccionada.

## Typography

**Display Font:** Barlow Condensed (con Barlow, ui-sans-serif)
**Body Font:** Barlow (con ui-sans-serif, system-ui)

**Character:** Barlow Condensed es la letra del tablero: mayúscula, espaciada y en celdas, para códigos, cifras, estados, etiquetas y botones. Barlow es la letra de lectura en minúscula: títulos de cochera, descripciones y ayudas. Ambas se cargan con @fontsource (Barlow 400/500/600; Barlow Condensed 500/600/700).

### Hierarchy
- **Display** (600, `clamp(1.75rem, 9vw, 2.5rem)`, 1): título en celdas de ingreso y registro («INGRESÁ»). El contador de cocheras libres usa la misma voz en celdas a 2.25rem.
- **Headline** (600, 1.625rem, tracking 0.06em, mayúscula): encabezado del tablero («COCHERAS LIBRES»), siempre junto al contador en celdas.
- **Headline de lectura** (Barlow 600, 2rem, 1.25): nombre de la persona en Perfil; título que es un nombre propio, no un dato.
- **Title** (600, 1.25rem, tracking 0.06em, mayúscula): títulos de sección del perfil. El título de la cochera en el detalle usa Barlow 600 a 1.25rem en minúscula.
- **Celda** (600, 1.375rem en filas, 1): caracteres del tablero; 1.25 a 1.5rem en detalle y marca.
- **Body** (Barlow 400, 1rem, 1.5): lectura general; las descripciones largas se limitan con `max-w-prose` o `max-w-md`. En el tablero, 1.0625rem con títulos de cochera en 500.
- **Label** (600, 0.875rem, tracking 0.08em, mayúscula, acero claro): etiquetas de campo y encabezados de columna; 0.75rem dentro de las cajas de la barra.
- **Button** (700, 1.0625rem, tracking 0.06em, mayúscula).

### Named Rules
**The Dato en Celda Rule.** Todo valor que puede cambiar (código, precio, total, contador, estado) se muestra en celdas de paleta con un largo fijo, para que la columna no salte cuando el valor gira. El texto real queda en `sr-only` y las celdas son `aria-hidden`.

**The Minúscula Para Leer Rule.** Lo que se lee de corrido (títulos de cochera, explicaciones, ayudas, errores) va en Barlow minúscula. La mayúscula condensada es para nombrar y etiquetar, no para frases.

## Layout

Grilla de trabajo a pantalla completa con la base de 4px de Tailwind. Márgenes laterales de 20px (24px desde `lg`), filas del tablero con 12px de alto interno, separación entre secciones de 40px y marcos de 48px en el panel lateral de ingreso.

- **Barra superior:** negra, fija arriba, 72px desde `lg` (1024px). Contiene la marca, los controles de la página (la búsqueda se monta por portal: Dónde, Desde, Hasta, Vehículo y «Buscá» en una grilla `1.3fr 1fr 1fr 0.8fr auto`) y la navegación a la derecha. En celular la búsqueda baja a una grilla de dos columnas debajo de la marca.
- **Búsqueda:** desde `lg`, mapa a la izquierda y tablero de 540px a la derecha, ambos a la altura de la ventana menos la barra; el tablero desplaza su lista y fija el encabezado de columnas. En celular, mapa arriba (45vh, mínimo 280px) y tablero debajo; la columna Estado se oculta debajo de `sm` (640px).
- **Ingreso y registro:** desde `lg`, panel negro con tablero de ejemplo a la izquierda y columna de formulario de 440 a 560px sobre acero; el formulario tiene un máximo de 28rem. En celular solo queda la columna de formulario con la marca arriba.
- **Perfil:** columna centrada de 48rem máximo, secciones apiladas y separadas por costura superior.

## Elevation & Depth

El sistema es plano y tonal: la profundidad sale de tres escalones de neutro (acero, paleta, celda) y de costuras de 1px. Las superficies no se levantan al hover; cambian de borde o de fondo. La única sombra vive en el mapa, donde las placas tienen que despegarse de las teselas.

### Shadow Vocabulary
- **Placa sobre mapa** (`box-shadow: 0 3px 10px rgb(0 0 0 / 0.55)`): solo para las placas de cochera sobre el mapa.
- **Anillo de foco de campo** (`box-shadow: 0 0 0 1px` ámbar): engrosa el borde ámbar del campo con foco; no es elevación.

### Named Rules
**The Plano Por Costura Rule.** Un panel se separa de otro por escalón de neutro o costura de 1px, nunca por sombra. La sombra queda reservada para lo que flota sobre el mapa.

## Shapes

Esquinas vivas o casi vivas. Botones, campos, cajas, celdas y placas usan 2px; paneles, filas, tablero, avisos y barra usan 0. La forma propia es la celda de paleta: un rectángulo de 0.74 × 1.16em con una línea negra horizontal al 50% que hace de bisagra; la placa del mapa es lisa (sin bisagra: atravesando una línea de texto se leía como tachado) y termina en una flecha triangular de 6px hacia el punto.

El borde punteado tiene un solo significado: inerte. Lo usan el botón deshabilitado (borde punteado de costura, fondo transparente, texto acero claro) y el campo de solo lectura.

### Named Rules
**The Dos Píxeles Rule.** Ningún radio supera los 2px. Lo redondeado es el mapa blanco que el sistema rechaza.

**The Punteado Es Inerte Rule.** Borde punteado = no se puede tocar ni editar ahora. No se usa como decoración.

## Components

### Buttons
Rotundos y de tablero: mayúscula condensada, sin sombra, cambio de color en 150ms.
- **Shape:** esquina casi viva (2px), borde de 1px.
- **Primary:** fondo ámbar, texto negro paleta, padding 0.7rem × 1.25rem; puede llevar un ícono lucide de 18px a la izquierda. Hover a un ámbar más claro.
- **Secondary:** transparente con borde de costura y texto en letra; al hover, borde acero claro y fondo paleta.
- **Peligro:** transparente, texto rojo, borde rojo al 50%; al hover o foco, fondo rojo al 12% y borde rojo pleno. Va aislado en un panel propio y pide confirmación en el lugar.
- **Disabled:** cualquier variante se vuelve transparente con borde punteado de costura y texto acero claro, con una explicación al lado cuando el motivo no es obvio.
- **Hover / Focus:** foco global con `outline` ámbar de 2px y separación de 2px.
- **Enlace de acción:** texto ámbar, semibold y subrayado (offset 3px), para acciones secundarias dentro de texto («Registrate», «Reintentá»).

### Inputs / Fields
- **Campo:** fondo paleta, borde de costura, 2px, padding 0.7rem × 0.85rem, etiqueta arriba en estilo label. Hover: borde acero claro. Foco: borde ámbar más anillo ámbar de 1px. Error: borde rojo y mensaje rojo a 0.875rem debajo. Solo lectura: texto acero claro y borde punteado. La contraseña lleva un botón de ojo de 48px de ancho dentro del campo.
- **Caja (barra superior):** campo compacto con la etiqueta adentro: fondo celda, borde `#303237`, 2px, padding 5px 10px 6px, etiqueta a 0.75rem. Hover: borde de costura. Foco dentro: borde ámbar. Error: borde rojo.
- **Aviso de error:** bloque sin radio con fondo rojo al 10%, texto en letra y `role="alert"`; en el tablero suma un ícono de alerta rojo y un enlace «Reintentá».

### Navigation
Pestañas de la barra superior: Barlow Condensed 600, 1rem, mayúscula, tracking 0.08em, alto 44px, ícono lucide de 18px. Inactiva en acero claro; hover en letra; activa en letra con un subrayado ámbar de 2px abajo.

### Celdas de paleta (componente firma)
Cada carácter vive en su celda (fondo celda, 2px, bisagra negra al medio, separación de 0.1em). Cuando el carácter cambia, la celda gira desde −95° en X con brillo bajo hasta su lugar, en 300ms con `--ease-salida` (`cubic-bezier(0.16, 1, 0.3, 1)`) y 28ms de retraso por posición, de modo que el valor se escribe en cascada. Si el carácter no cambió, la celda no se mueve. Tonos disponibles: letra, acero claro, ámbar, verde, rojo. Las celdas vacías de relleno mantienen el ancho fijo de la columna. La marca ParkIN es «PARK» en celdas blancas y «IN» en celdas ámbar.

### Tablero
Tabla semántica sobre negro paleta. Encabezado con contador en celdas (dos dígitos, ámbar; rojo y «--» si hay error; «··» mientras busca) y título en headline; debajo, la franja en letra y el resto en acero claro. Columnas Código / Cochera / Por hora / Estado con encabezados en label, encabezado pegajoso, filas separadas por costura de 1px. Hover: fondo celda. Fila seleccionada: fondo ámbar al 10%, contorno ámbar de 1px hacia adentro y código en celdas ámbar. Mientras busca, el cuerpo baja a 50% de opacidad. El detalle de la cochera elegida cierra el tablero sobre fondo celda con código ámbar, total en celdas y el aviso de ubicación aproximada con un candado.

### Placa de mapa
Pin rectangular con código y precio («PO14 · $90») en Barlow Condensed 600 de 15px, fondo celda liso, borde de costura y flecha de 6px. Seleccionada: fondo y borde ámbar con texto paleta; comparte el ámbar con la fila elegida del tablero. Las teselas del mapa se invierten, se desaturan y se oscurecen; pines y controles conservan sus colores.

## Do's and Don'ts

### Do:
- **Do** mostrar todo valor cambiante (código, precio, total, estado, contador) en celdas de paleta con largo fijo y el texto real en `sr-only`.
- **Do** usar ámbar para acción primaria, selección y retenida; verde solo para confirmada o activo; rojo solo para cancelada, vencida, ocupada o error.
- **Do** marcar la selección de una cochera con el mismo ámbar en la fila del tablero y en la placa del mapa.
- **Do** separar superficies por escalón de neutro (acero, paleta, celda) o costura de 1px.
- **Do** mostrar lo inactivo con borde punteado de costura y texto acero claro, y explicar al lado por qué.
- **Do** desactivar el giro de celdas y los vuelos del mapa con `prefers-reduced-motion`.

### Don't:
- **Don't** usar radios mayores a 2px ni pines redondeados.
- **Don't** mostrar el mapa con sus teselas claras originales; siempre pasa por el filtro oscuro del tablero.
- **Don't** usar un color de señal como decoración o como fondo de superficie; la única excepción de fondo pleno es el botón primario y la placa seleccionada.
- **Don't** separar paneles con sombras; la sombra es solo de las placas sobre el mapa.
- **Don't** poner frases de lectura en mayúscula condensada.
