import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ContextMenuHost } from './components/ContextMenu';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element.');

// The menu host sits beside the app rather than inside it: it also suppresses
// the browser's own menu, which has to hold on every screen — including the
// ones the app returns early for, like the welcome screen.
createRoot(container).render(
  <StrictMode>
    <App />
    <ContextMenuHost />
  </StrictMode>,
);
