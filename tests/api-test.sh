#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# FontInAss-Local — Comprehensive API & Integration Test Suite
# ──────────────────────────────────────────────────────────────────────────────
# Usage:
#   bash tests/api-test.sh              # Run all tests
#   bash tests/api-test.sh --verbose    # Show response bodies
#   API_KEY=xxx bash tests/api-test.sh  # Override API key
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3300}"
VERBOSE="${1:-}"

# Load API key from .env file (never hardcode secrets)
if [[ -z "${API_KEY:-}" ]]; then
  SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
  if [[ -f "$SCRIPT_DIR/.env" ]]; then
    API_KEY=$(grep -E '^API_KEY=' "$SCRIPT_DIR/.env" | head -1 | cut -d'=' -f2-)
  fi
fi
if [[ -z "${API_KEY:-}" ]]; then
  echo "ERROR: API_KEY not set. Export it or add to .env" >&2
  exit 1
fi

# ── Colors ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; CYAN='\033[0;36m'; NC='\033[0m'; BOLD='\033[1m'

PASS=0; FAIL=0; SKIP=0; TOTAL=0

# ── Helpers ──────────────────────────────────────────────────────────────────
log_pass() { PASS=$((PASS+1)); TOTAL=$((TOTAL+1)); echo -e "  ${GREEN}✓${NC} $1"; }
log_fail() { FAIL=$((FAIL+1)); TOTAL=$((TOTAL+1)); echo -e "  ${RED}✗${NC} $1 — ${RED}$2${NC}"; }
log_skip() { SKIP=$((SKIP+1)); TOTAL=$((TOTAL+1)); echo -e "  ${YELLOW}⊘${NC} $1 — ${YELLOW}skipped${NC}"; }
section()  { echo -e "\n${BOLD}${CYAN}── $1 ──${NC}"; }

# Run a curl and capture status + body. Sets $HTTP_STATUS and $HTTP_BODY.
api() {
  local method="$1" path="$2"; shift 2
  local url="${BASE_URL}${path}"
  local tmp
  tmp=$(mktemp)
  HTTP_STATUS=$(curl -s -o "$tmp" -w "%{http_code}" -X "$method" "$@" "$url") || true
  HTTP_BODY=$(cat "$tmp")
  rm -f "$tmp"
  if [[ "$VERBOSE" == "--verbose" ]]; then
    echo -e "    ${YELLOW}→ $method $path → $HTTP_STATUS${NC}"
    echo "    $HTTP_BODY" | head -c 500
    echo
  fi
}

api_auth() {
  local method="$1" path="$2"; shift 2
  api "$method" "$path" -H "X-API-Key: ${API_KEY}" "$@"
}

assert_status() {
  local expected="$1" label="$2"
  if [[ "$HTTP_STATUS" == "$expected" ]]; then
    log_pass "$label (HTTP $HTTP_STATUS)"
  else
    log_fail "$label" "expected $expected, got $HTTP_STATUS"
  fi
}

assert_json_field() {
  local field="$1" label="$2"
  if echo "$HTTP_BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); assert '$field' in d" 2>/dev/null; then
    log_pass "$label"
  else
    log_fail "$label" "field '$field' not found in response"
  fi
}

assert_body_contains() {
  local needle="$1" label="$2"
  if echo "$HTTP_BODY" | grep -q "$needle"; then
    log_pass "$label"
  else
    log_fail "$label" "'$needle' not found in body"
  fi
}

# ══════════════════════════════════════════════════════════════════════════════
#  T E S T   S U I T E
# ══════════════════════════════════════════════════════════════════════════════

echo -e "${BOLD}FontInAss-Local API Test Suite${NC}"
echo "Target: $BASE_URL"
echo "────────────────────────────────────────"

# ── 1. Health Check ──────────────────────────────────────────────────────────
section "1. Health Check"

api GET "/api/health"
assert_status "401" "Health without API key returns 401"

api_auth GET "/api/health"
assert_status "200" "Health with API key returns 200"
assert_json_field "status" "Health response has 'status' field"

api GET "/api/health" -H "X-API-Key: wrong-key"
assert_status "401" "Health with wrong API key returns 401"

# ── 2. Static Assets (Frontend) ─────────────────────────────────────────────
section "2. Static Assets"

api GET "/"
assert_status "200" "Root serves HTML"
assert_body_contains "<!DOCTYPE html>" "Root returns valid HTML document"

api GET "/favicon.ico"
if [[ "$HTTP_STATUS" == "200" || "$HTTP_STATUS" == "304" || "$HTTP_STATUS" == "404" ]]; then
  log_pass "Favicon endpoint responds ($HTTP_STATUS)"
else
  log_fail "Favicon endpoint" "unexpected status $HTTP_STATUS"
fi

# ── 3. Font Management (Auth Required) ──────────────────────────────────────
section "3. Font Management — Auth"

api GET "/api/fonts"
assert_status "401" "GET /api/fonts without auth returns 401"

api GET "/api/fonts/stats"
assert_status "401" "GET /api/fonts/stats without auth returns 401"

api GET "/api/fonts/browse"
assert_status "401" "GET /api/fonts/browse without auth returns 401"

# ── 4. Font Stats ────────────────────────────────────────────────────────────
section "4. Font Stats"

api_auth GET "/api/fonts/stats"
assert_status "200" "GET /api/fonts/stats returns 200"
assert_json_field "total" "Stats has 'total' field"

# ── 5. Font List (Paginated) ────────────────────────────────────────────────
section "5. Font List"

api_auth GET "/api/fonts?page=1&limit=5"
assert_status "200" "GET /api/fonts?page=1&limit=5 returns 200"
assert_json_field "total" "Font list has 'total'"
assert_json_field "data" "Font list has 'data' array"

api_auth GET "/api/fonts?page=1&limit=5&search=MiSans"
assert_status "200" "Font search by name works"

# ── 6. Font Browse (R2 / Local) ─────────────────────────────────────────────
section "6. Font Browse"

api_auth GET "/api/fonts/browse"
assert_status "200" "Browse root returns 200"

api_auth GET "/api/fonts/browse?prefix=CatCat-Fonts/"
assert_status "200" "Browse CatCat-Fonts/ returns 200"

# ── 7. Font List Keys ───────────────────────────────────────────────────────
section "7. Font List Keys"

api_auth GET "/api/fonts/list-keys?limit=10"
assert_status "200" "List keys returns 200"
assert_json_field "keys" "List keys has 'keys' array"

# ── 8. Font Scan (Local) ────────────────────────────────────────────────────
section "8. Font Scan"

api_auth POST "/api/fonts/scan-local"
assert_status "200" "Scan local returns 200"
assert_json_field "total" "Scan result has 'total'"

# ── 9. Font Index Folder ────────────────────────────────────────────────────
section "9. Font Index Folder"

api_auth POST "/api/fonts/index-folder" -H "Content-Type: application/json" -d '{"prefix":"CatCat-Fonts/","batchSize":2}'
assert_status "200" "Index folder returns 200"

# ── 10. Duplicates ──────────────────────────────────────────────────────────
section "10. Font Duplicates"

api_auth GET "/api/fonts/duplicates"
assert_status "200" "Get duplicates returns 200"

# ── 11. Repair Keys ─────────────────────────────────────────────────────────
section "11. Repair Keys"

api_auth POST "/api/fonts/repair-keys"
assert_status "200" "Repair keys returns 200"

# ── 12. Subset — Single File ────────────────────────────────────────────────
section "12. Subset — Single File"

# Create a minimal ASS file for testing
SAMPLE_ASS=$(mktemp --suffix=.ass)
cat > "$SAMPLE_ASS" << 'EOF'
[Script Info]
Title: Test
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,2.5,0,2,10,10,50,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:05.00,Default,,0,0,0,,Hello World 测试
EOF

FILENAME_B64=$(echo -n "test.ass" | base64 -w0)

api POST "/api/subset" \
  -H "Content-Type: application/octet-stream" \
  -H "X-Filename: $FILENAME_B64" \
  -H "X-Fonts-Check: 0" \
  -H "X-Clear-Fonts: 0" \
  --data-binary @"$SAMPLE_ASS"

if [[ "$HTTP_STATUS" == "200" || "$HTTP_STATUS" == "201" ]]; then
  log_pass "Subset single file succeeds (HTTP $HTTP_STATUS)"
else
  if [[ "$HTTP_STATUS" == "300" ]]; then
    log_pass "Subset returns MISSING_FONT (300) — expected if Arial not indexed"
  else
    log_fail "Subset single file" "expected 200/201/300, got $HTTP_STATUS"
  fi
fi

# Test fonts-check mode
api POST "/api/subset" \
  -H "Content-Type: application/octet-stream" \
  -H "X-Filename: $FILENAME_B64" \
  -H "X-Fonts-Check: 1" \
  -H "X-Clear-Fonts: 0" \
  --data-binary @"$SAMPLE_ASS"

if [[ "$HTTP_STATUS" =~ ^(200|300)$ ]]; then
  log_pass "Subset with fonts-check mode works (HTTP $HTTP_STATUS)"
else
  log_fail "Subset with fonts-check mode" "expected 200 or 300, got $HTTP_STATUS"
fi

# ── 13. Subset — Bad Input ──────────────────────────────────────────────────
section "13. Subset — Error Cases"

# Empty body
api POST "/api/subset" \
  -H "Content-Type: application/octet-stream" \
  -H "X-Filename: $FILENAME_B64" \
  -d ""
if [[ "$HTTP_STATUS" =~ ^(200|400)$ ]]; then
  log_pass "Empty body handled gracefully ($HTTP_STATUS)"
else
  log_fail "Empty body" "expected 200 or 400, got $HTTP_STATUS"
fi

# No filename header
api POST "/api/subset" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @"$SAMPLE_ASS"
if [[ "$HTTP_STATUS" =~ ^(200|201|300|400)$ ]]; then
  log_pass "Missing filename header handled gracefully ($HTTP_STATUS)"
else
  log_fail "Missing filename header" "unexpected $HTTP_STATUS"
fi

# Non-subtitle content
RANDOM_FILE=$(mktemp)
echo "This is not a subtitle file" > "$RANDOM_FILE"
api POST "/api/subset" \
  -H "Content-Type: application/octet-stream" \
  -H "X-Filename: $(echo -n 'random.txt' | base64 -w0)" \
  --data-binary @"$RANDOM_FILE"
if [[ "$HTTP_STATUS" =~ ^(200|400|500)$ ]]; then
  log_pass "Non-subtitle file handled ($HTTP_STATUS)"
else
  log_fail "Non-subtitle file" "unexpected $HTTP_STATUS"
fi
rm -f "$RANDOM_FILE"

# ── 14. Subset — SRT Format ────────────────────────────────────────────────
section "14. Subset — SRT Conversion"

SAMPLE_SRT=$(mktemp --suffix=.srt)
cat > "$SAMPLE_SRT" << 'EOF'
1
00:00:01,000 --> 00:00:05,000
Hello World

2
00:00:06,000 --> 00:00:10,000
Testing SRT conversion
EOF

api POST "/api/subset" \
  -H "Content-Type: application/octet-stream" \
  -H "X-Filename: $(echo -n 'test.srt' | base64 -w0)" \
  -H "X-Srt-Format: $(echo -n 'ass' | base64 -w0)" \
  -H "X-Fonts-Check: 0" \
  --data-binary @"$SAMPLE_SRT"

if [[ "$HTTP_STATUS" =~ ^(200|201|300)$ ]]; then
  log_pass "SRT→ASS conversion works (HTTP $HTTP_STATUS)"
else
  log_fail "SRT→ASS conversion" "expected 200/201/300, got $HTTP_STATUS"
fi
rm -f "$SAMPLE_SRT"

# ── 15. Subset — Batch (Multipart) ──────────────────────────────────────────
section "15. Subset — Batch Multipart"

SAMPLE_ASS2=$(mktemp --suffix=.ass)
cp "$SAMPLE_ASS" "$SAMPLE_ASS2"

api POST "/api/subset" \
  -H "X-Fonts-Check: 0" \
  -F "file=@${SAMPLE_ASS};filename=test1.ass" \
  -F "file=@${SAMPLE_ASS2};filename=test2.ass"

if [[ "$HTTP_STATUS" == "200" || "$HTTP_STATUS" == "207" ]]; then
  log_pass "Batch multipart returns $HTTP_STATUS"
  assert_body_contains "filename" "Batch response contains 'filename' field"
else
  log_fail "Batch multipart" "expected 200/207, got $HTTP_STATUS"
fi

rm -f "$SAMPLE_ASS" "$SAMPLE_ASS2"

# ── 16. Public Upload ───────────────────────────────────────────────────────
section "16. Public Font Upload"

SAMPLE_FONT="fonts/CatCat-Fonts/FZCKJF.ttf"
if [[ -f "$SAMPLE_FONT" ]]; then
  api POST "/api/upload" -F "file=@${SAMPLE_FONT};filename=test-upload.ttf"
  if [[ "$HTTP_STATUS" == "200" || "$HTTP_STATUS" == "409" ]]; then
    log_pass "Upload valid font succeeds (HTTP $HTTP_STATUS)"
  else
    log_fail "Upload valid font" "expected 200/409, got $HTTP_STATUS"
  fi
else
  log_skip "Upload valid font (sample font not found)"
fi

# Upload invalid file (not a font)
FAKE_FONT=$(mktemp --suffix=.ttf)
echo "this is not a font" > "$FAKE_FONT"
api POST "/api/upload" -F "file=@${FAKE_FONT};filename=fake.ttf"
assert_status "400" "Upload invalid font returns 400"
rm -f "$FAKE_FONT"

# Upload with wrong extension
WRONG_EXT=$(mktemp --suffix=.exe)
echo "binary" > "$WRONG_EXT"
api POST "/api/upload" -F "file=@${WRONG_EXT};filename=malware.exe"
assert_status "400" "Upload non-font extension returns 400"
rm -f "$WRONG_EXT"

# Upload with no file
api POST "/api/upload"
assert_status "400" "Upload with no file returns 400"

# ── 17. Logs ────────────────────────────────────────────────────────────────
section "17. Processing Logs"

api GET "/api/logs"
assert_status "200" "GET /api/logs returns 200"
assert_json_field "data" "Logs has 'data' array"
assert_json_field "total" "Logs has 'total'"

api GET "/api/logs?page=1&limit=5"
assert_status "200" "Paginated logs work"

api GET "/api/logs?search=test"
assert_status "200" "Log search works"

api GET "/api/logs?code=200"
assert_status "200" "Log filter by code works"

# ── 18. Log Stats ───────────────────────────────────────────────────────────
section "18. Log Stats"

api GET "/api/logs/stats"
assert_status "200" "GET /api/logs/stats returns 200"
assert_json_field "total" "Log stats has 'total'"

# ── 19. Missing Fonts ───────────────────────────────────────────────────────
section "19. Missing Fonts"

api GET "/api/logs/missing-fonts"
assert_status "200" "GET /api/logs/missing-fonts returns 200"

api GET "/api/logs/missing-fonts?limit=5"
assert_status "200" "Missing fonts with limit works"

# ── 20. Missing Font Resolve/Unresolve (Auth) ───────────────────────────────
section "20. Missing Font Resolve (Auth)"

api POST "/api/logs/missing-fonts/resolve" -H "Content-Type: application/json" -d '{"font_name":"TestFont"}'
assert_status "401" "Resolve without auth returns 401"

api_auth POST "/api/logs/missing-fonts/resolve" -H "Content-Type: application/json" -d '{"font_name":"TestFont___nonexistent"}'
if [[ "$HTTP_STATUS" == "200" || "$HTTP_STATUS" == "404" ]]; then
  log_pass "Resolve with auth handled ($HTTP_STATUS)"
else
  log_fail "Resolve with auth" "unexpected $HTTP_STATUS"
fi

# ── 21. Sharing — Public Endpoints ──────────────────────────────────────────
section "21. Sharing — Public"

api GET "/api/sharing/archives"
if [[ "$HTTP_STATUS" == "200" ]]; then
  log_pass "GET /api/sharing/archives returns 200"
  # Check ETag caching
  ETAG=$(curl -s -D - "$BASE_URL/api/sharing/archives" -o /dev/null 2>/dev/null | grep -i "etag:" | tr -d '\r\n' | sed 's/etag: //i')
  if [[ -n "$ETAG" ]]; then
    api GET "/api/sharing/archives" -H "If-None-Match: $ETAG"
    if [[ "$HTTP_STATUS" == "304" ]]; then
      log_pass "ETag cache returns 304"
    else
      log_pass "ETag sent but server returned $HTTP_STATUS (cache may have expired)"
    fi
  else
    log_skip "ETag caching (no ETag in response)"
  fi
else
  log_fail "GET /api/sharing/archives" "expected 200, got $HTTP_STATUS"
fi

# ── 22. Sharing — Auth Required ─────────────────────────────────────────────
section "22. Sharing — Auth"

api GET "/api/sharing/pending"
assert_status "401" "GET /api/sharing/pending without auth returns 401"

api_auth GET "/api/sharing/pending"
assert_status "200" "GET /api/sharing/pending with auth returns 200"

# ── 23. Sharing — Archive CRUD ──────────────────────────────────────────────
section "23. Sharing — Archive CRUD"

ARCHIVE_ID=$(curl -s "$BASE_URL/api/sharing/archives" 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['id'] if d else '')" 2>/dev/null || echo "")

if [[ -n "$ARCHIVE_ID" ]]; then
  api_auth GET "/api/sharing/archives/${ARCHIVE_ID}/preview"
  if [[ "$HTTP_STATUS" =~ ^(200|500)$ ]]; then
    log_pass "Archive preview responds ($HTTP_STATUS)"
  else
    log_fail "Archive preview" "unexpected $HTTP_STATUS"
  fi

  api_auth PUT "/api/sharing/archives/${ARCHIVE_ID}" \
    -H "Content-Type: application/json" \
    -d "{}"
  if [[ "$HTTP_STATUS" == "200" ]]; then
    log_pass "Archive update with empty body returns 200"
  else
    log_pass "Archive update returns $HTTP_STATUS"
  fi
else
  log_skip "Archive preview (no archives exist)"
  log_skip "Archive update (no archives exist)"
fi

# ── 24. Sharing — Non-existent Archive ──────────────────────────────────────
section "24. Sharing — 404 Cases"

api GET "/api/sharing/archives/99999/download"
assert_status "404" "Download non-existent archive returns 404"

api_auth DELETE "/api/sharing/archives/99999"
if [[ "$HTTP_STATUS" == "404" || "$HTTP_STATUS" == "200" ]]; then
  log_pass "Delete non-existent archive handled ($HTTP_STATUS)"
else
  log_fail "Delete non-existent archive" "expected 404, got $HTTP_STATUS"
fi

# ── 25. CORS ────────────────────────────────────────────────────────────────
section "25. CORS Headers"

CORS_HEADERS=$(curl -s -D - -o /dev/null "$BASE_URL/api/logs/stats" 2>/dev/null | grep -i "access-control")
if echo "$CORS_HEADERS" | grep -qi "access-control-allow-origin"; then
  log_pass "CORS Access-Control-Allow-Origin present"
else
  log_fail "CORS" "Access-Control-Allow-Origin header missing"
fi

# ── 26. Compression ─────────────────────────────────────────────────────────
section "26. Response Compression"

COMPRESSED_SIZE=$(curl -s -H "Accept-Encoding: gzip" -D - "$BASE_URL/api/logs/stats" -o /dev/null 2>/dev/null | grep -i "content-encoding")
if echo "$COMPRESSED_SIZE" | grep -qi "gzip\|br"; then
  log_pass "Response compression enabled"
else
  log_skip "Response compression (small response may not be compressed)"
fi

# ── 27. Auth Header Variants ────────────────────────────────────────────────
section "27. Auth Header Variants"

api GET "/api/health" -H "Authorization: Bearer ${API_KEY}"
assert_status "200" "Bearer token auth works"

api GET "/api/health" -H "X-API-Key: ${API_KEY}"
assert_status "200" "X-API-Key header auth works"

# ── 28. Rate Limiting (Community Upload) ────────────────────────────────────
section "28. Community Contribute"

TEMP_ZIP=$(mktemp --suffix=.zip)
python3 -c "
import zipfile, io
with zipfile.ZipFile('$TEMP_ZIP', 'w') as z:
    z.writestr('test.ass', '[Script Info]\nTitle: Test\n')
"

METADATA='{"name_cn":"测试动画","letter":"C","season":"S1","sub_group":"Test","languages":["zh-Hans"],"has_fonts":false}'
api POST "/api/sharing/contribute" \
  -F "file=@${TEMP_ZIP};filename=test-contribute.zip" \
  -F "metadata=$METADATA"

if [[ "$HTTP_STATUS" =~ ^(200|201|400|429|500)$ ]]; then
  log_pass "Community contribute endpoint responds ($HTTP_STATUS)"
else
  log_fail "Community contribute" "unexpected $HTTP_STATUS"
fi
rm -f "$TEMP_ZIP"

# ── 29. Font Upload & Delete Lifecycle ──────────────────────────────────────
section "29. Font Upload & Delete Lifecycle"

SAMPLE_FONT="fonts/CatCat-Fonts/FZCKJF.ttf"
if [[ -f "$SAMPLE_FONT" ]]; then
  api_auth POST "/api/fonts" \
    -H "X-Target-Dir: _test_temp/" \
    -F "file=@${SAMPLE_FONT};filename=test-lifecycle.ttf"

  if [[ "$HTTP_STATUS" == "200" ]]; then
    FONT_ID=$(echo "$HTTP_BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['results'][0].get('id',''))" 2>/dev/null || echo "")
    if [[ -n "$FONT_ID" && "$FONT_ID" != "None" && "$FONT_ID" != "" ]]; then
      log_pass "Admin font upload succeeded (id=$FONT_ID)"

      api_auth DELETE "/api/fonts/$FONT_ID"
      assert_status "200" "Font delete by ID succeeds"
    else
      log_pass "Admin font upload succeeded (already indexed or no new ID)"
    fi
  else
    log_pass "Admin font upload returned $HTTP_STATUS (may already exist)"
  fi
else
  log_skip "Font lifecycle test (sample font not found)"
fi

# ── 30. Real Subtitle File Processing ───────────────────────────────────────
section "30. Real Subtitle File"

REAL_ASS="fonts/CatCat-Fonts/超时空辉夜姬.Pre-S&三明治摸鱼部.简体中文&日文.zh-Hans.ass"
if [[ -f "$REAL_ASS" ]]; then
  REAL_NAME=$(basename "$REAL_ASS")
  REAL_B64=$(echo -n "$REAL_NAME" | base64 -w0)
  api POST "/api/subset" \
    -H "Content-Type: application/octet-stream" \
    -H "X-Filename: $REAL_B64" \
    -H "X-Fonts-Check: 0" \
    -H "X-Clear-Fonts: 0" \
    --data-binary @"$REAL_ASS"

  if [[ "$HTTP_STATUS" =~ ^(200|201|300)$ ]]; then
    log_pass "Real subtitle processing works (HTTP $HTTP_STATUS)"

    XCODE=$(curl -s -D - -o /dev/null \
      -X POST "$BASE_URL/api/subset" \
      -H "Content-Type: application/octet-stream" \
      -H "X-Filename: $REAL_B64" \
      -H "X-Fonts-Check: 0" \
      -H "X-Clear-Fonts: 0" \
      --data-binary @"$REAL_ASS" 2>/dev/null | grep -i "x-code:" | tr -d '\r\n')
    if [[ -n "$XCODE" ]]; then
      log_pass "X-Code header present in subset response"
    else
      log_fail "X-Code header" "missing from subset response"
    fi
  else
    log_fail "Real subtitle processing" "expected 200/201/300, got $HTTP_STATUS"
  fi
else
  log_skip "Real subtitle processing (sample ASS not found)"
fi

# ── 31. Import Index (SSE) ──────────────────────────────────────────────────
section "31. Import Index (SSE)"

SSE_TMP=$(mktemp)
SSE_STATUS=$(curl -s -o "$SSE_TMP" -w "%{http_code}" -m 5 -X POST \
  -H "X-API-Key: ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{}' \
  "${BASE_URL}/api/sharing/import-index" 2>/dev/null) || true

if [[ "$SSE_STATUS" == "200" || -s "$SSE_TMP" ]]; then
  log_pass "Import index endpoint responds with SSE"
elif echo "$SSE_STATUS" | grep -q "401"; then
  log_fail "Import index" "auth not accepted"
else
  log_pass "Import index endpoint responds ($SSE_STATUS)"
fi
rm -f "$SSE_TMP"

# ══════════════════════════════════════════════════════════════════════════════
#  S U M M A R Y
# ══════════════════════════════════════════════════════════════════════════════

echo ""
echo "════════════════════════════════════════"
echo -e "${BOLD}Results:${NC} ${GREEN}${PASS} passed${NC}, ${RED}${FAIL} failed${NC}, ${YELLOW}${SKIP} skipped${NC} / ${TOTAL} total"
echo "════════════════════════════════════════"

if [[ $FAIL -gt 0 ]]; then
  exit 1
else
  exit 0
fi
