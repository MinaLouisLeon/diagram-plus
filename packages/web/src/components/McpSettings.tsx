import { useCallback, useEffect, useState } from 'react';
import {
  mcp,
  project,
  useProject,
  type McpReport,
  type McpScope,
  type McpStatus,
} from '../desktop';

/**
 * Registering the MCP server with the AI tools on this machine.
 *
 * The same job `npm run install-mcp` does in a terminal, and it writes the same
 * entries — this is the version for people who installed the app and never
 * cloned the repository.
 */

const ACTION_LABELS: Record<string, string> = {
  added: 'registered',
  updated: 'updated',
  unchanged: 'already set up',
  removed: 'removed',
  absent: 'was not registered',
  skipped: 'skipped',
  failed: 'failed',
};

export function McpSettings({ onClose }: { onClose: () => void }) {
  const { root } = useProject();
  const [scope, setScope] = useState<McpScope>('global');
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [report, setReport] = useState<McpReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(
    async (next: McpScope) => {
      setError(null);
      try {
        const status = await mcp.status(next);
        setStatus(status);
        // Tick what is already installed, plus anything detected — the same
        // default the terminal installer offers.
        setChosen(
          new Set(
            status.clients
              .filter((c) => c.target && (c.installed || c.detected))
              .map((c) => c.id),
          ),
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [],
  );

  useEffect(() => {
    void refresh(scope);
  }, [scope, refresh]);

  const toggle = (id: string) => {
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const run = async (remove: boolean) => {
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      const ids = [...chosen];
      const result = remove ? await mcp.uninstall(scope, ids) : await mcp.install(scope, ids);
      setReport(result);
      await refresh(scope);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const available = status?.clients.filter((c) => c.target) ?? [];
  const unavailable = status?.clients.filter((c) => !c.target) ?? [];

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal wide" onClick={(event) => event.stopPropagation()}>
        <header>Connect your AI tools</header>
        <div className="modal-body">
        <p className="modal-lead">
          Registers diagram-plus as an MCP server, so Claude Code and friends can design and read
          these diagrams. Existing servers are left alone, and any file that changes is backed up
          first.
        </p>

        <div className="scope-choice">
          <label className={scope === 'global' ? 'selected' : ''}>
            <input
              type="radio"
              checked={scope === 'global'}
              onChange={() => setScope('global')}
            />
            <div>
              <strong>Every project on this machine</strong>
              <span>
                Writes your user config. Terminal tools then pick up the diagrams of whichever
                project you run them in.
              </span>
            </div>
          </label>
          <label className={scope === 'local' ? 'selected' : ''}>
            <input type="radio" checked={scope === 'local'} onChange={() => setScope('local')} />
            <div>
              <strong>This project only</strong>
              <span>
                Writes config files into the open project, so anyone who clones it gets the server
                too.
              </span>
            </div>
          </label>
        </div>

        {scope === 'local' && !root ? (
          <p className="notice warning">Open a project folder first — a local install writes into it.</p>
        ) : null}

        {status && !status.nodePath ? (
          <p className="notice warning">
            Node.js was not found on this machine. The MCP server runs on Node 20 or newer — install
            it from nodejs.org, then reopen this window.
          </p>
        ) : null}

        {error ? <p className="notice error">{error}</p> : null}

        {status ? (
          <>
            <ul className="client-list">
              {available.map((client) => (
                <li key={client.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={chosen.has(client.id)}
                      onChange={() => toggle(client.id)}
                    />
                    <div className="client-text">
                      <strong>
                        {client.label}
                        {client.installed ? <em className="tag ok">connected</em> : null}
                        {!client.installed && client.detected ? (
                          <em className="tag">found</em>
                        ) : null}
                      </strong>
                      <span title={client.target ?? ''}>{client.target}</span>
                    </div>
                  </label>
                </li>
              ))}
            </ul>

            {unavailable.length ? (
              <p className="muted small">
                No {scope} config for {unavailable.map((c) => c.label).join(', ')}.
              </p>
            ) : null}

            <details className="server-detail">
              <summary>What gets registered</summary>
              <pre>
                {JSON.stringify(
                  {
                    command: status.nodePath ?? 'node',
                    args: [status.serverEntry],
                    ...(root ? { env: { DIAGRAM_PLUS_ROOT: root } } : {}),
                  },
                  null,
                  2,
                )}
              </pre>
              <p className="muted small">
                Desktop apps get <code>DIAGRAM_PLUS_ROOT</code> baked in because they have no
                working directory to infer a project from. Terminal tools are left without it, so
                one install works everywhere.
                {status.nodeVersion ? ` Using Node ${status.nodeVersion}.` : ''}
              </p>
            </details>
          </>
        ) : (
          <p className="muted">Looking for installed tools…</p>
        )}

        {report ? (
          <div className="report">
            <ul>
              {report.results.map((result) => (
                <li key={result.clientId} className={result.action}>
                  <strong>{result.label}</strong> — {ACTION_LABELS[result.action] ?? result.action}
                  {result.detail ? <span>{result.detail}</span> : null}
                </li>
              ))}
            </ul>
            {report.backups.length ? (
              <p className="muted small">
                Backed up {report.backups.length} file{report.backups.length === 1 ? '' : 's'} first.
              </p>
            ) : null}
          </div>
        ) : null}

        </div>

        <footer>
          <button
            className="btn subtle"
            onClick={() => void project.revealDiagramsFolder()}
            disabled={!root}
            title="Open the .diagrams folder"
          >
            Show diagrams folder
          </button>
          <div className="toolbar-spacer" />
          <button className="btn subtle" onClick={onClose}>
            Close
          </button>
          <button
            className="btn"
            onClick={() => void run(true)}
            disabled={busy || chosen.size === 0}
          >
            Disconnect
          </button>
          <button
            className="btn primary"
            onClick={() => void run(false)}
            disabled={busy || chosen.size === 0 || (scope === 'local' && !root)}
          >
            {busy ? 'Working…' : 'Connect'}
          </button>
        </footer>
      </div>
    </div>
  );
}
