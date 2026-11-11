# ENSTA WAMD - TD-TP 3

## Build an E-Commerce Backend: REST API with Node.js, Express.js, MongoDB, JWT, OAuth2 and Rate Limiting

**Module:** Web Application Development (WAMD)  
**Institution:** ENSTA  
**Project:** Full-stack academic implementation with a minimalist API testing dashboard

---

## Table of contents

1. [Introduction and objectives](#1-introduction-and-objectives)
2. [Functional scope](#2-functional-scope)
3. [Technology stack](#3-technology-stack)
4. [Architecture and project structure](#4-architecture-and-project-structure)
5. [Data models](#5-data-models)
6. [REST API specification](#6-rest-api-specification)
7. [JWT authentication](#7-jwt-authentication)
8. [OAuth2 and OpenID Connect support](#8-oauth2-and-openid-connect-support)
9. [Security middleware and rate limiting](#9-security-middleware-and-rate-limiting)
10. [Configuration, installation and data seeding](#10-configuration-installation-and-data-seeding)
11. [Testing and demonstration](#11-testing-and-demonstration)
12. [Results, discussion and conclusion](#12-results-discussion-and-conclusion)
- [Appendix A - Environment variables](#appendix-a---environment-variables)
- [Appendix B - Troubleshooting](#appendix-b---troubleshooting)
- [References](#references)

---

## 1. Introduction and objectives

This project implements the complete backend of a small e-commerce application for the
ENSTA WAMD TD-TP 3. The API exposes a product catalogue and a user authentication system.
It is written in Node.js with Express.js and MongoDB (through Mongoose). Protected write
operations use JSON Web Tokens. The authentication middleware also supports OAuth2 /
OpenID Connect bearer tokens through a separate, replaceable validator. Finally, the API
is protected by two rate limiters and is delivered with a browser-based dashboard that
demonstrates every requirement interactively.

The API is consumed by two clients:

- The built-in testing dashboard served at `http://localhost:5000/`.
- The **DZ Tech Store** React + Redux storefront located at
  `/home/meheni/Music/dz-tech-store`, running at `http://localhost:5173/`.

The React client fetches the seeded catalogue, registers and logs in users, stores the JWT
in `localStorage`, and sends it as a Bearer token when creating products from the admin form.

The objectives of the TD-TP are the following:

- Design a layered REST API with clear separation between routes, middleware,
  controllers, models and configuration.
- Store users and products in MongoDB with schema validation and timestamps.
- Hash passwords with bcrypt and never return password hashes to clients.
- Issue and verify JWT access tokens with a configurable secret, issuer, audience and
  expiration time.
- Protect create, update and delete product operations while leaving reads public.
- Provide modular bearer-token validation for OAuth2 / OpenID Connect testing, including
  a deterministic mock mode for laboratories.
- Apply a general API limiter (100 requests per 15 minutes) and a strict login limiter
  (5 attempts per 15 minutes) with a custom JSON `429` response.
- Configure CORS, JSON parsing and centralized error handling.
- Seed realistic sample data for immediate testing.
- Provide a clean, rounded, emoji-free dashboard and an automated curl test script.

### 1.1 Pedagogical outcomes

At the end of the project, the following concepts are implemented and observable:

1. HTTP semantics: methods, status codes, headers, idempotence and resource identifiers.
2. MongoDB document modelling with Mongoose schemas, indexes and validation.
3. Password storage with a salted adaptive hash.
4. Stateless authentication with signed tokens and claim validation.
5. Authorization middleware and access-control boundaries.
6. OAuth2 / OIDC bearer-token integration and the difference between signed JWTs and
   opaque access tokens.
7. Abuse prevention through rate limiting, standard rate-limit headers and `429` handling.
8. Browser/server integration through CORS and a static single-page client.
9. Automated API testing with shell, curl and JSON assertions.

---

## 2. Functional scope

### 2.1 User stories

| Actor | Need | Result |
|---|---|---|
| Visitor | Browse the catalogue | Public `GET /api/products` and `GET /api/products/:id` |
| Visitor | Create an account | `POST /api/auth/register` with validation and duplicate protection |
| Registered user | Sign in and obtain a token | `POST /api/auth/login` returning `{ token, user }` |
| Registered user | Verify an existing token | `GET /api/auth/me` through the authentication middleware |
| Registered user | Manage products | Protected `POST`, `PUT` and `DELETE` endpoints |
| OAuth2 client | Access protected routes | Bearer token accepted by the modular OAuth2 validator |
| Administrator / tester | Observe abuse protection | Dashboard stress tester and `test-api.sh` |

### 2.2 Out of scope

The TD-TP focuses on the backend. The following features are intentionally excluded:

- Payment processing and order management.
- Refresh tokens and token revocation lists.
- Role-based access control (all authenticated users can manage products).
- Product image upload (the model stores an image URL).
- Pagination, full-text search and server-side filtering.
- A production OIDC provider with JWKS signature validation.

These exclusions are discussed in section 12.

---

## 3. Technology stack

| Layer | Technology | Version | Role |
|---|---|---|---|
| Runtime | Node.js | >= 18 | JavaScript server runtime and global `fetch` |
| HTTP framework | Express.js | 4.x | Routing, middleware pipeline and static files |
| Database | MongoDB | 7.x | Document store |
| ODM | Mongoose | 8.x | Schemas, validation, indexes and queries |
| Configuration | dotenv | 16.x | Loading `.env` into `process.env` |
| CORS | cors | 2.x | Browser origin allowlist and preflight handling |
| Password hashing | bcryptjs | 2.4.x | Salted password hashing |
| Tokens | jsonwebtoken | 9.x | JWT signing and verification (HS256) |
| Rate limiting | express-rate-limit | 7.x | In-memory request counters and standard headers |
| Development | nodemon | 3.x | Automatic restart during development |
| Frontend | HTML, CSS, vanilla JavaScript | - | Single-page testing dashboard |
| Icons | Inline SVG | - | Vector icons without an external dependency |

No frontend framework or build tool is required. The dashboard is served directly by
Express from `public/`.

---

## 4. Architecture and project structure

### 4.1 Request pipeline

```text
Browser dashboard (public/)
        |
        | HTTP + JSON + Authorization: Bearer <token>
        v
Express application (server.js)
        |
        +--> CORS allowlist
        +--> express.json() and express.urlencoded()
        +--> security response headers
        +--> /api/health (excluded from the general limiter)
        +--> /api/dev/reset-rate-limits (development, loopback only)
        +--> general API limiter (100 requests / 15 minutes)
        |
        +--> /api/auth
        |       +--> POST /register --> authController.register
        |       +--> POST /login    --> login limiter --> authController.login
        |       +--> GET  /me       --> authMiddleware --> authController.me
        |
        +--> /api/products
                +--> public reads  --> productController
                +--> protected writes --> authMiddleware --> productController
        |
        +--> express.static(public)
        +--> JSON 404 handler
        +--> centralized error handler
        |
        v
Mongoose models (User, Product)
        |
        v
MongoDB (ensta_wamd_tp3)
```

### 4.2 Directory layout

```text
.
├── config/
│   └── db.js                     MongoDB connection and disconnection helpers
├── controllers/
│   ├── authController.js         Register, login and identity verification
│   └── productController.js      Product validation and CRUD logic
├── middleware/
│   ├── authMiddleware.js         Bearer extraction, JWT verification, OAuth2 fallback
│   ├── oauth2Validator.js        Mock and OIDC UserInfo token validation
│   └── rateLimiter.js            General and login limiters, custom 429 JSON
├── models/
│   ├── Product.js                Product schema and indexes
│   └── User.js                   User schema, unique email and hash protection
├── routes/
│   ├── authRoutes.js             Authentication routes
│   └── productRoutes.js          Product routes and protection points
├── public/
│   ├── index.html                Dashboard markup and inline SVG icon system
│   ├── style.css                 Slate design system, dark and light themes
│   └── app.js                    Authentication, catalogue and stress-tester logic
├── .env.example                  Documented environment template
├── .gitignore                    Excludes node_modules, .env and logs
├── package.json                  Dependencies and npm scripts
├── package-lock.json             Reproducible dependency tree
├── seed.js                       Sample catalogue and idempotent seeding
├── server.js                     Express bootstrap, middleware and error handling
├── test-api.sh                   Automated curl verification (62 assertions)
└── README.md                     This academic documentation
```

### 4.3 Design principles

- **Single responsibility.** Routes define URLs, middleware handles cross-cutting
  concerns, controllers contain business logic, models define persistence.
- **Defence in depth.** Input is validated in the controller, again by Mongoose, and the
  HTTP request body is size limited.
- **Least disclosure.** Login failures are intentionally generic. Password hashes are
  excluded from queries by default and removed from JSON output.
- **Replaceable authentication.** OAuth2 validation lives in its own module, so the
  strategy can be replaced without modifying controllers or product routes.
- **Observable behaviour.** Health data, rate-limit headers, structured errors and a
  request log make the API easy to demonstrate and grade.

---

## 5. Data models

### 5.1 User model (`models/User.js`)

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `name` | String | Required, trimmed, 2 to 80 characters | Display name |
| `email` | String | Required, unique, lowercase, trimmed, valid email pattern | Login identifier |
| `passwordHash` | String | Required, `select: false` | bcrypt hash only; never plain text |
| `createdAt` | Date | Automatic | Mongoose timestamp |
| `updatedAt` | Date | Automatic | Mongoose timestamp |

Implementation details:

- The unique index on `email` is created by the `unique: true` schema option.
- `passwordHash` uses `select: false`; login explicitly calls
  `.select('+passwordHash')`.
- The `toJSON` transform exposes `id` and removes `_id`, `passwordHash` and `__v`.
- Mongoose `timestamps: true` maintains creation and update dates.
- Duplicate emails are checked before hashing and are also caught by the unique index
  as a race-condition safeguard (MongoDB error code `11000` maps to HTTP `409`).

### 5.2 Product model (`models/Product.js`)

| Field | Type | Constraints | Default |
|---|---|---|---|
| `name` | String | Required, trimmed, 2 to 120 characters | - |
| `description` | String | Trimmed, maximum 2000 characters | `""` |
| `price` | Number | Required, finite, greater than or equal to 0 | - |
| `oldPrice` | Number | Optional, finite, greater than or equal to 0 | - |
| `category` | String | Trimmed, maximum 60 characters | `"General"` |
| `image` | String | Trimmed, maximum 500 characters; React storefront field | `""` |
| `imageUrl` | String | Trimmed, maximum 500 characters; legacy dashboard alias | `""` |
| `stock` | Number | Integer, greater than or equal to 0 | `0` |
| `rating` | Number | Between 0 and 5 | `0` |
| `reviews` | Number | Non-negative integer | `0` |
| `badge` | String | Trimmed, maximum 40 characters | `""` |
| `featured` | Boolean | Hero spotlight flag | `false` |
| `createdAt` | Date | Automatic | - |
| `updatedAt` | Date | Automatic | - |

Indexes:

- `{ category: 1 }` for future category filtering.
- `{ createdAt: -1 }` for newest-first catalogue listing.
- The `toJSON` transform exposes both `id` and the native `_id` for interoperability.
- `image` and `imageUrl` are kept in sync so the React storefront and the legacy dashboard
  can consume the same API response.

### 5.3 Relationship

There is no embedded or referenced relationship between `User` and `Product` in this TD.
Any authenticated user may manage the shared catalogue. A production design would add an
`owner` reference and role checks.

---

## 6. REST API specification

Base URL: `http://localhost:5000`

All request and response bodies use `application/json`. Protected routes require:

```http
Authorization: Bearer <token>
```

### 6.1 Endpoint summary

| Method | Endpoint | Access | Limiter | Success |
|---|---|---|---|---|
| GET | `/api/health` | Public | Exempt | `200` |
| POST | `/api/auth/register` | Public | General | `201` |
| POST | `/api/auth/login` | Public | General + strict login | `200` |
| GET | `/api/auth/me` | Bearer token | General | `200` |
| GET | `/api/products` | Public | General | `200` |
| GET | `/api/products/:id` | Public | General | `200` |
| POST | `/api/products` | Bearer token | General | `201` |
| PUT | `/api/products/:id` | Bearer token | General | `200` |
| DELETE | `/api/products/:id` | Bearer token | General | `200` |
| POST | `/api/dev/reset-rate-limits` | Development, loopback | Exempt | `200` |

### 6.2 Authentication endpoints

#### POST `/api/auth/register`

Access: public. Creates a user after validating the payload.

Request:

```json
{
  "name": "Ada Lovelace",
  "email": "ada@ensta.dz",
  "password": "StrongPassword123!"
}
```

Validation rules:

- `name`: string, 2 to 80 characters after trimming.
- `email`: valid email pattern, normalized to lowercase.
- `password`: string, 8 to 128 characters.
- A duplicate email returns `409 Conflict`.

Success response - `201 Created`:

```json
{
  "message": "User registered successfully.",
  "user": {
    "id": "68f1c2a9e4b0a12d3c4d5e6f",
    "name": "Ada Lovelace",
    "email": "ada@ensta.dz"
  }
}
```

Error responses:

| Status | Cause |
|---|---|
| `400` | Missing or invalid field, malformed JSON |
| `409` | Email already exists |
| `429` | General API limiter exceeded |

#### POST `/api/auth/login`

Access: public. Protected by the strict limiter: 5 attempts per 15 minutes per IP.

Request:

```json
{
  "email": "ada@ensta.dz",
  "password": "StrongPassword123!"
}
```

Success response - `200 OK`:

```json
{
  "token": "<header>.<payload>.<signature>",
  "user": {
    "id": "68f1c2a9e4b0a12d3c4d5e6f",
    "name": "Ada Lovelace",
    "email": "ada@ensta.dz"
  }
}
```

Failure response - `401 Unauthorized`:

```json
{
  "error": "Unauthorized",
  "message": "Invalid email or password."
}
```

The same message is returned for an unknown email and for a wrong password. This prevents
account enumeration.

#### GET `/api/auth/me`

Access: bearer token (JWT or OAuth2). Returns the server-resolved identity.

JWT response - `200 OK`:

```json
{
  "user": {
    "id": "68f1c2a9e4b0a12d3c4d5e6f",
    "name": "Ada Lovelace",
    "email": "ada@ensta.dz",
    "provider": "jwt",
    "createdAt": "2026-01-15T10:30:00.000Z"
  }
}
```

OAuth2 response - `200 OK`:

```json
{
  "user": {
    "id": "oauth-demo-user",
    "name": "OAuth Demo User",
    "email": "oauth.demo@ensta.dz",
    "provider": "oauth2-mock"
  }
}
```

### 6.3 Product endpoints

#### GET `/api/products`

Access: public. Returns every product, newest first, as a JSON array. Each document
contains an `id` field and the native MongoDB `_id` field.

```json
[
  {
    "id": "68f1c2a9e4b0a12d3c4d5e70",
    "_id": "68f1c2a9e4b0a12d3c4d5e70",
    "name": "Aurora Wireless Headphones",
    "description": "Over-ear Bluetooth headphones...",
    "price": 249.9,
    "category": "Audio",
    "imageUrl": "https://images.unsplash.com/...",
    "stock": 24,
    "createdAt": "2026-01-15T10:30:00.000Z",
    "updatedAt": "2026-01-15T10:30:00.000Z"
  }
]
```

#### GET `/api/products/:id`

Access: public. Returns one product or `404 Not Found`. A malformed MongoDB identifier
also returns `404` for consistency with the resource-oriented contract.

#### POST `/api/products`

Access: bearer token. Requires `name` and `price`; the other fields are optional.

Request:

```json
{
  "name": "Aurora Wireless Headphones",
  "description": "Active noise cancellation and 40-hour battery.",
  "price": 249.9,
  "category": "Audio",
  "imageUrl": "https://example.com/headphones.jpg",
  "stock": 24
}
```

Success response - `201 Created`: the complete created document, including `id`,
`createdAt` and `updatedAt`.

#### PUT `/api/products/:id`

Access: bearer token. Accepts a partial document and updates only the supplied fields.
At least one allowed field is required. Returns `200` with the updated document, `400` for
invalid values, `401` without a valid token, or `404` when the product does not exist.

Request:

```json
{
  "price": 229.9,
  "stock": 18
}
```

#### DELETE `/api/products/:id`

Access: bearer token.

Success response - `200 OK`:

```json
{
  "message": "Product deleted successfully.",
  "id": "68f1c2a9e4b0a12d3c4d5e70"
}
```

A second deletion returns `404`.

### 6.4 Health endpoint

`GET /api/health` is intentionally excluded from the general limiter so that monitoring
does not consume the client budget.

```json
{
  "status": "ok",
  "service": "ENSTA WAMD TD-TP 3 E-Commerce API",
  "uptime": 42,
  "timestamp": "2026-01-15T10:31:00.000Z",
  "database": "connected",
  "rateLimit": {
    "generalMax": 100,
    "loginMax": 5,
    "windowMinutes": 15
  }
}
```

### 6.5 Error format

The API uses a small, consistent error envelope:

```json
{
  "error": "Unauthorized",
  "message": "Authentication required. Provide an Authorization: Bearer <token> header."
}
```

Validation errors may include details:

```json
{
  "error": "Validation Error",
  "message": "One or more fields are invalid.",
  "details": [
    { "field": "price", "message": "Price cannot be negative" }
  ]
}
```

### 6.6 Status code policy

| Code | Meaning in this API |
|---|---|
| `200` | Successful read, update or delete |
| `201` | User or product created |
| `400` | Invalid payload, malformed JSON, invalid identifier value |
| `401` | Missing, invalid or expired bearer token; invalid credentials |
| `403` | Origin rejected by CORS; non-loopback rate-limit reset |
| `404` | Product or route not found |
| `409` | Duplicate email |
| `429` | Rate limit exceeded |
| `500` | Unexpected server error |

---

## 7. JWT authentication

### 7.1 Registration flow

```text
Client                    API                         MongoDB
  |  POST /register         |                            |
  |------------------------>| validate fields            |
  |                         | normalize email            |
  |                         | find existing email ------>|
  |                         |<---------------------------|
  |                         | bcrypt.hash(password, 12)  |
  |                         | User.create -------------->|
  |                         |<---------------------------|
  |  201 { user }           |                            |
  |<------------------------|                            |
```

Passwords are never stored or logged. `bcryptjs` generates a random salt for every hash.
The cost factor defaults to 12 and is configurable through `BCRYPT_SALT_ROUNDS` (clamped
between 10 and 15).

### 7.2 Login and token issuance

```text
Client                    API                         MongoDB
  |  POST /login            |                            |
  |------------------------>| strict login limiter       |
  |                         | find user + passwordHash ->|
  |                         |<---------------------------|
  |                         | bcrypt.compare             |
  |                         | jwt.sign(HS256, secret)    |
  |  200 { token, user }    |                            |
  |<------------------------|                            |
```

JWT creation options:

| Option | Value |
|---|---|
| Algorithm | `HS256` |
| Secret | `process.env.JWT_SECRET` |
| Expiration | `process.env.JWT_EXPIRES_IN`, default `1h` |
| Issuer | `process.env.JWT_ISSUER` |
| Audience | `process.env.JWT_AUDIENCE` |

Payload:

```json
{
  "sub": "68f1c2a9e4b0a12d3c4d5e6f",
  "name": "Ada Lovelace",
  "email": "ada@ensta.dz",
  "iat": 1768463400,
  "exp": 1768467000,
  "aud": "ensta-wamd-dashboard",
  "iss": "ensta-wamd-tp3"
}
```

`sub` is the canonical subject. The name and email claims are conveniences for the client;
authorization decisions that require fresh user data can call `/api/auth/me`.

### 7.3 Verification middleware (`middleware/authMiddleware.js`)

The middleware performs the following steps:

1. Read the `Authorization` header.
2. Require the `Bearer` scheme and exactly one token value.
3. Verify the token with `jsonwebtoken.verify`, pinning `algorithms: ['HS256']`.
4. Validate the issuer and audience when configured.
5. Require a `sub` or `id` claim.
6. Attach a normalized identity to `req.user`.
7. Return `401` with a `WWW-Authenticate` header when authentication fails.
8. If local JWT verification fails and OAuth2 is enabled, delegate to the OAuth2 validator.

Normalized identity:

```js
req.user = {
  id: "68f1c2a9e4b0a12d3c4d5e6f",
  name: "Ada Lovelace",
  email: "ada@ensta.dz",
  provider: "jwt",
  claims: { /* verified JWT payload */ }
};
```

Pinning the algorithm prevents algorithm-confusion attacks. Using a long random secret
prevents offline guessing. The secret must be at least 32 characters; the application
logs a warning for shorter values and refuses to start when it is missing.

### 7.4 Token inspector in the dashboard

The dashboard decodes the JWT locally to display:

- The algorithm and token type from the header.
- The complete payload, including `sub`, `name`, `email`, `iss`, `aud`, `iat` and `exp`.
- A human-readable expiration state (valid, expiring soon or expired).
- The raw header and payload with base64url decoding.

Decoding is not verification. The **Verify** button calls `GET /api/auth/me`, which
performs server-side signature, issuer and audience validation. The inspector therefore
demonstrates both concepts: local inspection for debugging and server verification for
trust.

---

## 8. OAuth2 and OpenID Connect support

### 8.1 Design goal

The TD asks for modular support so that bearer tokens can also be accepted or mocked for
OAuth2 / OpenID Connect testing. The implementation keeps JWT and OAuth2 validation
separate:

```text
authMiddleware
   |
   +--> 1. Local JWT verification (HS256, JWT_SECRET)
   |
   +--> 2. oauth2Validator.validateOAuth2Token(token)
             |
             +--> Mock token map (laboratory only)
             |
             +--> OIDC UserInfo endpoint (production-style opaque token check)
```

This design means:

- Existing JWT sessions continue to work unchanged.
- Product controllers do not know which authentication scheme was used.
- A deployment can replace `oauth2Validator.js` with full JWKS/RS256 verification
  without touching routes or controllers.
- `req.user.provider` records `jwt`, `oauth2-mock` or `oauth2`.

### 8.2 Configuration

| Variable | Purpose |
|---|---|
| `OAUTH2_ENABLED` | Enables the OAuth2 fallback validator |
| `OAUTH2_MOCK_ENABLED` | Enables static mock tokens for demonstrations |
| `OAUTH2_MOCK_TOKENS` | JSON map or `token=email` pair list of accepted mock tokens |
| `OAUTH2_ALLOW_MOCK_IN_PRODUCTION` | Explicit override; keep `false` |
| `OAUTH2_USERINFO_URL` | OpenID Connect UserInfo endpoint for opaque access tokens |
| `OAUTH2_TIMEOUT_MS` | Timeout for the UserInfo request, default 5000 ms |

Example mock map:

```json
{
  "ensta-demo-oauth-token": {
    "sub": "oauth-demo-user",
    "name": "OAuth Demo User",
    "email": "oauth.demo@ensta.dz"
  }
}
```

### 8.3 Mock token flow

1. The client sends `Authorization: Bearer ensta-demo-oauth-token`.
2. Local JWT verification fails because the value is not a three-part JWT.
3. The OAuth2 validator is enabled and finds the token in the mock map.
4. Claims are normalized into `{ id, name, email, provider: "oauth2-mock", claims }`.
5. The protected controller executes exactly as it would for a JWT user.

Mock tokens are disabled automatically in production unless
`OAUTH2_ALLOW_MOCK_IN_PRODUCTION=true` is explicitly set. This prevents accidental
authentication bypass in a deployed environment.

### 8.4 OpenID Connect UserInfo flow

For an opaque OAuth2 access token:

1. The client sends the token as a bearer credential.
2. Local JWT verification fails.
3. The validator calls `OAUTH2_USERINFO_URL` with the token in the `Authorization` header.
4. A non-2xx response rejects the token.
5. A successful JSON response is normalized: `sub`, `name`, `email` and `provider: "oauth2"`.
6. The request continues with the resolved identity.

The request has a hard timeout and errors are treated as authentication failures. The
UserInfo response is trusted because it comes from the configured identity provider over
the server-to-server channel. In production, `OAUTH2_USERINFO_URL` must use HTTPS.

### 8.5 Production hardening notes

The laboratory validator intentionally does not implement JWKS signature verification.
A production OIDC deployment should additionally:

- Validate RS256/ES256 signatures against the provider's JWKS document.
- Check `iss`, `aud`, `exp`, `nbf` and token type.
- Use token introspection for opaque tokens when UserInfo is unavailable.
- Cache signing keys and rotate them safely.
- Enforce HTTPS, short access-token lifetimes and refresh-token rotation.
- Never enable mock tokens.
- Add scopes and role-based authorization.

These points are discussed again in section 12 as future work.

---

## 9. Security middleware and rate limiting

### 9.1 CORS

`server.js` builds an allowlist from `CLIENT_ORIGINS` (comma-separated). Requests without
an `Origin` header, such as curl and server-to-server calls, are allowed. Browser origins
that are not listed receive a `403` JSON response. The dashboard is served from the same
origin as the API, so it works without a cross-origin request. The default list also
includes common development ports 3000 and 5173.

Allowed methods: `GET`, `POST`, `PUT`, `DELETE`, `OPTIONS`.  
Allowed headers: `Content-Type`, `Authorization`.  
Credentials are enabled, and preflight results are cached for 24 hours.

### 9.2 Body parsing and input validation

- `express.json({ limit: '1mb' })` limits JSON payloads.
- `express.urlencoded({ extended: true, limit: '1mb' })` supports form-encoded clients.
- Malformed JSON is caught by the centralized error handler and returns `400`.
- Controllers validate every field manually before reaching Mongoose.
- A whitelist of product fields prevents mass assignment of unexpected properties.
- Mongoose validates constraints again at persistence time with `runValidators`.

Validation examples:

- Email must match a practical address pattern.
- Password length is bounded (8 to 128) to avoid weak secrets and denial of service.
- Price must be finite and non-negative.
- Stock must be a non-negative integer.
- Product name must contain between 2 and 120 characters.
- MongoDB identifiers are checked with `mongoose.isValidObjectId`.

### 9.3 Password and token safety

- bcrypt with a per-password salt and configurable cost.
- `passwordHash` is excluded from queries by default.
- JSON transforms remove sensitive and internal fields.
- Login failures are generic to avoid account enumeration.
- JWT algorithm is pinned to HS256.
- JWT issuer and audience are checked when configured.
- Token expiration is enforced by `jsonwebtoken`.
- OAuth2 mock mode is disabled in production by default.
- The dev rate-limit reset is disabled in production and restricted to loopback.

### 9.4 Security response headers

The application sets:

```http
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: no-referrer
```

`x-powered-by` is disabled. A production deployment would add Helmet, HSTS and a strict
Content Security Policy at the reverse proxy or application level.

### 9.5 Rate limiting

Two independent `express-rate-limit` instances are created in
`middleware/rateLimiter.js`, each with its own `MemoryStore`:

| Limiter | Scope | Default | Window |
|---|---|---|---|
| General API | `/api/auth` and `/api/products` | 100 requests | 15 minutes |
| Strict login | `POST /api/auth/login` | 5 requests | 15 minutes |

The login route passes through both limiters. The general limiter protects the whole API;
the login limiter slows credential-stuffing attempts even when the general budget is
still available.

Configuration:

- `RATE_LIMIT_WINDOW_MS` (default `900000`)
- `RATE_LIMIT_MAX` (default `100`)
- `AUTH_RATE_LIMIT_MAX` (default `5`)

Standard headers are enabled with `standardHeaders: 'draft-7'`, so responses include the
`RateLimit` policy/status fields. Legacy `X-RateLimit-*` headers are disabled.

Custom `429` response:

```json
{
  "error": "Too Many Requests",
  "message": "Too many login attempts. The login limit is 5 attempts per 15 minutes.",
  "scope": "auth",
  "limit": 5,
  "remaining": 0,
  "retryAfter": 842
}
```

The handler also sets the `Retry-After` header. The dashboard reads this value and prints
it in the request log.

#### Development reset endpoint

Because the limiter stores are in memory, a demonstration can lock an IP for 15 minutes.
For convenience, the following route is available only when `NODE_ENV` is not
`production` and `DEV_RATE_LIMIT_RESET` is not `false`:

```http
POST /api/dev/reset-rate-limits
```

It is mounted before the general limiter, checks that the request comes from
`127.0.0.1` or `::1`, and returns `403` otherwise. This endpoint is a teaching aid; it is
not part of the public API contract and is never exposed in production.

#### Proxy considerations

`trust proxy` is disabled by default. Behind a reverse proxy, enable `TRUST_PROXY=true`
so that `req.ip` reflects the client address rather than the proxy. Do not enable it when
clients can connect directly, because clients could spoof `X-Forwarded-For` and evade the
limiter.

#### Distributed deployment

The default `MemoryStore` is local to one Node.js process. A multi-instance deployment
needs a shared store such as Redis so that counters are consistent. Restarting the server
also resets the counters.

---

## 10. Configuration, installation and data seeding

### 10.1 Prerequisites

- Node.js 18 or later (the OAuth2 validator uses the global `fetch`).
- npm 9 or later.
- MongoDB 6 or 7, either installed locally or started with Docker.
- curl and bash for `test-api.sh`.

### 10.2 Installation

```bash
cd "TP web dev"

# 1. Install dependencies
npm install

# 2. Create the local environment file
cp .env.example .env

# 3. Replace the placeholder JWT secret with a strong random value
sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -hex 48)|" .env

# 4. Start MongoDB with Docker (skip if mongod is already running)
docker run -d \
  --name ensta-mongo \
  -p 127.0.0.1:27017:27017 \
  -v ensta-mongo-data:/data/db \
  mongo:7

# 5. Start the API and dashboard
npm start
```

Open:

- Dashboard: `http://localhost:5000`
- API health: `http://localhost:5000/api/health`

The default database name is `ensta_wamd_tp3`. Change `MONGODB_URI` to use another
database or a MongoDB Atlas cluster.

### 10.3 npm scripts

| Script | Command | Purpose |
|---|---|---|
| `npm start` | `node server.js` | Start the API and static dashboard |
| `npm run dev` | `nodemon server.js` | Restart automatically on source changes |
| `npm run seed` | `node seed.js` | Seed only when the product collection is empty |
| `npm run seed:fresh` | `node seed.js --force` | Delete all products and insert the sample catalogue |
| `npm run test:api` | `bash test-api.sh` | Run the automated API verification |

### 10.4 Environment variables

The full list is provided in `.env.example` and Appendix A. Important values:

- `PORT` and `HOST` control the HTTP listener.
- `MONGODB_URI` points to the database.
- `JWT_SECRET`, `JWT_EXPIRES_IN`, `JWT_ISSUER` and `JWT_AUDIENCE` control token issuance
  and verification.
- `CLIENT_ORIGINS` is the CORS allowlist.
- `RATE_LIMIT_*` variables control both limiters.
- `AUTO_SEED` controls automatic seeding at startup.
- `OAUTH2_*` variables control the modular validator.

`.env` is excluded by `.gitignore`; only `.env.example` is committed.

### 10.5 Seeding

`seed.js` contains 12 realistic products across Audio, Wearables, Computing, Photography,
Accessories, Bags, Home Office and Lifestyle. Each product has a description, price,
category, external image URL and stock level.

Automatic seeding:

- `server.js` calls `seedIfEmpty()` after connecting to MongoDB when `AUTO_SEED` is not
  `false`.
- If the collection already contains at least one product, nothing is inserted.
- This makes the first launch immediately demonstrable without a manual step.

Manual seeding:

```bash
npm run seed         # insert only if empty
npm run seed:fresh   # wipe products and insert the 12 samples
```

Seeding is idempotent in normal mode and never duplicates the sample catalogue.

---

## 11. Testing and demonstration

### 11.1 Dashboard overview

The dashboard is a single page served at `/`. It uses a slate design system, 12 to 16 pixel
rounded surfaces, soft shadows, a light/dark theme toggle and inline SVG icons. No emojis
or external icon fonts are used.

The page has three functional areas:

1. **Authentication panel**
   - Register and login tabs.
   - Password visibility toggle.
   - JWT token inspector with header, payload, claims and expiration.
   - Copy, server-side verify and clear actions.
   - A paste field for an existing JWT or opaque OAuth2 access token.
2. **Product manager**
   - Searchable catalogue list with thumbnails.
   - Detailed product inspector with the raw JSON response.
   - Create and edit modal, delete confirmation modal.
   - A **Send Bearer token** switch. Turning it off demonstrates the `401` response;
     turning it on with a valid session demonstrates the protected write.
3. **Rate-limit stress tester**
   - Sequential requests against the strict login route or the general product route.
   - Live counters for total, successful, unauthorized and rate-limited responses.
   - Per-request method, path, status, duration and error detail, including `Retry-After`.
   - Start/stop control, log clearing and a development counter reset.

### 11.2 Suggested demonstration sequence

1. Start the API and open `http://localhost:5000`.
2. Register a new account. The client signs in automatically.
3. Inspect the JWT payload and verify it with the server.
4. Create a product with the Bearer switch enabled.
5. Edit the product price and stock.
6. Disable the Bearer switch and try to update or delete. Observe `401 Unauthorized`.
7. Re-enable the switch and delete the product.
8. Paste `ensta-demo-oauth-token` into the token field and verify it. The server resolves
   the mock OAuth2 identity and reports `provider: oauth2-mock`.
9. Run the strict login stress test with 8 requests. The first five return `401` and the
   remaining requests return `429` with a `Retry-After` header.
10. Reset the counters from the dashboard, then run the general test with 105 requests
    to observe the 100-request budget and the `429` transition.
11. Reset the counters again to leave the API usable.

### 11.3 Automated verification with `test-api.sh`

Run:

```bash
npm start
# in a second terminal
./test-api.sh
```

The script uses curl and Node.js for JSON parsing. It does not require jq. It creates a
unique test user, performs the full CRUD lifecycle and removes the products it creates.

The script verifies:

- Health endpoint and static dashboard availability.
- Registration validation, `201` creation, duplicate `409`, malformed JSON `400`.
- Wrong-password `401`, successful login `200`, JWT shape and user payload.
- `/api/auth/me` with a valid JWT, without a token and with an invalid token.
- Public product list, single product, malformed ID `404` and missing product `404`.
- Protected writes without or with an invalid token (`401`).
- Product creation `201`, invalid payload `400`, update `200`, negative price `400`.
- Update and delete of missing products (`404`).
- OAuth2 mock identity resolution and product creation, then JWT deletion.
- CORS preflight `204` and allowed-origin echo.
- Unknown API route `404`.
- Strict login limiter: exactly 5 failed attempts then `429`, `Retry-After` header and
  numeric `retryAfter` field.
- General limiter: exactly 100 accepted requests then `429`, rate-limit header and
  numeric `retryAfter` field.
- Product cleanup and counter reset.

Observed result on the reference environment:

```text
=============================================
PASS: 62  FAIL: 0  SKIP: 0
=============================================
```

Environment options:

| Variable | Effect |
|---|---|
| `BASE_URL` | Target server, default `http://127.0.0.1:5000` |
| `SKIP_GENERAL_RATE_TEST` | Set to `true` to skip the 100-request general test |
| `OAUTH2_MOCK_ENABLED` | Overrides the value read from `.env` |
| `OAUTH2_MOCK_TOKEN` | Overrides the default mock token |

### 11.4 Manual curl examples

Register and log in:

```bash
curl -sS -X POST http://localhost:5000/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"name":"Ada Lovelace","email":"ada@ensta.dz","password":"StrongPassword123!"}'

TOKEN=$(curl -sS -X POST http://localhost:5000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"ada@ensta.dz","password":"StrongPassword123!"}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).token')
```

List and create:

```bash
curl -sS http://localhost:5000/api/products

curl -sS -X POST http://localhost:5000/api/products \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"name":"Studio Monitor","price":349.00,"category":"Audio","stock":6}'
```

Update and delete:

```bash
curl -sS -X PUT http://localhost:5000/api/products/<id> \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"price":329.00,"stock":4}'

curl -sS -X DELETE http://localhost:5000/api/products/<id> \
  -H "Authorization: Bearer $TOKEN"
```

OAuth2 mock identity:

```bash
curl -sS http://localhost:5000/api/auth/me \
  -H 'Authorization: Bearer ensta-demo-oauth-token'
```

Observe the login limit:

```bash
for i in $(seq 1 7); do
  curl -sS -o /dev/null -w "%{http_code}\n" \
    -X POST http://localhost:5000/api/auth/login \
    -H 'Content-Type: application/json' \
    -d '{"email":"unknown@ensta.dz","password":"wrong-password"}'
done
```

Expected: five `401` responses followed by `429` responses. Reset with:

```bash
curl -sS -X POST http://localhost:5000/api/dev/reset-rate-limits
```

### 11.5 Testing with a REST client

Import the following variables into Postman, Insomnia or Bruno:

- `baseUrl = http://localhost:5000`
- `token = <value returned by login>`

Set the collection authorization to `Bearer {{token}}`. Public product reads must be sent
without the header to demonstrate the public/protected boundary.

---

## 12. Results, discussion and conclusion

### 12.1 Requirements traceability

| TD requirement | Implementation | Verification |
|---|---|---|
| Express, Mongoose, dotenv, cors, bcryptjs, jsonwebtoken, express-rate-limit | `package.json`, `server.js` | `npm install`, server start |
| User model with name, unique email, passwordHash and timestamps | `models/User.js` | Registration and duplicate tests |
| Product model with required name and price, optional fields and stock default | `models/Product.js` | Create, update and validation tests |
| Register with validation, duplicate 409 and password hashing | `controllers/authController.js` | `test-api.sh` registration section |
| Login returning `{ token, user }` or 401 | `controllers/authController.js` | Login section |
| Public product list and single read | `controllers/productController.js` | Public read section |
| Protected create, update and delete | `routes/productRoutes.js`, `authMiddleware.js` | Protected write section |
| JWT bearer parsing, verification, payload attachment and 401 | `middleware/authMiddleware.js` | Token and 401 tests |
| Modular OAuth2/OIDC bearer support and mocks | `middleware/oauth2Validator.js` | OAuth2 section |
| General limiter 100 per 15 minutes | `middleware/rateLimiter.js` | General 429 test |
| Login limiter 5 per 15 minutes | `middleware/rateLimiter.js` | Strict 429 test |
| Custom JSON 429 response | `rateLimiter.js` | `retryAfter` and header tests |
| CORS and JSON body parsing | `server.js` | Preflight test and API calls |
| Sample data seeding | `seed.js`, startup hook | 12 products on first launch |
| Testing dashboard with rounded, emoji-free design | `public/` | Browser walkthrough |
| Automated curl verification | `test-api.sh` | 62 passing assertions |
| Academic documentation | `README.md` | This report |

### 12.2 Results

The reference environment produced the following results:

- The API starts only when `JWT_SECRET` is configured, then connects to MongoDB and seeds
  12 products if the collection is empty.
- Registration stores a bcrypt hash and returns `201` without exposing it.
- Duplicate registration returns `409`.
- Valid login returns a 299-character HS256 JWT with issuer, audience and expiration.
- All public reads succeed without authentication.
- All protected writes reject missing and invalid tokens with `401`.
- Valid JWT and OAuth2 mock tokens can both create products.
- The strict limiter allows exactly five login attempts and then returns `429` with
  `Retry-After` and a JSON `retryAfter` value.
- The general limiter allows exactly 100 requests and then returns the same structured
  `429` response.
- CORS preflight from `http://localhost:5000` returns `204` with the correct allow-origin
  header.
- The dashboard correctly renders the catalogue, decodes JWT payloads, verifies sessions,
  performs create/update/delete operations and displays live stress-test results.
- `test-api.sh` passes all 62 assertions with zero failures and zero skips.

### 12.3 Discussion

The most important design decision is the separation between authentication strategies.
JWT verification and OAuth2 validation are independent modules behind one middleware.
Controllers receive a normalized `req.user` and remain unaware of the token source. This
mirrors real systems that accept both first-party sessions and third-party identity
provider tokens, and it makes the OAuth2 requirement genuinely modular rather than a
hard-coded branch.

The second decision is to enforce the public/protected boundary at the route level.
Reads are explicitly public, while each write route lists the authentication middleware.
This is easy to audit: a new write endpoint cannot accidentally become public without an
obvious code change.

The third decision is to return structured, machine-readable errors and rate-limit
metadata. The dashboard and the test script consume the same `message`, `retryAfter` and
`error` fields. This reduces duplication between documentation, tests and UI behaviour.

Rate limiting with an in-memory store is appropriate for a single-process academic
project. It also makes the demonstration immediate: counters start at zero and can be
reset from the dashboard. A production system would need a shared store; this limitation
is explicit rather than hidden.

### 12.4 Limitations

- **In-memory rate limiting.** Counters are per process and reset on restart. A cluster
  requires Redis or another shared store.
- **No token revocation.** JWTs remain valid until expiration. Logout only deletes the
  client copy. Production needs short lifetimes, refresh-token rotation and a revocation
  strategy.
- **No role model.** Every authenticated user can manage every product.
- **OAuth2 without JWKS.** The OAuth2 validator uses UserInfo or mocks; it does not
  validate RS256 signatures locally against a JWKS document.
- **Browser storage.** The dashboard stores the token in `localStorage` for convenience.
  This is acceptable for a laboratory tool but vulnerable to cross-site scripting in a
  production application. An HttpOnly cookie or in-memory session would be safer.
- **No pagination.** The catalogue endpoint returns all products. Large catalogues need
  cursor or page pagination.
- **External images.** Seed images are hosted by Unsplash. The interface falls back to a
  vector placeholder when an image is unavailable.
- **No user deletion endpoint.** `test-api.sh` creates a unique user on each run and
  leaves it in the database, because user administration is outside the TD scope.
- **Single currency and locale.** Prices are displayed in USD by the dashboard; the API
  stores a plain number.
- **No automated frontend test suite.** The dashboard was exercised manually and with a
  headless browser during development; only the API has a committed automated script.

### 12.5 Future work

1. Add refresh tokens, logout and token revocation.
2. Add roles (`customer`, `admin`) and ownership checks on products.
3. Add request validation with a schema library and OpenAPI documentation.
4. Add pagination, sorting, category filters and full-text search.
5. Replace the in-memory limiter with Redis and add per-account login throttling.
6. Implement full OIDC JWKS validation and token introspection.
7. Add Helmet, a strict Content Security Policy and HTTPS termination.
8. Add unit and integration tests with Jest or Vitest and Supertest.
9. Containerize the API with Docker Compose alongside MongoDB and Redis.
10. Add product image upload with object storage and signed URLs.

### 12.6 Conclusion

The project fulfils the TD-TP 3 requirements end to end. It provides a layered Express and
MongoDB backend, secure password storage, JWT and OAuth2 bearer authentication, strict and
general rate limiting, CORS, validation, centralized errors and automatic sample data. The
dashboard makes each behaviour observable without a separate REST client, and the curl
script verifies the contract automatically.

Beyond the functional checklist, the implementation demonstrates the reasoning behind the
architecture: isolation of authentication strategies, explicit access-control boundaries,
structured error contracts, and a clear distinction between development conveniences and
production safeguards. The limitations identified above define a realistic path from an
academic prototype to a production-ready e-commerce service.

---

## Appendix A - Environment variables

| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | `development` | Enables production safeguards when set to `production` |
| `HOST` | `0.0.0.0` | HTTP bind address |
| `PORT` | `5000` | HTTP port |
| `TRUST_PROXY` | `false` | Trust the first proxy hop for client IP resolution |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/ensta_wamd_tp3` | MongoDB connection string |
| `JWT_SECRET` | none (required) | HS256 signing secret, at least 32 characters recommended |
| `JWT_EXPIRES_IN` | `1h` | Token lifetime accepted by jsonwebtoken |
| `JWT_ISSUER` | `ensta-wamd-tp3` | Expected `iss` claim |
| `JWT_AUDIENCE` | `ensta-wamd-dashboard` | Expected `aud` claim |
| `BCRYPT_SALT_ROUNDS` | `12` | bcrypt cost factor, clamped to 10-15 |
| `CLIENT_ORIGINS` | localhost ports 5000, 5173, 3000 | Comma-separated CORS allowlist |
| `RATE_LIMIT_WINDOW_MS` | `900000` | Limiter window in milliseconds |
| `RATE_LIMIT_MAX` | `100` | General requests per window |
| `AUTH_RATE_LIMIT_MAX` | `5` | Login attempts per window |
| `AUTO_SEED` | `true` | Seed when the product collection is empty |
| `DEV_RATE_LIMIT_RESET` | `true` | Enable the loopback reset route outside production |
| `OAUTH2_ENABLED` | `true` in the example | Enable OAuth2 fallback validation |
| `OAUTH2_MOCK_ENABLED` | `true` in the example | Enable mock tokens for local tests |
| `OAUTH2_ALLOW_MOCK_IN_PRODUCTION` | `false` | Explicit production override; keep false |
| `OAUTH2_MOCK_TOKENS` | demo token map | JSON object or `token=email` pairs |
| `OAUTH2_USERINFO_URL` | empty | OIDC UserInfo endpoint |
| `OAUTH2_TIMEOUT_MS` | `5000` | UserInfo request timeout |

---

## Appendix B - Troubleshooting

### MongoDB connection refused

Start MongoDB or the Docker container:

```bash
docker start ensta-mongo
# or
docker run -d --name ensta-mongo -p 127.0.0.1:27017:27017 mongo:7
```

Check `MONGODB_URI` in `.env`.

### Server refuses to start because JWT_SECRET is missing

```bash
cp .env.example .env
sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -hex 48)|" .env
```

### Login returns 429 during a demonstration

The strict limiter allows five attempts per 15 minutes. Reset in development:

```bash
curl -sS -X POST http://localhost:5000/api/dev/reset-rate-limits
```

Or use the **Reset counters** button in the dashboard. Restarting the server also clears
the in-memory stores.

### Protected request returns 401

- Confirm the token was issued by this server and has not expired.
- Confirm the `Authorization` header uses the exact form `Bearer <token>`.
- Confirm `JWT_SECRET` has not changed since the token was issued.
- Confirm the issuer and audience match the environment configuration.
- Use the dashboard's **Verify** button or call `/api/auth/me`.

### Browser request blocked by CORS

Add the exact origin (scheme, host and port) to `CLIENT_ORIGINS`, then restart the API.
Origins are compared as strings.

### Rate limiting behaves incorrectly behind a proxy

Set `TRUST_PROXY=true` only when the API is behind a trusted proxy. Otherwise clients can
spoof forwarding headers.

### OAuth2 mock token is rejected

- Set `OAUTH2_ENABLED=true` and `OAUTH2_MOCK_ENABLED=true`.
- Confirm the token exactly matches a key in `OAUTH2_MOCK_TOKENS`.
- Do not enable mock tokens in production.
- For an opaque provider token, configure `OAUTH2_USERINFO_URL`.

### Images do not load

The sample catalogue uses external Unsplash URLs. Offline environments display the
built-in SVG placeholder; product functionality is unaffected.

---

## References

- Node.js documentation: https://nodejs.org/docs/
- Express.js documentation: https://expressjs.com/
- Mongoose documentation: https://mongoosejs.com/docs/
- MongoDB manual: https://www.mongodb.com/docs/manual/
- RFC 7519 - JSON Web Token (JWT): https://www.rfc-editor.org/rfc/rfc7519
- RFC 6749 - The OAuth 2.0 Authorization Framework: https://www.rfc-editor.org/rfc/rfc6749
- OpenID Connect Core 1.0: https://openid.net/specs/openid-connect-core-1_0.html
- express-rate-limit documentation: https://express-rate-limit.mintlify.app/
- bcryptjs documentation: https://github.com/dcodeIO/bcrypt.js
- jsonwebtoken documentation: https://github.com/auth0/node-jsonwebtoken
- OWASP Password Storage Cheat Sheet:
  https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- OWASP REST Security Cheat Sheet:
  https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html
- MDN CORS guide: https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS

---

**End of report.**
