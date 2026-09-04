import { useState } from 'react';

import { ConversationList } from './ConversationList.jsx';
import { NewConversationPanel } from './NewConversationPanel.jsx';

function PlusIcon(props) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" {...props}>
      <path stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" d="M10 4.5v11M4.5 10h11" />
    </svg>
  );
}

function BackIcon(props) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" {...props}>
      <path
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12.5 15.5 7 10l5.5-5.5"
      />
    </svg>
  );
}

// The "start a conversation" search UI replaces the list in place (task
// 2/3) rather than opening as a separate modal — keeps it inside the same
// pane on both the two-pane desktop layout and the single-pane mobile one,
// with no extra focus-trap/portal machinery to get right.
export function ConversationsPane() {
  const [mode, setMode] = useState('list');

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-line px-4">
        {mode === 'list' ? (
          <>
            <h2 className="text-sm font-semibold text-ink">Conversations</h2>
            <button
              type="button"
              onClick={() => setMode('search')}
              aria-label="New conversation"
              className="flex h-8 w-8 items-center justify-center rounded-md text-ink-muted transition-colors duration-150 hover:bg-surface-sunken hover:text-ink"
            >
              <PlusIcon className="h-4 w-4" />
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setMode('list')}
              aria-label="Back to conversations"
              className="flex h-8 w-8 items-center justify-center rounded-md text-ink-muted transition-colors duration-150 hover:bg-surface-sunken hover:text-ink"
            >
              <BackIcon className="h-4 w-4" />
            </button>
            <h2 className="text-sm font-semibold text-ink">New conversation</h2>
            <span className="h-8 w-8" aria-hidden="true" />
          </>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        {mode === 'list' ? <ConversationList /> : <NewConversationPanel onClose={() => setMode('list')} />}
      </div>
    </div>
  );
}
