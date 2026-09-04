import { useConversations } from '../../queries/useConversations.js';
import { ChatHeader } from './ChatHeader.jsx';
import { MessageList } from './MessageList.jsx';

export function ActiveConversation({ conversationId }) {
  const { data, isLoading } = useConversations();
  const conversation = data?.conversations.find((c) => c._id === conversationId) ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ChatHeader participant={conversation?.otherParticipant ?? null} loading={isLoading} />
      <MessageList conversationId={conversationId} />
    </div>
  );
}
