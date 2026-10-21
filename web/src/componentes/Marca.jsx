import { Celdas } from './Celdas.jsx';

export function Marca({ className = 'text-2xl' }) {
  return (
    <span className={`inline-flex gap-[0.1em] ${className}`} role="img" aria-label="ParkIN">
      <Celdas texto="Park" decorativo />
      <Celdas texto="IN" tono="ambar" decorativo />
    </span>
  );
}
