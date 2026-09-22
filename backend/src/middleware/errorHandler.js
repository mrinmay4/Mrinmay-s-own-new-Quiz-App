/**
 * Centralized Express error handling.
 *
 * Individual routes already catch their own expected errors (bad input,
 * not found, etc). These two handlers are a safety net:
 *   - notFoundHandler: any request that doesn't match a route
 *   - errorHandler: anything a route handler throws/passes to next(err)
 *     without catching itself
 *
 * Neither ever sends a raw error message or stack trace to the client -
 * that's logged server-side only.
 */

function notFoundHandler(req, res) {
  res.status(404).json({ error: "Not found" });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
}

module.exports = { notFoundHandler, errorHandler };
