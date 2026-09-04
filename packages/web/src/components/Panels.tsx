import { useEffect, useState } from 'react';
import { generateSpec } from '@diagram-plus/core/browser';
import { store, useEditorState } from '../store';

/**
 * The bottom drawer: design checks, and a preview of the specification Claude
 * will read. Seeing the spec is what makes the diagram feel like a contract
 * rather than a picture.
 */

export function BottomPanel() {
  const { panel } = useEditorState();
  if (panel === 'validation') return <ValidationPanel />;
  if (panel === 'spec') return <SpecPanel />;
  return null;
}

function ValidationPanel() {
  const { validation } = useEditorState();
  const issues = validation?.issues ?? [];

  return (
    <div className="panel">
      <div className="panel-header">
        <strong>Design checks</strong>
        <span>
          {validation?.errors.length ?? 0} errors · {validation?.warnings.length ?? 0} warnings
        </span>
        <div className="toolbar-spacer" />
        <button className="btn subtle icon" onClick={() => store.setPanel(null)}>
          ×
        </button>
      </div>
      <div className="panel-body">
        {issues.length === 0 ? (
          <p className="hint">Nothing to fix — this diagram is ready to build from.</p>
        ) : (
          issues.map((issue, index) => (
            <div
              key={index}
              className="issue"
              onClick={() => issue.blockId && store.select([issue.blockId])}
            >
              <span className={`badge ${issue.severity}`}>{issue.severity}</span>
              <span className="text">
                {issue.message}
                {issue.hint ? <em>{issue.hint}</em> : null}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function SpecPanel() {
  const { current } = useEditorState();
  const [copied, setCopied] = useState(false);

  const markdown = current ? generateSpec(current, { includeDiagram: false }) : '';

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <div className="panel">
      <div className="panel-header">
        <strong>Implementation spec</strong>
        <span>This is what Claude reads when you ask it to build the project.</span>
        <div className="toolbar-spacer" />
        <button
          className="btn small"
          onClick={() => {
            void navigator.clipboard.writeText(markdown).then(() => setCopied(true));
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button className="btn subtle icon" onClick={() => store.setPanel(null)}>
          ×
        </button>
      </div>
      <div className="panel-body">
        <pre className="spec">{markdown}</pre>
      </div>
    </div>
  );
}
