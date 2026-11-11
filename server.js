require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const { connectDB, disconnectDB } = require('./config/db');
const { seedIfEmpty } = require('./seed');
const { apiLimiter, resetRateLimits, rateLimitConfig } = require('./middleware/rateLimiter');
const authRoutes = require('./routes/authRoutes');
const productRoutes = require('./routes/productRoutes');

const app = express();
const PORT = Number(process.env.PORT || 5000);
const HOST = process.env.HOST || '0.0.0.0';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/* -------------------------------------------------------------------------- */
/* Serverless-safe database connection                                       */
/* -------------------------------------------------------------------------- */

let databasePromise = null;
let seedPromise = null;
let hasSeeded = false;

async function ensureDatabase() {
  if (mongoose.connection.readyState !== 1) {
    if (!databasePromise) {
      databasePromise = connectDB().finally(() => {
        databasePromise = null;
      });
    }

    await databasePromise;
  }

  if (!hasSeeded && process.env.AUTO_SEED !== 'false') {
    if (!seedPromise) {
      seedPromise = seedIfEmpty({ verbose: false })
        .then(() => {
          hasSeeded = true;
        })
        .finally(() => {
          seedPromise = null;
        });
    }

    await seedPromise;
  }

  return mongoose.connection;
}

async function ensureDatabaseMiddleware(_req, _res, next) {
  try {
    await ensureDatabase();
    next();
  } catch (error) {
    next(error);
  }
}

/* -------------------------------------------------------------------------- */
/* Core middleware                                                            */
/* -------------------------------------------------------------------------- */

app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);

const defaultOrigins = [
  'http://localhost:5000',
  'http://127.0.0.1:5000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

const allowedOrigins = (process.env.CLIENT_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const corsOrigins = allowedOrigins.length > 0 ? allowedOrigins : defaultOrigins;

app.use(
  cors({
    origin(origin, callback) {
      // Requests without an Origin header (curl, Postman, server-to-server)
      // are allowed. Browser origins must be explicitly listed.
      if (!origin || corsOrigins.includes(origin)) {
        return callback(null, true);
      }
      const error = new Error('Not allowed by CORS');
      error.status = 403;
      return callback(error);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
    maxAge: 86400,
  })
);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

app.use((_req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'no-referrer');
  next();
});

/* -------------------------------------------------------------------------- */
/* Health and development helpers (excluded from the general limiter)         */
/* -------------------------------------------------------------------------- */

app.get('/api/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'ENSTA WAMD TD-TP 3 E-Commerce API',
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    rateLimit: {
      generalMax: rateLimitConfig.generalMax,
      loginMax: rateLimitConfig.loginMax,
      windowMinutes: Math.round(rateLimitConfig.windowMs / 60000),
    },
  });
});

if (!IS_PRODUCTION && process.env.DEV_RATE_LIMIT_RESET !== 'false') {
  app.post('/api/dev/reset-rate-limits', (req, res) => {
    // Use the transport address rather than req.ip: when trust proxy is enabled,
    // req.ip could be influenced by a forwarding header.
    const ip = req.socket.remoteAddress || '';
    const isLoopback = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';

    if (!isLoopback) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Rate-limit reset is only available from the loopback interface.',
      });
    }

    resetRateLimits();
    return res.status(200).json({
      message: 'Rate-limit counters reset.',
      resetAt: new Date().toISOString(),
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Rate limited API                                                           */
/* -------------------------------------------------------------------------- */

app.use('/api', apiLimiter);
app.use('/api/auth', ensureDatabaseMiddleware);
app.use('/api/products', ensureDatabaseMiddleware);
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);

/* -------------------------------------------------------------------------- */
/* Static testing dashboard                                                   */
/* -------------------------------------------------------------------------- */

const publicDir = path.join(__dirname, 'public');
app.use(
  express.static(publicDir, {
    index: 'index.html',
    maxAge: IS_PRODUCTION ? '1h' : 0,
  })
);

app.get('/', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

/* -------------------------------------------------------------------------- */
/* 404 and centralized error handling                                         */
/* -------------------------------------------------------------------------- */

app.use('/api', (req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `No API route matches ${req.method} ${req.originalUrl}.`,
  });
});

app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Resource ${req.originalUrl} was not found.`,
  });
});

// eslint-disable-next-line no-unused-vars
app.use((error, _req, res, _next) => {
  if (error.message === 'Not allowed by CORS') {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'This origin is not allowed by the CORS policy.',
    });
  }

  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'Malformed JSON body.',
    });
  }

  if (error.name === 'ValidationError') {
    return res.status(400).json({
      error: 'Validation Error',
      message: 'One or more fields are invalid.',
      details: Object.values(error.errors || {}).map((item) => ({
        field: item.path,
        message: item.message,
      })),
    });
  }

  if (error.name === 'CastError') {
    return res.status(400).json({
      error: 'Bad Request',
      message: `Invalid value for field ${error.path}.`,
    });
  }

  if (error.code === 11000) {
    return res.status(409).json({
      error: 'Conflict',
      message: 'A record with this unique value already exists.',
    });
  }

  const status = Number(error.status) || 500;

  if (status >= 500) {
    console.error('[error]', error);
  }

  return res.status(status).json({
    error: status >= 500 ? 'Internal Server Error' : 'Error',
    message:
      status >= 500 && IS_PRODUCTION
        ? 'An unexpected error occurred.'
        : error.message || 'An unexpected error occurred.',
  });
});

/* -------------------------------------------------------------------------- */
/* Bootstrap                                                                  */
/* -------------------------------------------------------------------------- */

function validateEnvironment() {
  if (!process.env.JWT_SECRET) {
    throw new Error(
      'JWT_SECRET is missing. Copy .env.example to .env and set a strong secret.'
    );
  }

  if (process.env.JWT_SECRET.length < 32) {
    console.warn('[config] JWT_SECRET should contain at least 32 characters.');
  }
}

async function startServer() {
  validateEnvironment();
  await ensureDatabase();

  const server = app.listen(PORT, HOST, () => {
    console.log(`[server] Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`[server] Dashboard:   http://localhost:${PORT}`);
    console.log(`[server] API health:  http://localhost:${PORT}/api/health`);
  });

  const shutdown = (signal) => {
    console.log(`\n[server] ${signal} received, shutting down...`);
    server.close(async () => {
      await disconnectDB();
      process.exit(0);
    });

    setTimeout(() => process.exit(1), 10000).unref();
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  return server;
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error(`[server] Startup failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = app;
module.exports.app = app;
module.exports.startServer = startServer;
module.exports.ensureDatabase = ensureDatabase;
module.exports.default = app;
