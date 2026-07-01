// Floating action button dock — bottom-right stack of round toggles
// for the chat + live-feed overlays. Each button shows an unread badge
// (message / new-match count). Panels slide up ABOVE the dock so both
// stay reachable when open.

import { useOnline } from '../onlineStore';

export default function FabDock(): React.ReactElement {
  const chatOpen = useOnline((s) => s.chatOpen);
  const feedOpen = useOnline((s) => s.liveFeedOpen);
  const toggleChat = useOnline((s) => s.toggleChat);
  const toggleFeed = useOnline((s) => s.toggleLiveFeed);
  const feedCount = useOnline((s) => s.liveFeed.length);
  const chatCount = useOnline((s) => s.chatHistory.length);

  return (
    <div className="fab-dock" aria-label="Chat and live feed">
      <button
        className="fab fab-feed"
        onClick={toggleFeed}
        title={feedOpen ? 'Close live feed' : 'Open live feed'}
        aria-pressed={feedOpen}
      >
        📡
        {!feedOpen && feedCount > 0 && (
          <span className="fab-badge">{feedCount > 99 ? '99+' : feedCount}</span>
        )}
      </button>
      <button
        className="fab fab-chat"
        onClick={toggleChat}
        title={chatOpen ? 'Close chat' : 'Open chat'}
        aria-pressed={chatOpen}
      >
        💬
        {!chatOpen && chatCount > 0 && (
          <span className="fab-badge">{chatCount > 99 ? '99+' : chatCount}</span>
        )}
      </button>
    </div>
  );
}
