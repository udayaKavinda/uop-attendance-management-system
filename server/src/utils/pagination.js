const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Reads `page`/`limit` from a query object. `limit` absent means "no
 * pagination" (`hasLimit: false`) — callers use this to preserve the older
 * return-everything behavior for any client that doesn't ask for a page,
 * so existing callers/tests never see a shape change.
 */
function parsePagination(query = {}) {
  const hasLimit = query.limit !== undefined && query.limit !== '';
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = hasLimit
    ? Math.min(MAX_LIMIT, Math.max(1, parseInt(query.limit, 10) || DEFAULT_LIMIT))
    : DEFAULT_LIMIT;
  return { page, limit, hasLimit };
}

module.exports = { parsePagination, DEFAULT_LIMIT, MAX_LIMIT };
