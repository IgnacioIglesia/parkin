import { Navigate, Outlet, useLocation } from 'react-router';
import { Celdas } from '../componentes/Celdas.jsx';
import { useAuth } from './AuthContext.jsx';

function PantallaCarga() {
  return (
    <div className="grid min-h-dvh place-items-center bg-paleta" role="status">
      <Celdas texto="Cargando" className="text-3xl text-tenue" />
    </div>
  );
}

export function RutaPrivada({ rol }) {
  const { estado, usuario } = useAuth();
  const location = useLocation();

  if (estado === 'cargando') return <PantallaCarga />;
  if (estado === 'anonimo') return <Navigate to="/ingresar" replace state={{ desde: location.pathname }} />;
  if (rol && !usuario.roles.includes(rol)) return <Navigate to="/perfil" replace />;
  return <Outlet />;
}

export function SoloAnonimo() {
  const { estado } = useAuth();
  const location = useLocation();

  if (estado === 'cargando') return <PantallaCarga />;
  if (estado === 'autenticado') return <Navigate to={location.state?.desde ?? '/buscar'} replace />;
  return <Outlet />;
}
