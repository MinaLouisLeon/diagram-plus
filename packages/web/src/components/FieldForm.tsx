import { useState, type ChangeEvent } from 'react';
import type { FieldDescriptor } from '@diagram-plus/core/browser';

/**
 * A form renderer driven by the block catalog.
 *
 * Every block type describes its payload as a list of `FieldDescriptor`s, and
 * this walks that list. `recordList` nests (an endpoint's responses each
 * contain a list of fields), so the renderer recurses.
 */

export interface FieldFormProps {
  fields: FieldDescriptor[];
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}

export function FieldForm({ fields, value, onChange }: FieldFormProps) {
  return (
    <>
      {fields.map((field) => (
        <FieldControl
          key={field.key}
          field={field}
          value={value[field.key]}
          onChange={(next) => onChange({ ...value, [field.key]: next })}
        />
      ))}
    </>
  );
}

interface ControlProps {
  field: FieldDescriptor;
  value: unknown;
  onChange: (next: unknown) => void;
}

function FieldControl({ field, value, onChange }: ControlProps) {
  switch (field.kind) {
    case 'textarea':
      return (
        <Labelled field={field}>
          <textarea
            className="control"
            value={asString(value)}
            placeholder={field.placeholder}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value)}
          />
        </Labelled>
      );

    case 'number':
      return (
        <Labelled field={field}>
          <input
            type="number"
            className="control"
            value={typeof value === 'number' ? value : ''}
            onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
          />
        </Labelled>
      );

    case 'boolean':
      return (
        <div className="field">
          <label className="checkbox">
            <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
            {field.label}
          </label>
          {field.description ? <p className="hint">{field.description}</p> : null}
        </div>
      );

    case 'select':
      return (
        <Labelled field={field}>
          <select className="control" value={asString(value)} onChange={(e) => onChange(e.target.value)}>
            {(field.options ?? []).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </Labelled>
      );

    case 'stringList':
      return <StringList field={field} value={asArray<string>(value)} onChange={onChange} />;

    case 'recordList':
      return (
        <RecordList field={field} value={asArray<Record<string, unknown>>(value)} onChange={onChange} />
      );

    default:
      return (
        <Labelled field={field}>
          <input
            className={`control${field.monospace ? ' mono' : ''}`}
            value={asString(value)}
            placeholder={field.placeholder}
            onChange={(e) => onChange(e.target.value)}
          />
        </Labelled>
      );
  }
}

function Labelled({ field, children }: { field: FieldDescriptor; children: React.ReactNode }) {
  return (
    <div className="field">
      <label>{field.label}</label>
      {children}
      {field.description ? <p className="hint">{field.description}</p> : null}
    </div>
  );
}

function StringList({
  field,
  value,
  onChange,
}: {
  field: FieldDescriptor;
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const update = (index: number, next: string) => {
    const copy = [...value];
    copy[index] = next;
    onChange(copy);
  };

  return (
    <div className="field">
      <label>{field.label}</label>
      <div className="list-rows">
        {value.map((item, index) => (
          <div className="list-row" key={index}>
            <span className="index">{index + 1}</span>
            <input
              className={`control${field.monospace ? ' mono' : ''}`}
              value={item}
              onChange={(e) => update(index, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  const copy = [...value];
                  copy.splice(index + 1, 0, '');
                  onChange(copy);
                }
              }}
            />
            <button
              type="button"
              className="btn subtle icon"
              title={`Remove ${field.itemLabel ?? 'item'}`}
              onClick={() => onChange(value.filter((_, i) => i !== index))}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button type="button" className="add-row" onClick={() => onChange([...value, ''])}>
        + Add {field.itemLabel ?? 'item'}
      </button>
      {field.description ? <p className="hint">{field.description}</p> : null}
    </div>
  );
}

function RecordList({
  field,
  value,
  onChange,
}: {
  field: FieldDescriptor;
  value: Record<string, unknown>[];
  onChange: (next: Record<string, unknown>[]) => void;
}) {
  const [open, setOpen] = useState<number | null>(value.length === 0 ? null : 0);
  const subFields = field.fields ?? [];

  const update = (index: number, next: Record<string, unknown>) => {
    const copy = [...value];
    copy[index] = next;
    onChange(copy);
  };

  const title = (row: Record<string, unknown>, index: number): string => {
    for (const key of ['name', 'label', 'key', 'to', 'path', 'status']) {
      const candidate = row[key];
      if (typeof candidate === 'string' && candidate) return candidate;
      if (typeof candidate === 'number') return String(candidate);
    }
    return `${field.itemLabel ?? 'item'} ${index + 1}`;
  };

  return (
    <div className="field">
      <label>{field.label}</label>
      {value.map((row, index) => (
        <div className="record-card" key={index}>
          <header onClick={() => setOpen(open === index ? null : index)}>
            <span className="chev">{open === index ? '▾' : '▸'}</span>
            <strong>{title(row, index)}</strong>
            <button
              type="button"
              className="btn subtle icon small"
              title={`Remove ${field.itemLabel ?? 'item'}`}
              onClick={(e) => {
                e.stopPropagation();
                onChange(value.filter((_, i) => i !== index));
                setOpen(null);
              }}
            >
              ×
            </button>
          </header>
          {open === index ? (
            <div className="record-body">
              <FieldForm
                fields={subFields}
                value={row}
                onChange={(next) => update(index, next)}
              />
            </div>
          ) : null}
        </div>
      ))}
      <button
        type="button"
        className="add-row"
        onClick={() => {
          onChange([...value, emptyRecord(subFields)]);
          setOpen(value.length);
        }}
      >
        + Add {field.itemLabel ?? 'item'}
      </button>
      {field.description ? <p className="hint">{field.description}</p> : null}
    </div>
  );
}

function emptyRecord(fields: FieldDescriptor[]): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const field of fields) {
    switch (field.kind) {
      case 'boolean':
        record[field.key] = false;
        break;
      case 'number':
        record[field.key] = 0;
        break;
      case 'stringList':
      case 'recordList':
        record[field.key] = [];
        break;
      case 'select':
        record[field.key] = field.options?.[0] ?? '';
        break;
      default:
        record[field.key] = '';
    }
  }
  return record;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value);
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}
