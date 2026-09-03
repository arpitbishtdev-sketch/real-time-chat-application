import { EmptyState } from '../components/ui/EmptyState.jsx';

// Layout shell only (PROJECT_SPEC.md M11 task 2) — the two-pane structure
// FRONTEND.md §18 describes, with static empty states. No conversation
// data is fetched here; that's M13's useConversations()/useMessages()
// work. The list pane is hidden below the sm breakpoint, matching the
// documented single-pane-with-back-navigation mobile behavior (the actual
// back-navigation state machine is also M13's job, once there's real data
// to navigate between).
export function ChatPage() {
  return (
    <div className="flex min-h-0 flex-1">
      <aside className="hidden w-full max-w-xs shrink-0 flex-col border-r border-line sm:flex">
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">Conversations</h2>
        </div>
        <div className="flex-1 overflow-y-auto">
          <EmptyState
            title="No conversations yet"
            description="Start a conversation with someone to see it here."
          />
        </div>
      </aside>
      <section className="flex min-h-0 flex-1 items-center justify-center">
        <EmptyState
          title="Select a conversation"
          description="Choose a conversation from the list, or start a new one."
        />
      </section>
    </div>
  );
}
