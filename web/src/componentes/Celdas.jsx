import { useState } from 'react';

const TONOS = {
  letra: 'text-letra',
  tenue: 'text-tenue',
  ambar: 'text-ambar',
  verde: 'text-verde',
  rojo: 'text-rojo',
};

function Celda({ caracter, indice }) {
  // Cuenta los cambios de carácter (patrón de "estado del render anterior" de React):
  // cada cambio remonta el span con una key nueva y dispara el giro. Si el carácter
  // no cambió, la celda queda quieta aunque el componente se vuelva a renderizar.
  const [visto, setVisto] = useState({ caracter, giros: 0 });
  if (visto.caracter !== caracter) setVisto({ caracter, giros: visto.giros + 1 });

  return (
    <span className="celda">
      <span
        key={visto.giros}
        className={visto.giros > 0 ? 'celda-giro' : undefined}
        style={{ animationDelay: `${indice * 28}ms` }}
      >
        {caracter === ' ' ? ' ' : caracter}
      </span>
    </span>
  );
}

// Texto en celdas de paleta. `largo` fija la cantidad de celdas para que la columna no salte.
// `decorativo` omite el texto para lectores de pantalla cuando el contenedor ya lo nombra.
export function Celdas({ texto, largo, tono = 'letra', decorativo = false, className = '' }) {
  const visible = String(texto ?? '').toUpperCase();
  const caracteres = (largo ? visible.padEnd(largo).slice(0, largo) : visible).split('');

  return (
    <span className={`${TONOS[tono]} ${className}`}>
      {!decorativo && <span className="sr-only">{texto}</span>}
      <span className="celdas" aria-hidden="true">
        {caracteres.map((caracter, i) => (
          <Celda key={i} caracter={caracter} indice={i} />
        ))}
      </span>
    </span>
  );
}
