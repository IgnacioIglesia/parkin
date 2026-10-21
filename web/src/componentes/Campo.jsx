import { Eye, EyeOff } from 'lucide-react';
import { useId, useState } from 'react';

// Campo de formulario con etiqueta, ayuda y error asociados para lectores de pantalla.
export function Campo({ etiqueta, ayuda, error, type = 'text', ...props }) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const esClave = type === 'password';
  const describe = [ayuda && `${id}-ayuda`, error && `${id}-error`].filter(Boolean).join(' ') || undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="etiqueta">
        {etiqueta}
      </label>
      <div className="relative">
        <input
          id={id}
          type={esClave && visible ? 'text' : type}
          className={`campo ${esClave ? 'pr-12' : ''}`}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={describe}
          {...props}
        />
        {esClave && (
          <button
            type="button"
            className="absolute inset-y-0 right-0 grid w-12 place-items-center text-tenue hover:text-letra"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
          >
            {visible ? <EyeOff size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}
          </button>
        )}
      </div>
      {ayuda && (
        <p id={`${id}-ayuda`} className="text-sm text-tenue">
          {ayuda}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-sm text-rojo">
          {error}
        </p>
      )}
    </div>
  );
}

export function AvisoError({ children }) {
  if (!children) return null;
  return (
    <p className="bg-rojo/10 px-4 py-3 text-letra" role="alert">
      {children}
    </p>
  );
}
