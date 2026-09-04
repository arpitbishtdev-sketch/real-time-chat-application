import { useConversations } from '../../queries/useConversations.js';
import { ConversationListItem } from './ConversationListItem.jsx';
import { Skeleton } from '../ui/Skeleton.jsx';
import { EmptyState } from '../ui/EmptyState.jsx';
import { Button } from '../ui/Button.jsx';

export function ConversationList() {
  const { data, isLoading, isError, refetch } = useConversations();

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4 px-4 py-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <EmptyState
          title="Couldn't load conversations"
          description="Something went wrong. Check your connection and try again."
          action={
            <Button variant="secondary" onClick={() => refetch()}>
              Retry
            </Button>
          }
        />
      </div>
    );
  }

  const conversations = data?.conversations ?? [];

  if (conversations.length === 0) {
    return (
      <EmptyState
        title="No conversations yet"
        description="Start a conversation with someone to see it here."
      />
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <ul className="flex flex-col divide-y divide-line">
        {conversations.map((conversation) => (
          <li key={conversation._id}>
            <ConversationListItem conversation={conversation} />
          </li>
        ))}
      </ul>
    </div>
  );
}
