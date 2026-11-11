#!/usr/bin/env bash
# =============================================================================
# ENSTA WAMD TD-TP 3 - automated API verification
#
# Requirements: bash, curl, node (used only to parse JSON without jq)
# Usage:
#   ./test-api.sh
#   BASE_URL=http://127.0.0.1:5000 ./test-api.sh
#   SKIP_GENERAL_RATE_TEST=true ./test-api.sh
#
# The script expects the API to be running (npm start). It uses the development
# reset endpoint, when available, so that repeated runs do not stay rate
# limited. No emojis are used in the output.
# =============================================================================

set -uo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:5000}"
BASE_URL="${BASE_URL%/}"
TMP_DIR="$(mktemp -d)"
STAMP="$(date +%s)-$$"
TEST_EMAIL="tp3.tester.${STAMP}@ensta.dz"
TEST_PASSWORD="Tp3-Password-2026!"
GENERAL_TEST="${SKIP_GENERAL_RATE_TEST:-false}"

PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0
STATUS=0
BODY=""
RESET_AVAILABLE=false
TOKEN=""
PRODUCT_ID=""
OAUTH_PRODUCT_ID=""

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

pass() {
  PASS_COUNT=$((PASS_COUNT + 1))
  printf '[PASS] %s\n' "$1"
}

fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  printf '[FAIL] %s\n' "$1"
  printf '       expected: %s\n' "$2"
  printf '       actual:   %s\n' "$3"
}

skip() {
  SKIP_COUNT=$((SKIP_COUNT + 1))
  printf '[SKIP] %s\n' "$1"
}

section() {
  printf '\n--- %s ---\n' "$1"
}

short_body() {
  printf '%s' "$BODY" | tr '\n' ' ' | cut -c1-190
}

expect_status() {
  local expected="$1"
  local label="$2"
  local actual="${3:-$STATUS}"
  if [[ "$actual" == "$expected" ]]; then
    pass "$label"
  else
    fail "$label" "HTTP $expected" "HTTP $actual | $(short_body)"
  fi
}

expect_true() {
  local label="$1"
  local condition="$2"
  local detail="${3:-condition was false}"
  if [[ "$condition" == "true" ]]; then
    pass "$label"
  else
    fail "$label" "true" "$detail"
  fi
}

json_field() {
  node -e '
    let input = "";
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => {
      let value;
      try { value = JSON.parse(input); } catch (_error) { process.exit(2); }
      for (const key of process.argv[1].split(".")) {
        if (value === null || value === undefined) process.exit(3);
        value = value[key];
      }
      if (value === null || value === undefined) process.exit(3);
      process.stdout.write(typeof value === "object" ? JSON.stringify(value) : String(value));
    });
  ' "$1" 2>/dev/null
}

json_length() {
  node -e '
    let input = "";
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => {
      try {
        const value = JSON.parse(input);
        process.stdout.write(String(Array.isArray(value) ? value.length : -1));
      } catch (_error) {
        process.stdout.write("-1");
      }
    });
  ' 2>/dev/null
}

call() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  local token="${4:-}"
  local origin="${5:-}"

  local args=(
    -sS
    -o "$TMP_DIR/body"
    -D "$TMP_DIR/headers"
    -w '%{http_code}'
    -X "$method"
    "$BASE_URL$path"
    -H 'Accept: application/json'
  )

  if [[ -n "$body" ]]; then
    args+=(-H 'Content-Type: application/json' --data "$body")
  fi
  if [[ -n "$token" ]]; then
    args+=(-H "Authorization: Bearer $token")
  fi
  if [[ -n "$origin" ]]; then
    args+=(-H "Origin: $origin")
  fi

  if ! STATUS="$(curl "${args[@]}" 2>"$TMP_DIR/curl-error")"; then
    STATUS=0
    BODY="$(cat "$TMP_DIR/curl-error")"
    return
  fi

  BODY="$(cat "$TMP_DIR/body")"
}

header_value() {
  local name="$1"
  awk -v name="$name" '
    BEGIN { IGNORECASE = 1 }
    index(tolower($0), tolower(name) ":") == 1 {
      sub(/^[^:]+:[[:space:]]*/, "")
      sub(/\r$/, "")
      print
      exit
    }
  ' "$TMP_DIR/headers" 2>/dev/null
}

reset_limits() {
  call POST /api/dev/reset-rate-limits
  if [[ "$STATUS" == "200" ]]; then
    RESET_AVAILABLE=true
    return 0
  fi
  return 1
}

# -----------------------------------------------------------------------------
# Preconditions
# -----------------------------------------------------------------------------
printf 'ENSTA WAMD TD-TP 3 - API verification\n'
printf 'Base URL: %s\n' "$BASE_URL"
printf 'Test user: %s\n' "$TEST_EMAIL"

section "Health and static client"

call GET /api/health
expect_status 200 "GET /api/health returns 200"
HEALTH_STATUS="$(printf '%s' "$BODY" | json_field status)"
expect_true "Health payload reports status=ok" "$([[ "$HEALTH_STATUS" == "ok" ]] && echo true || echo false)" "status=${HEALTH_STATUS:-missing}"

if [[ "$STATUS" == "0" ]]; then
  printf '\nThe API is not reachable. Start it with: npm start\n'
  exit 1
fi

GENERAL_MAX="$(printf '%s' "$BODY" | json_field rateLimit.generalMax)"
LOGIN_MAX="$(printf '%s' "$BODY" | json_field rateLimit.loginMax)"
GENERAL_MAX="${GENERAL_MAX:-100}"
LOGIN_MAX="${LOGIN_MAX:-5}"

if reset_limits; then
  pass "Development rate-limit reset is available"
else
  skip "Development reset unavailable; limiter assertions will be tolerant"
fi

UI_STATUS="$(curl -sS -o "$TMP_DIR/index.html" -w '%{http_code}' "$BASE_URL/" 2>/dev/null || echo 0)"
if [[ "$UI_STATUS" == "200" ]] && grep -q "WAMD Commerce" "$TMP_DIR/index.html"; then
  pass "Static dashboard is served at /"
else
  fail "Static dashboard is served at /" "HTTP 200 containing WAMD Commerce" "HTTP $UI_STATUS"
fi

# -----------------------------------------------------------------------------
section "Registration validation"
# -----------------------------------------------------------------------------
call POST /api/auth/register '{"name":"Incomplete"}'
expect_status 400 "Register without email/password returns 400"

call POST /api/auth/register '{"name":"Bad Email","email":"not-an-email","password":"Password123!"}'
expect_status 400 "Register with invalid email returns 400"

call POST /api/auth/register '{"name":"Short Password","email":"short@ensta.dz","password":"123"}'
expect_status 400 "Register with short password returns 400"

call POST /api/auth/register "$(printf '{"name":"TP3 Tester","email":"%s","password":"%s"}' "$TEST_EMAIL" "$TEST_PASSWORD")"
expect_status 201 "Register a new user returns 201"
REGISTERED_ID="$(printf '%s' "$BODY" | json_field user.id)"
REGISTERED_EMAIL="$(printf '%s' "$BODY" | json_field user.email)"
expect_true "Registration returns a user id" "$([[ -n "$REGISTERED_ID" ]] && echo true || echo false)"
expect_true "Registration returns the normalized email" "$([[ "$REGISTERED_EMAIL" == "$TEST_EMAIL" ]] && echo true || echo false)" "email=${REGISTERED_EMAIL:-missing}"
if printf '%s' "$BODY" | grep -qi 'passwordHash'; then
  fail "Registration does not expose the password hash" "no passwordHash field" "passwordHash was returned"
else
  pass "Registration does not expose the password hash"
fi

call POST /api/auth/register "$(printf '{"name":"Duplicate","email":"%s","password":"%s"}' "$TEST_EMAIL" "$TEST_PASSWORD")"
expect_status 409 "Duplicate email returns 409 Conflict"

call POST /api/auth/register '{"name":'
expect_status 400 "Malformed JSON body returns 400"

# -----------------------------------------------------------------------------
section "Login and JWT authentication"
# -----------------------------------------------------------------------------
call POST /api/auth/login "$(printf '{"email":"%s","password":"wrong-password"}' "$TEST_EMAIL")"
expect_status 401 "Login with a wrong password returns 401"

call POST /api/auth/login "$(printf '{"email":"%s","password":"%s"}' "$TEST_EMAIL" "$TEST_PASSWORD")"
expect_status 200 "Login with valid credentials returns 200"
TOKEN="$(printf '%s' "$BODY" | json_field token)"
LOGIN_USER_EMAIL="$(printf '%s' "$BODY" | json_field user.email)"
expect_true "Login returns a non-empty JWT" "$([[ -n "$TOKEN" ]] && echo true || echo false)" "no token returned"
expect_true "Login returns the user object" "$([[ "$LOGIN_USER_EMAIL" == "$TEST_EMAIL" ]] && echo true || echo false)" "email=${LOGIN_USER_EMAIL:-missing}"
if [[ "$TOKEN" == *.*.* ]]; then
  pass "Returned token has the JWT compact serialization (3 segments)"
else
  fail "Returned token has the JWT compact serialization (3 segments)" "header.payload.signature" "unexpected token format"
fi

call GET /api/auth/me "" "$TOKEN"
expect_status 200 "GET /api/auth/me with JWT returns 200"
ME_EMAIL="$(printf '%s' "$BODY" | json_field user.email)"
expect_true "GET /api/auth/me returns the authenticated user" "$([[ "$ME_EMAIL" == "$TEST_EMAIL" ]] && echo true || echo false)" "email=${ME_EMAIL:-missing}"

call GET /api/auth/me
expect_status 401 "Protected /api/auth/me without token returns 401"

call GET /api/auth/me "" "invalid.token.value"
expect_status 401 "Protected /api/auth/me with an invalid token returns 401"

# -----------------------------------------------------------------------------
section "Public product reads"
# -----------------------------------------------------------------------------
call GET /api/products
expect_status 200 "GET /api/products returns 200"
PRODUCT_COUNT="$(printf '%s' "$BODY" | json_length)"
if [[ "$PRODUCT_COUNT" -ge 10 ]]; then
  pass "Seed catalogue contains at least 10 products (found $PRODUCT_COUNT)"
else
  fail "Seed catalogue contains at least 10 products" ">= 10" "found $PRODUCT_COUNT"
fi

FIRST_ID="$(printf '%s' "$BODY" | json_field 0.id)"
if [[ -z "$FIRST_ID" ]]; then
  # Tolerate the Mongo _id shape when reading a lean document from an older build.
  FIRST_ID="$(printf '%s' "$BODY" | json_field 0._id)"
fi

call GET "/api/products/$FIRST_ID"
expect_status 200 "GET /api/products/:id returns 200 for an existing product"
SINGLE_ID="$(printf '%s' "$BODY" | json_field id)"
expect_true "Single product response contains an id" "$([[ -n "$SINGLE_ID" ]] && echo true || echo false)"

call GET /api/products/not-an-object-id
expect_status 404 "GET /api/products/:id returns 404 for a malformed id"

call GET /api/products/000000000000000000000000
expect_status 404 "GET /api/products/:id returns 404 for a missing product"

# -----------------------------------------------------------------------------
section "Protected product writes"
# -----------------------------------------------------------------------------
call POST /api/products '{"name":"Unauthorized item","price":10}'
expect_status 401 "POST /api/products without a token returns 401"

call POST /api/products '{"name":"Bad token item","price":10}' "invalid.token.value"
expect_status 401 "POST /api/products with an invalid token returns 401"

call POST /api/products "$(printf '{"name":"TP3 Test Product %s","description":"Created by test-api.sh","price":129.9,"category":"Testing","imageUrl":"https://example.com/product.jpg","stock":3}' "$STAMP")" "$TOKEN"
expect_status 201 "POST /api/products with a valid JWT returns 201"
PRODUCT_ID="$(printf '%s' "$BODY" | json_field id)"
CREATED_NAME="$(printf '%s' "$BODY" | json_field name)"
expect_true "Created product has an id" "$([[ -n "$PRODUCT_ID" ]] && echo true || echo false)"
expect_true "Created product name matches the payload" "$([[ "$CREATED_NAME" == TP3* ]] && echo true || echo false)" "name=${CREATED_NAME:-missing}"

call POST /api/products '{"description":"No name or price"}' "$TOKEN"
expect_status 400 "POST /api/products with invalid fields returns 400"

call GET "/api/products/$PRODUCT_ID"
expect_status 200 "GET the newly created product returns 200"

call PUT "/api/products/$PRODUCT_ID" '{"price":149.99,"stock":7}' "$TOKEN"
expect_status 200 "PUT /api/products/:id with a valid JWT returns 200"
UPDATED_PRICE="$(printf '%s' "$BODY" | json_field price)"
UPDATED_STOCK="$(printf '%s' "$BODY" | json_field stock)"
expect_true "PUT updates the price" "$([[ "$UPDATED_PRICE" == "149.99" ]] && echo true || echo false)" "price=${UPDATED_PRICE:-missing}"
expect_true "PUT updates the stock" "$([[ "$UPDATED_STOCK" == "7" ]] && echo true || echo false)" "stock=${UPDATED_STOCK:-missing}"

call PUT "/api/products/$PRODUCT_ID" '{"price":-5}' "$TOKEN"
expect_status 400 "PUT with a negative price returns 400"

call PUT /api/products/000000000000000000000000 '{"price":10}' "$TOKEN"
expect_status 404 "PUT a missing product returns 404"

call PUT "/api/products/$PRODUCT_ID" '{"price":10}'
expect_status 401 "PUT without a token returns 401"

call DELETE "/api/products/$PRODUCT_ID"
expect_status 401 "DELETE without a token returns 401"

# -----------------------------------------------------------------------------
section "OAuth2 / OpenID Connect bearer token"
# -----------------------------------------------------------------------------
MOCK_ENABLED="${OAUTH2_MOCK_ENABLED:-}"
if [[ -z "$MOCK_ENABLED" && -f .env ]]; then
  MOCK_ENABLED="$(grep -iE '^[[:space:]]*OAUTH2_MOCK_ENABLED=' .env | tail -1 | cut -d= -f2 | tr -d '[:space:]')"
fi
MOCK_TOKEN="${OAUTH2_MOCK_TOKEN:-ensta-demo-oauth-token}"

if [[ "${MOCK_ENABLED,,}" == "true" ]]; then
  call GET /api/auth/me "" "$MOCK_TOKEN"
  if [[ "$STATUS" == "200" ]]; then
    OAUTH_PROVIDER="$(printf '%s' "$BODY" | json_field user.provider)"
    pass "OAuth2 mock token is accepted by /api/auth/me"
    expect_true "OAuth2 identity reports its provider" "$([[ "$OAUTH_PROVIDER" == oauth2* ]] && echo true || echo false)" "provider=${OAUTH_PROVIDER:-missing}"

    call POST /api/products "$(printf '{"name":"OAuth2 Test Product %s","price":79.5,"category":"Testing","stock":1}' "$STAMP")" "$MOCK_TOKEN"
    expect_status 201 "OAuth2 mock token can create a product (201)"
    OAUTH_PRODUCT_ID="$(printf '%s' "$BODY" | json_field id)"

    if [[ -n "$OAUTH_PRODUCT_ID" ]]; then
      call DELETE "/api/products/$OAUTH_PRODUCT_ID" "" "$TOKEN"
      expect_status 200 "JWT can delete the OAuth2-created product"
      OAUTH_PRODUCT_ID=""
    fi
  else
    skip "OAuth2 mock token is not enabled (received HTTP $STATUS)"
  fi
else
  skip "OAuth2 mock validation is disabled in this environment"
fi

# -----------------------------------------------------------------------------
section "CORS and routing"
# -----------------------------------------------------------------------------
PREFLIGHT_STATUS="$(curl -sS -o /dev/null -D "$TMP_DIR/headers" -w '%{http_code}' \
  -X OPTIONS "$BASE_URL/api/products" \
  -H 'Origin: http://localhost:5000' \
  -H 'Access-Control-Request-Method: GET' \
  -H 'Access-Control-Request-Headers: authorization,content-type' 2>/dev/null || echo 0)"
if [[ "$PREFLIGHT_STATUS" == "204" ]]; then
  pass "CORS preflight from an allowed origin returns 204"
else
  fail "CORS preflight from an allowed origin returns 204" "HTTP 204" "HTTP $PREFLIGHT_STATUS"
fi
ALLOW_ORIGIN="$(header_value Access-Control-Allow-Origin)"
expect_true "CORS response echoes the allowed origin" "$([[ "$ALLOW_ORIGIN" == "http://localhost:5000" ]] && echo true || echo false)" "header=${ALLOW_ORIGIN:-missing}"

call GET /api/does-not-exist
expect_status 404 "Unknown API route returns JSON 404"

# -----------------------------------------------------------------------------
section "Product cleanup"
# -----------------------------------------------------------------------------
if [[ -n "$PRODUCT_ID" ]]; then
  call DELETE "/api/products/$PRODUCT_ID" "" "$TOKEN"
  expect_status 200 "DELETE /api/products/:id with a valid JWT returns 200"
  call DELETE "/api/products/$PRODUCT_ID" "" "$TOKEN"
  expect_status 404 "Deleting the same product twice returns 404"
else
  skip "Product cleanup skipped because creation failed"
fi

if [[ -n "$OAUTH_PRODUCT_ID" ]]; then
  call DELETE "/api/products/$OAUTH_PRODUCT_ID" "" "$TOKEN"
fi

# -----------------------------------------------------------------------------
section "Strict login rate limiting (429)"
# -----------------------------------------------------------------------------
if reset_limits; then
  pass "Limiter counters reset before the login test"
else
  skip "Could not reset limiter counters before the login test"
fi

SAW_401=0
SAW_429=0
RETRY_AFTER=""
LOGIN_LIMIT_BODY=""
for ((i = 1; i <= LOGIN_MAX + 3; i++)); do
  call POST /api/auth/login '{"email":"rate.limit@ensta.dz","password":"incorrect-password"}'
  if [[ "$STATUS" == "401" ]]; then
    SAW_401=$((SAW_401 + 1))
  elif [[ "$STATUS" == "429" ]]; then
    SAW_429=1
    RETRY_AFTER="$(header_value Retry-After)"
    LOGIN_LIMIT_BODY="$BODY"
    break
  fi
done

if [[ "$SAW_429" == "1" ]]; then
  pass "Login endpoint eventually returns 429 after repeated attempts"
else
  fail "Login endpoint eventually returns 429 after repeated attempts" "HTTP 429" "never observed within $((LOGIN_MAX + 3)) attempts"
fi

if [[ "$RESET_AVAILABLE" == "true" ]]; then
  if [[ "$SAW_401" == "$LOGIN_MAX" ]]; then
    pass "Exactly $LOGIN_MAX failed logins are accepted before the limiter fires"
  else
    fail "Exactly $LOGIN_MAX failed logins are accepted before the limiter fires" "$LOGIN_MAX" "$SAW_401"
  fi
fi

RETRY_AFTER_JSON="$(printf '%s' "$LOGIN_LIMIT_BODY" | json_field retryAfter)"
if [[ "$RETRY_AFTER_JSON" =~ ^[0-9]+$ ]] && [[ "$RETRY_AFTER_JSON" -gt 0 ]]; then
  pass "429 JSON body includes a positive retryAfter value"
else
  fail "429 JSON body includes a positive retryAfter value" "positive integer" "retryAfter=${RETRY_AFTER_JSON:-missing}"
fi

if [[ -n "$RETRY_AFTER" && "$RETRY_AFTER" =~ ^[0-9]+$ ]]; then
  pass "429 response includes a Retry-After header"
else
  fail "429 response includes a Retry-After header" "numeric Retry-After" "header=${RETRY_AFTER:-missing}"
fi

# -----------------------------------------------------------------------------
section "General API rate limiting (429)"
# -----------------------------------------------------------------------------
if [[ "${GENERAL_TEST,,}" == "true" ]]; then
  skip "General limiter test disabled with SKIP_GENERAL_RATE_TEST"
else
  if reset_limits; then
    pass "Limiter counters reset before the general test"
  fi

  GENERAL_SUCCESS=0
  GENERAL_429=0
  GENERAL_LIMIT_BODY=""
  LIMIT_HEADER=""

  for ((i = 1; i <= GENERAL_MAX + 5; i++)); do
    call GET /api/products
    if [[ "$STATUS" == "200" ]]; then
      GENERAL_SUCCESS=$((GENERAL_SUCCESS + 1))
    elif [[ "$STATUS" == "429" ]]; then
      GENERAL_429=1
      GENERAL_LIMIT_BODY="$BODY"
      LIMIT_HEADER="$(header_value RateLimit)"
      break
    fi
  done

  if [[ "$GENERAL_429" == "1" ]]; then
    pass "General API limiter returns 429 after the configured budget"
  else
    fail "General API limiter returns 429 after the configured budget" "HTTP 429" "never observed within $((GENERAL_MAX + 5)) requests"
  fi

  if [[ "$RESET_AVAILABLE" == "true" ]]; then
    if [[ "$GENERAL_SUCCESS" == "$GENERAL_MAX" ]]; then
      pass "Exactly $GENERAL_MAX general requests are accepted before the limiter fires"
    else
      fail "Exactly $GENERAL_MAX general requests are accepted before the limiter fires" "$GENERAL_MAX" "$GENERAL_SUCCESS"
    fi
  fi

  GENERAL_RETRY="$(printf '%s' "$GENERAL_LIMIT_BODY" | json_field retryAfter)"
  if [[ "$GENERAL_RETRY" =~ ^[0-9]+$ ]] && [[ "$GENERAL_RETRY" -gt 0 ]]; then
    pass "General 429 JSON body includes retryAfter"
  else
    fail "General 429 JSON body includes retryAfter" "positive integer" "retryAfter=${GENERAL_RETRY:-missing}"
  fi

  if [[ -n "$LIMIT_HEADER" ]]; then
    pass "RateLimit standard header is present on limited responses"
  else
    skip "RateLimit standard header was not captured"
  fi
fi

# -----------------------------------------------------------------------------
# Leave the development server usable after the demonstration.
# -----------------------------------------------------------------------------
section "Cleanup"
if reset_limits; then
  pass "Rate-limit counters reset after the test run"
else
  skip "Counters not reset; restart the server to clear the in-memory stores"
fi

printf '\n=============================================\n'
printf 'PASS: %d  FAIL: %d  SKIP: %d\n' "$PASS_COUNT" "$FAIL_COUNT" "$SKIP_COUNT"
printf '=============================================\n'

if [[ "$FAIL_COUNT" -gt 0 ]]; then
  exit 1
fi

exit 0
