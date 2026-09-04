import { useEffect, useLayoutEffect, useRef } from 'react';

import { useMessages } from '../../queries/useMessages.js';
import { useAuthStore } from '../../store/authStore.js';
import { flattenMessagePages, isGroupStart } from '../../utils/messages.js';
import { MessageBubble } from './MessageBubble.jsx';
import { Skeleton } from '../ui/Skeleton.jsx';
import { EmptyState } from '../ui/EmptyState.jsx';
import { Button } from '../ui/Button.jsx';

// PROJECT_SPEC.md M13 task 4 — cursor-paginated "load older" history.
// Scroll handling: on first load (or switching conversations) the view
// jumps to the newest message at the bottom; after "load older" it holds
// the reader's position on the messages they were already looking at,
// rather than the browser's default of resetting scrollTop to 0 when
// content is prepended above the viewport.
export function MessageList({ conversationId }) {
  const currentUserId = useAuthStore((state) => state.user?._id);
  const { data, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useMessages(conversationId);

  const containerRef = useRef(null);
  const prevScrollHeightRef = useRef(null);
  const isFirstLoadRef = useRef(true);

  useEffect(() => {
    isFirstLoadRef.current = true;
  }, [conversationId]);

  const messages = data ? flattenMessagePages(data.pages) : [];

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    if (prevScrollHeightRef.current !== null) {
      el.scrollTop = el.scrollHeight - prevScrollHeightRef.current;
      prevScrollHeightRef.current = null;
    } else if (isFirstLoadRef.current && messages.length > 0) {
      el.scrollTop = el.scrollHeight;
      isFirstLoadRef.current = false;
    }
  }, [messages.length]);

  function handleLoadOlder() {
    prevScrollHeightRef.current = containerRef.current?.scrollHeight ?? null;
    fetchNextPage();
  }

  if (isLoading) {
    return (
      <div className="flex flex-1 flex-col justify-end gap-2 px-4 py-4">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-10 w-1/2 self-end" />
        <Skeleton className="h-10 w-3/5" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <EmptyState
          title="Couldn't load messages"
          description="Something went wrong loading this conversation."
          action={
            <Button variant="secondary" onClick={() => refetch()}>
              Retry
            </Button>
          }
        />
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <EmptyState
          title="No messages yet"
          description="This conversation doesn't have any messages yet."
        />
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto px-4 py-4">
      {hasNextPage && (
        <div className="mb-3 flex justify-center">
          <Button
            variant="secondary"
            size="sm"
            onClick={handleLoadOlder}
            loading={isFetchingNextPage}
          >
            Load older messages
          </Button>
        </div>
      )}
      <div className="flex flex-col">
        {messages.map((message, index) => (
          <MessageBubble
            key={message._id}
            message={message}
            isOwn={message.senderId === currentUserId}
            groupStart={isGroupStart(message, messages[index - 1] ?? null)}
          />
        ))}
      </div>
    </div>
  );
}
