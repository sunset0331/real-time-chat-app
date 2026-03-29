const jwt = require('jsonwebtoken');

const signToken = (user) => {
  const jwtSecret = process.env.JWT_SECRET;

  if (!jwtSecret) {
    throw new Error('JWT_SECRET is not set in environment variables');
  }

  return jwt.sign(
    {
      sub: user._id.toString(),
      username: user.username,
      displayName: user.displayName,
    },
    jwtSecret,
    { expiresIn: '7d' },
  );
};

const verifyToken = (token) => {
  const jwtSecret = process.env.JWT_SECRET;

  if (!jwtSecret) {
    throw new Error('JWT_SECRET is not set in environment variables');
  }

  return jwt.verify(token, jwtSecret);
};

const requireAuth = (req, res, next) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;

  if (!token) {
    return res.status(401).json({ error: 'Missing auth token' });
  }

  try {
    req.auth = verifyToken(token);
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

module.exports = {
  signToken,
  verifyToken,
  requireAuth,
};
