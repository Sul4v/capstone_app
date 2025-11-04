import { Message } from '@/types';

interface MessageBubbleProps {
  message: Message;
}

function formatTimestamp(timestamp: Date | number): string {
  const date =
    timestamp instanceof Date ? timestamp : new Date(timestamp);
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function MessageBubble({ message }: MessageBubbleProps) {
  if (message.role === 'system') {
    return (
      <div className="flex justify-center my-2">
        <div className="max-w-xs text-center text-xs text-indigo-700 bg-indigo-100/70 px-3 py-2 rounded-full shadow-sm">
          {message.content}
        </div>
      </div>
    );
  }

  const isUser = message.role === 'user';
  const speakerName =
    message.role === 'expert'
      ? message.expertName ?? 'Expert'
      : message.persona === 'concierge'
      ? 'Concierge'
      : 'Expert';

  return (
    <div
      className={`flex ${
        isUser ? 'justify-end' : 'justify-start'
      } mb-4`}
    >
      <div className="max-w-[85%] space-y-1">
        <div
          className={`text-xs font-semibold tracking-wide uppercase ${
            isUser ? 'text-indigo-300 text-right' : 'text-indigo-600'
          }`}
        >
          {isUser ? 'You' : speakerName}
        </div>
        <div
          className={`rounded-2xl px-4 py-3 shadow-sm leading-relaxed ${
            isUser
              ? 'bg-indigo-600 text-white rounded-br-none'
              : 'bg-white text-gray-800 border border-indigo-100 rounded-bl-none'
          }`}
        >
          <p className="text-sm whitespace-pre-wrap">{message.content}</p>
        </div>
        <div
          className={`text-[11px] text-gray-400 ${
            isUser ? 'text-right' : 'text-left'
          }`}
        >
          {formatTimestamp(message.timestamp)}
        </div>
      </div>
    </div>
  );
}
