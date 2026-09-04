import { useParams } from 'react-router-dom';

import { cx } from '../components/ui/cx.js';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { ConversationsPane } from '../components/conversation/ConversationsPane.jsx';
import { ActiveConversation } from '../components/chat/ActiveConversation.jsx';

// PROJECT_SPEC.md M13 task 5 / FRONTEND.md §18 — two-pane on desktop/tablet,
// single-pane with back-navigation on mobile. The "pane" that's visible on
// mobile is driven entirely by whether a conversationId is in the route:
// no separate conversationId as client-only state, so the active
// conversation stays linkable/refreshable/back-button-able for free.
export function ChatPage() {
  const { conversationId } = useParams();

  return (
    <div className="flex min-h-0 flex-1">
      <aside
        className={cx(
          'w-full max-w-xs shrink-0 flex-col border-r border-line sm:flex',
          conversationId ? 'hidden' : 'flex'
        )}
      >
        <ConversationsPane />
      </aside>
      <section
        className={cx('min-h-0 flex-1 flex-col sm:flex', conversationId ? 'flex' : 'hidden')}
      >
        {conversationId ? (
          <ActiveConversation conversationId={conversationId} />
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState
              title="Select a conversation"
              description="Choose a conversation from the list, or start a new one."
            />
          </div>
        )}
      </section>
    </div>
  );
}
