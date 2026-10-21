import { Map as IconoMapa, UserRound } from 'lucide-react';
import { createContext, useContext, useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router';
import { useAuth } from '../auth/AuthContext.jsx';
import { Marca } from './Marca.jsx';

// Cada página puede poner sus controles en la barra superior (la búsqueda, por ejemplo) con un portal.
const BarraContext = createContext(null);
export const useBarra = () => useContext(BarraContext);

const enlace = ({ isActive }) =>
  `inline-flex h-11 items-center gap-2 border-b-2 px-3 font-celda text-base font-semibold uppercase tracking-[0.08em] transition-colors ${
    isActive ? 'border-ambar text-letra' : 'border-transparent text-tenue hover:text-letra'
  }`;

export function Shell() {
  const { usuario } = useAuth();
  const [barra, setBarra] = useState(null);

  return (
    <BarraContext.Provider value={barra}>
      <div className="flex min-h-dvh flex-col">
        <header className="sticky top-0 z-[1100] border-b border-[#1f2024] bg-paleta">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 lg:h-[72px] lg:flex-nowrap lg:px-6 lg:py-0">
            <Link to="/buscar" className="shrink-0" aria-label="ParkIN, ir a buscar">
              <Marca />
            </Link>
            <div ref={setBarra} className="order-last w-full lg:order-none lg:w-auto lg:flex-1" />
            <nav className="ml-auto flex items-center gap-1" aria-label="Principal">
              <NavLink to="/buscar" className={enlace} aria-label="Mapa">
                <IconoMapa size={18} aria-hidden="true" />
                <span className="hidden sm:inline">Mapa</span>
              </NavLink>
              <NavLink to="/perfil" className={enlace}>
                <UserRound size={18} aria-hidden="true" />
                <span className="max-w-[12ch] truncate">{usuario.nombre.split(' ')[0]}</span>
              </NavLink>
            </nav>
          </div>
        </header>
        <main className="flex flex-1 flex-col">
          <Outlet />
        </main>
      </div>
    </BarraContext.Provider>
  );
}
