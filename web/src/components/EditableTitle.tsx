import { useState } from 'react';

interface Props {
  value: string;
  onSave: (title: string) => Promise<void>;
}

export default function EditableTitle({ value, onSave }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const commit = async () => {
    if (draft === null || saving) return;
    const next = draft.trim();
    if (!next || next === value) { setDraft(null); return; }
    setSaving(true);
    try { await onSave(next); setDraft(null); }
    catch { /* caller reports the error; keep the draft so it can be retried */ }
    finally { setSaving(false); }
  };

  if (draft === null) {
    return (
      <h1>
        <button type="button" className="title-edit" title="点击改名" onClick={() => setDraft(value)}>{value}</button>
      </h1>
    );
  }

  return (
    <h1>
      <input
        className="title-input"
        aria-label="标题"
        autoFocus
        value={draft}
        disabled={saving}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          if (event.key === 'Enter') { event.preventDefault(); void commit(); }
          if (event.key === 'Escape') { event.stopPropagation(); setDraft(null); }
        }}
      />
    </h1>
  );
}
