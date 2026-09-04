import { useConversations } from '../../queries/useConversations.js';
import { useConversationRoom } from '../../hooks/useConversationRoom.js';
import { useMessageSend } from '../../hooks/useMessageSend.js';
import { useReadReceipts } from '../../hooks/useReadReceipts.js';
import { useSocketStore } from '../../store/socketStore.js';
import { usePresence } from '../../store/presenceStore.js';
import { useIsUserTyping } from '../../store/typingStore.js';
import { ChatHeader } from './ChatHeader.jsx';
import { MessageList } from './MessageList.jsx';
import { MessageInput } from './MessageInput.jsx';
import { EmptyState } from '../ui/EmptyState.jsx';

// PROJECT_SPEC.md M14 tasks 2/3/4 — joins the conversation's socket room
// for as long as it's the one open (useConversationRoom), and wires the
// composer's optimistic send (useMessageSend). Sending is disabled while
// the socket isn't connected or the room join hasn't succeeded yet, with
// the reason surfaced to the composer rather than silently failing a
// send the server was never going to receive.
export function ActiveConversation({ conversationId }) {
  const { data, isLoading } = useConversations();
  const conversation = data?.conversations.find((c) => c._id === conversationId) ?? null;
  const otherParticipant = conversation?.otherParticipant ?? null;

  const connectionStatus = useSocketStore((state) => state.status);
  const { joinError } = useConversationRoom(conversationId);
  const { send, retry } = useMessageSend(conversationId);
  const { online, lastSeenAt } = usePresence(otherParticipant?._id);
  const isOtherTyping = useIsUserTyping(conversationId, otherParticipant?._id);

  // PROJECT_SPEC.md M15 task 4 — mounted regardless of joinError so it
  // still no-ops cleanly (its own effect bails out on a truthy joinError);
  // kept here rather than inside MessageList since it depends on
  // connection/visibility state that has nothing to do with rendering.
  useReadReceipts(conversationId, joinError);

  if (joinError) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <ChatHeader participant={otherParticipant} loading={isLoading} />
        <div className="flex flex-1 items-center justify-center">
          <EmptyState
            title="Couldn't open this conversation"
            description={joinError.message ?? 'You may not have access to this conversation.'}
          />
        </div>
      </div>
    );
  }

  const disabled = connectionStatus !== 'connected';
  const disabledReason = disabled
    ? connectionStatus === 'connecting'
      ? 'Connecting…'
      : 'Reconnecting…'
    : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ChatHeader
        participant={otherParticipant}
        loading={isLoading}
        online={online}
        lastSeenAt={lastSeenAt}
        isTyping={isOtherTyping}
      />
      <MessageList conversationId={conversationId} onRetry={retry} />
      <MessageInput
        conversationId={conversationId}
        onSend={send}
        disabled={disabled}
        disabledReason={disabledReason}
      />
    </div>
  );
}
