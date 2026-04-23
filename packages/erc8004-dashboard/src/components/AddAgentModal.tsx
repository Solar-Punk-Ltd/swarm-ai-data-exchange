import { useEffect, useRef, useState } from 'react';
import { generateAgentCard, type AgentCard } from '@solarpunk/erc8004-adapter';

interface Props {
  onClose: () => void;
  onSave: (card: AgentCard) => void;
}

export default function AddAgentModal({ onClose, onSave }: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [x402Endpoint, setX402Endpoint] = useState('');
  const [a2aEndpoint, setA2aEndpoint] = useState('');
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [capInput, setCapInput] = useState('');
  const [errors, setErrors] = useState<{ name?: string; description?: string }>({});
  const capInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  function commitCapInput(value: string) {
    const trimmed = value.trim().replace(/,+$/, '');
    if (trimmed && !capabilities.includes(trimmed)) {
      setCapabilities((prev) => [...prev, trimmed]);
    }
    setCapInput('');
  }

  function handleCapKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commitCapInput(capInput);
    } else if (e.key === 'Backspace' && !capInput) {
      setCapabilities((prev) => prev.slice(0, -1));
    }
  }

  function removeCapability(cap: string) {
    setCapabilities((prev) => prev.filter((c) => c !== cap));
    capInputRef.current?.focus();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs: typeof errors = {};
    if (!name.trim()) errs.name = 'Name is required';
    if (!description.trim()) errs.description = 'Description is required';
    if (Object.keys(errs).length) {
      setErrors(errs);
      return;
    }

    const services = [];
    if (x402Endpoint.trim()) services.push({ name: 'x402', endpoint: x402Endpoint.trim() });
    if (a2aEndpoint.trim()) services.push({ name: 'a2a', endpoint: a2aEndpoint.trim() });

    const card = generateAgentCard({
      name: name.trim(),
      description: description.trim(),
      version: '1.0.0',
      ...(imageUrl.trim() && { image: imageUrl.trim() }),
      services,
      x402Support: Boolean(x402Endpoint.trim()),
      capabilities,
      active: true,
    });

    onSave(card);
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.65)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Add Agent"
        style={{
          background: '#1e293b',
          borderRadius: 12,
          padding: '1.75rem',
          width: '100%',
          maxWidth: 520,
          maxHeight: '90vh',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '1.25rem',
          boxShadow: '0 25px 50px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, color: '#f1f5f9' }}>
            Add Agent
          </h2>
          <button onClick={onClose} style={closeBtn} aria-label="Close">
            ✕
          </button>
        </div>

        <form
          onSubmit={handleSubmit}
          style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
        >
          <Field label="Name" required error={errors.name}>
            <input
              autoFocus
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setErrors((p) => ({ ...p, name: undefined }));
              }}
              placeholder="My Agent"
              style={inputStyle(Boolean(errors.name))}
            />
          </Field>

          <Field label="Description" required error={errors.description}>
            <textarea
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                setErrors((p) => ({ ...p, description: undefined }));
              }}
              placeholder="What this agent does…"
              rows={3}
              style={{ ...inputStyle(Boolean(errors.description)), resize: 'vertical' }}
            />
          </Field>

          <Field label="Image URL">
            <input
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://example.com/avatar.png"
              style={inputStyle(false)}
            />
          </Field>

          <Field label="x402 Endpoint">
            <input
              value={x402Endpoint}
              onChange={(e) => setX402Endpoint(e.target.value)}
              placeholder="https://provider.example.com/data"
              style={inputStyle(false)}
            />
          </Field>

          <Field label="A2A Endpoint">
            <input
              value={a2aEndpoint}
              onChange={(e) => setA2aEndpoint(e.target.value)}
              placeholder="https://a2a.example.com"
              style={inputStyle(false)}
            />
          </Field>

          <Field label="Capabilities" hint="Press Enter or comma to add each one">
            <div
              onClick={() => capInputRef.current?.focus()}
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '0.4rem',
                padding: '0.5rem 0.625rem',
                background: '#0f172a',
                borderRadius: 6,
                border: '1px solid #334155',
                minHeight: 42,
                cursor: 'text',
              }}
            >
              {capabilities.map((cap) => (
                <span
                  key={cap}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.3rem',
                    background: '#1a3a2a',
                    color: '#86efac',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    padding: '0.15rem 0.4rem',
                    borderRadius: 4,
                  }}
                >
                  {cap}
                  <button
                    type="button"
                    onClick={() => removeCapability(cap)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#86efac',
                      cursor: 'pointer',
                      padding: 0,
                      lineHeight: 1,
                      fontSize: '0.8rem',
                    }}
                    aria-label={`Remove ${cap}`}
                  >
                    ✕
                  </button>
                </span>
              ))}
              <input
                ref={capInputRef}
                value={capInput}
                onChange={(e) => setCapInput(e.target.value)}
                onKeyDown={handleCapKeyDown}
                onBlur={() => commitCapInput(capInput)}
                placeholder={capabilities.length === 0 ? 'translation, summarization…' : ''}
                style={{
                  background: 'none',
                  border: 'none',
                  outline: 'none',
                  color: '#e2e8f0',
                  fontSize: '0.875rem',
                  minWidth: 80,
                  flex: 1,
                }}
              />
            </div>
          </Field>

          <div
            style={{
              display: 'flex',
              gap: '0.75rem',
              justifyContent: 'flex-end',
              paddingTop: '0.25rem',
            }}
          >
            <button type="button" onClick={onClose} style={cancelBtn}>
              Cancel
            </button>
            <button type="submit" style={saveBtn}>
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  hint,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
      <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#94a3b8' }}>
        {label}
        {required && <span style={{ color: '#f87171', marginLeft: 2 }}>*</span>}
        {hint && (
          <span style={{ fontWeight: 400, color: '#64748b', marginLeft: '0.4rem' }}>{hint}</span>
        )}
      </label>
      {children}
      {error && <span style={{ fontSize: '0.75rem', color: '#f87171' }}>{error}</span>}
    </div>
  );
}

function inputStyle(hasError: boolean): React.CSSProperties {
  return {
    background: '#0f172a',
    border: `1px solid ${hasError ? '#f87171' : '#334155'}`,
    borderRadius: 6,
    padding: '0.5rem 0.625rem',
    color: '#e2e8f0',
    fontSize: '0.875rem',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
  };
}

const closeBtn: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#64748b',
  cursor: 'pointer',
  fontSize: '1rem',
  padding: '0.25rem 0.375rem',
  borderRadius: 4,
};

const cancelBtn: React.CSSProperties = {
  background: 'none',
  border: '1px solid #334155',
  color: '#94a3b8',
  borderRadius: 6,
  padding: '0.5rem 1.25rem',
  fontSize: '0.875rem',
  cursor: 'pointer',
  fontWeight: 600,
};

const saveBtn: React.CSSProperties = {
  background: '#2563eb',
  border: 'none',
  color: '#fff',
  borderRadius: 6,
  padding: '0.5rem 1.5rem',
  fontSize: '0.875rem',
  cursor: 'pointer',
  fontWeight: 600,
};
