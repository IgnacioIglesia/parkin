import { Navigate, Route, Routes } from 'react-router';
import { RutaPrivada, SoloAnonimo } from './auth/Rutas.jsx';
import { Shell } from './componentes/Shell.jsx';
import { Buscar } from './paginas/Buscar.jsx';
import { Ingresar } from './paginas/Ingresar.jsx';
import { NoEncontrada } from './paginas/NoEncontrada.jsx';
import { Perfil } from './paginas/Perfil.jsx';
import { Registro } from './paginas/Registro.jsx';

export function App() {
  return (
    <Routes>
      <Route element={<SoloAnonimo />}>
        <Route path="/ingresar" element={<Ingresar />} />
        <Route path="/registro" element={<Registro />} />
      </Route>
      <Route element={<RutaPrivada />}>
        <Route element={<Shell />}>
          <Route path="/buscar" element={<Buscar />} />
          <Route path="/perfil" element={<Perfil />} />
        </Route>
      </Route>
      <Route path="/" element={<Navigate to="/buscar" replace />} />
      <Route path="*" element={<NoEncontrada />} />
    </Routes>
  );
}
