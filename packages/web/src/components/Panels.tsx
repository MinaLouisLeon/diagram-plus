import { useEffect, useState } from 'react';
import { BLOCK_CATALOG, buildOrder, diagramStats, generateSpec } from '@diagram-plus/core/browser';
import { separator, showContextMenu } from '../context-menu';
import { blockMenu } from '../menus';
import { store, useEditorState } from '../store';
import { copyText, selectWithin } from '../text-menu';

/**
 * The bottom drawer: design checks, and a preview of the specification Claude
 * will read. Seeing the spec is what makes the diagram feel like a contract
 * rather than a picture.
 */

export function BottomPanel() {
  const { panel } = useEditorState();
  if (panel === 'validation') return <ValidationPanel />;
  if (panel === 'spec') return <SpecPanel />;
  if (panel === 'progress') return <ProgressPanel />;
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
              onContextMenu={(event) =>
                showContextMenu(event, [
                  {
                    label: 'Show on canvas',
                    disabled: !issue.blockId,
                    onSelect: () => issue.blockId && store.select([issue.blockId]),
                  },
                  separator,
                  {
                    label: 'Copy message',
                    onSelect: () =>
                      void copyText(issue.hint ? `${issue.message}
${issue.hint}` : issue.message),
                  },
                ])
              }
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
        <pre
          className="spec"
          onContextMenu={(event) => {
            const selected = window.getSelection()?.toString() ?? '';
            showContextMenu(event, [
              {
                label: 'Copy selection',
                hint: 'Ctrl+C',
                disabled: !selected,
                onSelect: () => void copyText(selected),
              },
              { label: 'Copy whole spec', onSelect: () => void copyText(markdown) },
              separator,
              { label: 'Select all', onSelect: () => selectWithin(event.currentTarget) },
            ]);
          }}
        >
          {markdown}
        </pre>
      </div>
    </div>
  );
}


/**
 * Build order and what has been built.
 *
 * This is the view to leave open while Claude works through the spec: each
 * `mark_block_implemented` call lands here within a second.
 */
function ProgressPanel() {
  const { current } = useEditorState();
  if (!current) return null;

  const stats = diagramStats(current);
  const { phases } = buildOrder(current);

  return (
    <div className="panel">
      <div className="panel-header">
        <strong>Build order</strong>
        <span>
          {stats.implemented} done · {stats.inProgress} in progress · {stats.todo} to do
        </span>
        <div className="toolbar-spacer" />
        <button className="btn subtle icon" onClick={() => store.setPanel(null)}>
          ×
        </button>
      </div>
      <div className="panel-body">
        <div className="progress" style={{ marginBottom: 12 }}>
          <div style={{ width: `${stats.completion}%` }} />
        </div>
        {phases.map((phase) => (
          <div key={phase.index} style={{ marginBottom: 10 }}>
            <div className="section-label" style={{ margin: '0 0 4px' }}>
              {phase.index}. {phase.label}
            </div>
            {phase.blocks.map((block) => (
              <div
                key={block.id}
                className="issue"
                onClick={() => store.select([block.id])}
                onContextMenu={(event) =>
                  showContextMenu(
                    event,
                    blockMenu(current, [block.id], {
                      lead: [{ label: 'Show on canvas', onSelect: () => store.select([block.id]) }],
                    }),
                  )
                }
              >
                <span className={`impl ${block.implementation.status}`} style={{ position: 'static', marginTop: 6 }} />
                <span className="text">
                  {BLOCK_CATALOG[block.type].icon} {block.name}
                  {block.implementation.files.length ? (
                    <em>{block.implementation.files.join(', ')}</em>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
