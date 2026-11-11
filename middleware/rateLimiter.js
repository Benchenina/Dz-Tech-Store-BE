const { rateLimit, MemoryStore } = require('express-rate-limit');

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const WINDOW_MS = positiveNumber(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000);
const GENERAL_MAX = Math.floor(positiveNumber(process.env.RATE_LIMIT_MAX, 100));
const LOGIN_MAX = Math.floor(positiveNumber(process.env.AUTH_RATE_LIMIT_MAX, 5));

const generalStore = new MemoryStore();
const loginStore = new MemoryStore();

function rateLimitHandler(scope, message, windowMs) {
  return (req, res, _next, options) => {
    const resetTime = req.rateLimit && req.rateLimit.resetTime;
    const retryAfter = resetTime
      ? Math.max(1, Math.ceil((new Date(resetTime).getTime() - Date.now()) / 1000))
      : Math.ceil(windowMs / 1000);

    res.set('Retry-After', String(retryAfter));

    return res.status(429).json({
      error: 'Too Many Requests',
      message,
      scope,
      limit: (req.rateLimit && req.rateLimit.limit) || options.limit || options.max,
      remaining: 0,
      retryAfter,
    });
  };
}

/**
 * General API limiter: 100 requests / 15 minutes / IP.
 * Applied to /api/auth and /api/products.
 */
const apiLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: GENERAL_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  store: generalStore,
  handler: rateLimitHandler(
    'api',
    `Too many requests from this IP. The general limit is ${GENERAL_MAX} requests per ${Math.round(
      WINDOW_MS / 60000
    )} minutes.`,
    WINDOW_MS
  ),
});

/**
 * Strict authentication limiter: 5 attempts / 15 minutes / IP.
 * Applied to POST /api/auth/login only.
 */
const loginLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: LOGIN_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  store: loginStore,
  handler: rateLimitHandler(
    'auth',
    `Too many login attempts. The login limit is ${LOGIN_MAX} attempts per ${Math.round(
      WINDOW_MS / 60000
    )} minutes.`,
    WINDOW_MS
  ),
});

/**
 * Development helper used by the dashboard and test-api.sh so that a
 * demonstration of 429 responses does not lock the API for 15 minutes.
 * The route exposing this helper is disabled in production.
 */
function resetRateLimits() {
  generalStore.resetAll();
  loginStore.resetAll();
}

module.exports = {
  apiLimiter,
  loginLimiter,
  resetRateLimits,
  rateLimitConfig: {
    windowMs: WINDOW_MS,
    generalMax: GENERAL_MAX,
    loginMax: LOGIN_MAX,
  },
};
