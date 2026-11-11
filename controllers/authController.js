const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/User');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function badRequest(res, message) {
  return res.status(400).json({ error: 'Bad Request', message });
}

function publicUser(user) {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
  };
}

/**
 * POST /api/auth/register (public)
 * Creates a user, stores only a bcrypt hash and returns 201.
 */
async function register(req, res, next) {
  try {
    const { name, email, password } = req.body || {};

    if (typeof name !== 'string' || typeof email !== 'string' || typeof password !== 'string') {
      return badRequest(res, 'name, email and password are required.');
    }

    const cleanName = name.trim();
    const cleanEmail = email.trim().toLowerCase();

    if (cleanName.length < 2 || cleanName.length > 80) {
      return badRequest(res, 'Name must contain between 2 and 80 characters.');
    }

    if (!EMAIL_PATTERN.test(cleanEmail)) {
      return badRequest(res, 'Please provide a valid email address.');
    }

    if (password.length < 8 || password.length > 128) {
      return badRequest(res, 'Password must contain between 8 and 128 characters.');
    }

    const existing = await User.findOne({ email: cleanEmail }).lean();
    if (existing) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'A user with this email address already exists.',
      });
    }

    const saltRounds = Math.min(
      15,
      Math.max(10, Number(process.env.BCRYPT_SALT_ROUNDS || 12))
    );
    const passwordHash = await bcrypt.hash(password, saltRounds);

    const user = await User.create({
      name: cleanName,
      email: cleanEmail,
      passwordHash,
    });

    return res.status(201).json({
      message: 'User registered successfully.',
      user: publicUser(user),
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * POST /api/auth/login (public, strict rate limit)
 * Returns { token, user } on success and a generic 401 on failure.
 */
async function login(req, res, next) {
  try {
    const { email, password } = req.body || {};

    if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
      return badRequest(res, 'email and password are required.');
    }

    if (password.length > 128) {
      return badRequest(res, 'Password must contain at most 128 characters.');
    }

    const user = await User.findOne({ email: email.trim().toLowerCase() }).select(
      '+passwordHash'
    );

    if (!user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid email or password.',
      });
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid email or password.',
      });
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      const error = new Error('JWT_SECRET is not configured');
      error.status = 500;
      throw error;
    }

    const signOptions = {
      algorithm: 'HS256',
      expiresIn: process.env.JWT_EXPIRES_IN || '1h',
    };

    if (process.env.JWT_ISSUER) {
      signOptions.issuer = process.env.JWT_ISSUER;
    }

    if (process.env.JWT_AUDIENCE) {
      signOptions.audience = process.env.JWT_AUDIENCE;
    }

    const token = jwt.sign(
      {
        sub: user._id.toString(),
        name: user.name,
        email: user.email,
      },
      secret,
      signOptions
    );

    return res.status(200).json({
      token,
      user: publicUser(user),
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * GET /api/auth/me (JWT or OAuth2 protected)
 * Lets a client verify a token server-side and inspect the resolved identity.
 */
async function me(req, res, next) {
  try {
    if (req.user.provider !== 'jwt') {
      return res.status(200).json({
        user: {
          id: req.user.id,
          name: req.user.name,
          email: req.user.email,
          provider: req.user.provider,
        },
      });
    }

    if (!mongoose.isValidObjectId(req.user.id)) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'The token subject is not a valid user identifier.',
      });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'The user attached to this token no longer exists.',
      });
    }

    return res.status(200).json({
      user: {
        ...publicUser(user),
        provider: 'jwt',
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = { register, login, me };
