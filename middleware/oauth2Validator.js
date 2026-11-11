/**
 * Modular OAuth2 / OpenID Connect bearer-token validator.
 *
 * Two validation strategies are supported:
 *  1. Mock tokens (for local demonstrations and automated tests). A token is
 *     mapped to a user profile through OAUTH2_MOCK_TOKENS.
 *  2. OpenID Connect UserInfo endpoint. The opaque access token is sent to
 *     OAUTH2_USERINFO_URL and the returned claims become the authenticated
 *     principal.
 *
 * The module is intentionally isolated from the JWT middleware so a real
 * deployment can replace it with full JWKS/RS256 signature validation without
 * touching the rest of the application.
 */

const isProduction = process.env.NODE_ENV === 'production';

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

const config = {
  enabled: parseBoolean(process.env.OAUTH2_ENABLED, false),
  mockEnabled:
    parseBoolean(process.env.OAUTH2_MOCK_ENABLED, false) &&
    (!isProduction || parseBoolean(process.env.OAUTH2_ALLOW_MOCK_IN_PRODUCTION, false)),
  userInfoUrl: (process.env.OAUTH2_USERINFO_URL || '').trim(),
  timeoutMs: Number(process.env.OAUTH2_TIMEOUT_MS || 5000),
};

/**
 * Accepted formats for OAUTH2_MOCK_TOKENS:
 *   JSON object: {"demo-token": {"sub": "u1", "name": "Demo", "email": "d@x.dz"}}
 *   Pair list:   demo-token=demo@ensta.dz,other-token=other@ensta.dz
 */
function parseMockTokens(raw) {
  const tokens = new Map();
  if (!raw || !raw.trim()) return tokens;

  const value = raw.trim();

  if (value.startsWith('{')) {
    let parsed;
    try {
      parsed = JSON.parse(value);
    } catch (error) {
      console.warn('[oauth2] OAUTH2_MOCK_TOKENS is not valid JSON; mock tokens disabled.');
      return tokens;
    }

    for (const [token, claims] of Object.entries(parsed)) {
      if (typeof claims === 'string') {
        tokens.set(token, { sub: claims, email: claims, name: claims });
      } else if (claims && typeof claims === 'object') {
        tokens.set(token, { ...claims });
      }
    }
    return tokens;
  }

  for (const pair of value.split(',')) {
    const [token, email] = pair.split('=').map((part) => part && part.trim());
    if (token) {
      tokens.set(token, {
        sub: email || token,
        email: email || null,
        name: email ? email.split('@')[0] : 'OAuth2 User',
      });
    }
  }

  return tokens;
}

const mockTokens = parseMockTokens(process.env.OAUTH2_MOCK_TOKENS);

if (isProduction && parseBoolean(process.env.OAUTH2_MOCK_ENABLED, false) && !config.mockEnabled) {
  console.warn('[oauth2] Mock OAuth2 tokens are disabled in production.');
}

if (isProduction && config.mockEnabled) {
  console.warn('[oauth2] WARNING: mock OAuth2 tokens are enabled in production.');
}

function isOAuth2Enabled() {
  return config.enabled;
}

function normalizeProfile(claims, provider = 'oauth2') {
  if (!claims || typeof claims !== 'object') return null;

  const id = claims.sub || claims.id || claims.oid || claims.user_id;
  if (!id) return null;

  return {
    id: String(id),
    name:
      claims.name ||
      claims.preferred_username ||
      claims.given_name ||
      claims.email ||
      'OAuth2 User',
    email: claims.email || null,
    provider,
    claims,
  };
}

async function validateWithUserInfo(token) {
  if (!config.userInfoUrl) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(config.userInfoUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    if (!response.ok) return null;

    const claims = await response.json();
    return normalizeProfile(claims, 'oauth2');
  } catch (error) {
    console.warn(`[oauth2] UserInfo validation failed: ${error.message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Validate an OAuth2/OIDC bearer token.
 * Returns a normalized user object, or null when the token is not accepted.
 */
async function validateOAuth2Token(token) {
  if (!config.enabled || !token) return null;

  if (config.mockEnabled && mockTokens.has(token)) {
    return normalizeProfile(mockTokens.get(token), 'oauth2-mock');
  }

  return validateWithUserInfo(token);
}

module.exports = {
  isOAuth2Enabled,
  validateOAuth2Token,
  // Exported for documentation and unit-level inspection.
  config,
};
