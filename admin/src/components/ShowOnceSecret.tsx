import { useState } from 'react';
import {
  TESTID_SHOW_ONCE_SECRET_COPY,
  TESTID_SHOW_ONCE_SECRET_DISMISS,
  TESTID_SHOW_ONCE_SECRET_VALUE,
} from '../testIds';

interface ShowOnceSecretProps {
  title: string;
  description: string;
  value: string;
  /** Omit when there is nowhere meaningful to dismiss to (e.g. a terminal success page). */
  onDismiss?: () => void;
}

/**
 * Prominent, unmissable display for a secret the backend only ever returns
 * once (API key token, invite token/URL, onboarding API key) — the backend
 * stores only a SHA-256 hash, so a value the user navigates away from
 * without copying is permanently lost. Used by every show-once flow in the
 * backoffice and the public onboarding page: this single component is the
 * one place that UX contract is implemented.
 */
export const ShowOnceSecret = ({ title, description, value, onDismiss }: ShowOnceSecretProps) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = (): void => {
    navigator.clipboard
      .writeText(value)
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
  };

  return (
    <div className="show-once-secret" role="alert">
      <p className="show-once-secret__title">{title}</p>
      <p className="show-once-secret__warning">
        Este valor solo se muestra una vez y no puede recuperarse después. Cópialo ahora antes de
        salir de esta página.
      </p>
      <p>{description}</p>
      <div className="show-once-secret__value-row">
        <code data-testid={TESTID_SHOW_ONCE_SECRET_VALUE} className="show-once-secret__value">
          {value}
        </code>
        <button type="button" onClick={handleCopy} data-testid={TESTID_SHOW_ONCE_SECRET_COPY}>
          {copied ? 'Copiado' : 'Copiar'}
        </button>
      </div>
      {onDismiss && (
        <button type="button" onClick={onDismiss} data-testid={TESTID_SHOW_ONCE_SECRET_DISMISS}>
          Ya lo copié, cerrar
        </button>
      )}
    </div>
  );
};
