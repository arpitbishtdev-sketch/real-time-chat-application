// Shared base64-JSON cursor encoding for cursor-based pagination
// (BACKEND.md §12). Each caller defines its own tuple shape (e.g.
// {lastMessageAt, id} for conversations, {createdAt, id} for messages in
// M6) — this util only handles the opaque envelope, not the query logic.

export function encodeCursor(payload) {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCursor(cursor) {
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Cursor payload must be an object.');
    }
    return parsed;
  } catch {
    throw new Error('Malformed pagination cursor.');
  }
}
