import { Navigate, Route, Routes } from 'react-router';
import { RutaPrivada, SoloAnonimo } from './auth/Rutas.jsx';
import { Shell } from './componentes/Shell.jsx';
import { Buscar } from './paginas/Buscar.jsx';
import { Cochera } from './paginas/Cochera.jsx';
import { EditarCochera } from './paginas/EditarCochera.jsx';
import { Ingresar } from './paginas/Ingresar.jsx';
import { MisCocheras } from './paginas/MisCocheras.jsx';
import { NoEncontrada } from './paginas/NoEncontrada.jsx';
import { Perfil } from './paginas/Perfil.jsx';
import { Registro } from './paginas/Registro.jsx';
import { Reserva } from './paginas/Reserva.jsx';
import { Reservas } from './paginas/Reservas.jsx';

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
          <Route path="/cocheras/:id" element={<Cochera />} />
          <Route path="/reservas" element={<Reservas />} />
          <Route path="/reservas/:id" element={<Reserva />} />
          <Route path="/perfil" element={<Perfil />} />
          <Route element={<RutaPrivada rol="PROPIETARIO" />}>
            <Route path="/mis-cocheras" element={<MisCocheras />} />
            <Route path="/mis-cocheras/nueva" element={<EditarCochera />} />
            <Route path="/mis-cocheras/:id" element={<EditarCochera />} />
          </Route>
        </Route>
      </Route>
      <Route path="/" element={<Navigate to="/buscar" replace />} />
      <Route path="*" element={<NoEncontrada />} />
    </Routes>
  );
}
