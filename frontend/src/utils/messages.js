// PROJECT_SPEC.md M13 tasks 4/7 — the two pieces of real logic behind the
// message history view, kept as pure functions per TESTING.md §6.

// Each page from useMessages (an infinite query over BACKEND.md §12's
// "load older" endpoint) is newest-first internally, and pages accumulate
// oldest-page-last (page 0 = most recent batch, later pages = older
// batches fetched via "load older"). The chat view wants the opposite:
// oldest message at the top, newest at the bottom — so both the page
// order and each page's internal order get reversed.
export function flattenMessagePages(pages) {
  return [...pages].reverse().flatMap((page) => [...page.messages].reverse());
}

// FRONTEND.md §20 — consecutive messages from the same sender are grouped
// (reduced spacing, metadata shown once) rather than each getting its own
// full timestamp/sender treatment.
const GROUP_WINDOW_MS = 5 * 60 * 1000;

export function isGroupStart(message, previousMessage) {
  if (!previousMessage) return true;
  if (message.senderId !== previousMessage.senderId) return true;
  const gap = new Date(message.createdAt) - new Date(previousMessage.createdAt);
  return gap > GROUP_WINDOW_MS;
}
