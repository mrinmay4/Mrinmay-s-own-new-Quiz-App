const jwt = require("jsonwebtoken");

// Reads the JWT from the HttpOnly "accessToken" cookie (set on login) instead
// of an Authorization header. The frontend never needs to see or handle the
// token directly - the browser just sends the cookie automatically.
module.exports = function (req, res, next) {
  const token = req.cookies?.accessToken;

  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId; // keep existing project convention
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
};
