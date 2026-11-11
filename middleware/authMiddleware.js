const jwt = require('jsonwebtoken');
const { isOAuth2Enabled, validateOAuth2Token } = require('./oauth2Validator');

function extractBearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization;
  if (!header || typeof header !== 'string') return null;

  const [scheme, token, ...rest] = header.trim().split(/\s+/);
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token || rest.length > 0) {
    return null;
  }

  return token;
}

function unauthorized(res, message, description) {
  res.set(
    'WWW-Authenticate',
    `Bearer realm="ensta-wamd", error="invalid_token", error_description="${description}"`
  );
  return res.status(401).json({
    error: 'Unauthorized',
    message,
  });
}

/**
 * Authentication middleware.
 *
 * Order of resolution:
 *  1. Local JWT (HS256) signed with JWT_SECRET.
 *  2. OAuth2 / OIDC token through the modular validator (mock or UserInfo).
 *
 * On success the normalized identity is attached to req.user:
 *   { id, name, email, provider: 'jwt' | 'oauth2' | 'oauth2-mock', claims }
 */
async function authenticate(req, res, next) {
  const token = extractBearerToken(req);

  if (!token) {
    return unauthorized(
      res,
      'Authentication required. Provide an Authorization: Bearer <token> header.',
      'missing_token'
    );
  }

  const secret = process.env.JWT_SECRET;

  if (secret) {
    try {
      const verifyOptions = {
        algorithms: ['HS256'],
      };

      if (process.env.JWT_ISSUER) {
        verifyOptions.issuer = process.env.JWT_ISSUER;
      }

      if (process.env.JWT_AUDIENCE) {
        verifyOptions.audience = process.env.JWT_AUDIENCE;
      }

      const decoded = jwt.verify(token, secret, verifyOptions);

      const id = decoded.sub || decoded.id;
      if (id) {
        req.user = {
          id: String(id),
          name: decoded.name || null,
          email: decoded.email || null,
          provider: 'jwt',
          claims: decoded,
        };
        req.authType = 'jwt';
        return next();
      }
    } catch (error) {
      // Continue: the token may be a valid OAuth2/OIDC access token.
    }
  }

  if (isOAuth2Enabled()) {
    try {
      const oauthUser = await validateOAuth2Token(token);
      if (oauthUser) {
        req.user = oauthUser;
        req.authType = oauthUser.provider;
        return next();
      }
    } catch (error) {
      console.warn(`[auth] OAuth2 validation error: ${error.message}`);
    }
  }

  return unauthorized(res, 'Invalid or expired token.', 'invalid_token');
}

module.exports = { authenticate, extractBearerToken };
