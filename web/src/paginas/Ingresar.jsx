import { useState } from 'react';
import { Link } from 'react-router';
import { mensajeDeError } from '../api/errores.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { AvisoError, Campo } from '../componentes/Campo.jsx';
import { MarcoAuth } from '../componentes/MarcoAuth.jsx';

export function Ingresar() {
  const { ingresar } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);

  const enviar = async (e) => {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    try {
      await ingresar(email, password);
      // SoloAnonimo redirige a donde iba la persona.
    } catch (err) {
      setError(mensajeDeError(err));
      setEnviando(false);
    }
  };

  return (
    <MarcoAuth titulo="Ingresá">
      <p className="mt-4 text-lg text-tenue">Con la misma cuenta buscás cocheras y administrás las tuyas.</p>
      <form className="mt-8 flex flex-col gap-5" onSubmit={enviar}>
        <Campo
          etiqueta="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <Campo
          etiqueta="Contraseña"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <AvisoError>{error}</AvisoError>
        <button type="submit" className="boton boton-primario mt-1" disabled={enviando}>
          {enviando ? 'Ingresando…' : 'Ingresá'}
        </button>
      </form>
      <p className="mt-8 text-tenue">
        ¿No tenés cuenta?{' '}
        <Link to="/registro" className="font-semibold text-ambar underline">
          Registrate
        </Link>
      </p>
    </MarcoAuth>
  );
}
