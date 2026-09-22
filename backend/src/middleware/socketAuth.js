const cookie = require("cookie");
const jwt = require("jsonwebtoken");

/**
 * Socket.IO connection middleware.
 *
 * The JWT lives in an HttpOnly cookie (set by /api/auth/signin|signup), so
 * the frontend can't read it and hand it to us via
 * `socket.handshake.auth.token`. Instead, as long as the client connects
 * with `{ withCredentials: true }`, the browser attaches the cookie to the
 * Socket.IO handshake request, and we read it from the raw cookie header
 * here - same token, same secret, same verification as the HTTP
 * authMiddleware.
 *
 * A missing/invalid token does not reject the connection outright (some
 * events, like reading public room info, could be made available to
 * anonymous sockets later) - it just leaves socket.userId unset. Every
 * handler that needs an authenticated user checks `socket.userId` itself.
 */
module.exports = function socketAuth(socket, next) {
  try {
    let token;

    const rawCookieHeader = socket.handshake.headers?.cookie;
    if (rawCookieHeader) {
      token = cookie.parse(rawCookieHeader).accessToken;
    }

    if (!token) return next();

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = payload.userId;

    next();
  } catch (err) {
    console.warn("Socket auth failed:", err.message);
    next();
  }
};
