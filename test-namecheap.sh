#!/bin/bash
# Namecheap integration test — sandbox or production.
# Pulls credentials from BWS automatically.
#
# Usage: ./test-namecheap.sh              # defaults to sandbox
#        ./test-namecheap.sh sandbox
#        ./test-namecheap.sh production

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV="${1:-sandbox}"

if [ "$ENV" != "sandbox" ] && [ "$ENV" != "production" ]; then
  echo "Usage: $0 [sandbox|production]" >&2
  exit 1
fi

# ── Resolve credentials from BWS ─────────────────────────────────────

fetch_bws_secret_by_name() {
  local secret_name="$1"
  bws secret list --output json 2>/dev/null | python3 -c "
import sys, json
secrets = json.load(sys.stdin)
for s in secrets:
    if s.get('key') == '${secret_name}':
        print(s['value'])
        sys.exit(0)
print('')
" 2>/dev/null || echo ""
}

if [ "$ENV" = "sandbox" ]; then
  export NAMECHEAP_USE_SANDBOX="true"
  NC_USER_KEY="BWS_NAMECHEAP_SANDBOX_API_USER_SECRET_ID"
  NC_API_KEY="BWS_NAMECHEAP_SANDBOX_API_KEY_SECRET_ID"
else
  export NAMECHEAP_USE_SANDBOX="false"
  NC_USER_KEY="BWS_NAMECHEAP_PROD_API_USER_SECRET_ID"
  NC_API_KEY="BWS_NAMECHEAP_PROD_API_KEY_SECRET_ID"
fi

echo "Fetching ${ENV} credentials from BWS..."
export NAMECHEAP_API_USER=$(fetch_bws_secret_by_name "$NC_USER_KEY")
export NAMECHEAP_API_KEY=$(fetch_bws_secret_by_name "$NC_API_KEY")

if [ -z "$NAMECHEAP_API_USER" ] || [ -z "$NAMECHEAP_API_KEY" ]; then
  echo "ERROR: Could not fetch Namecheap ${ENV} credentials from BWS." >&2
  echo "Make sure these secrets exist:" >&2
  echo "  $NC_USER_KEY" >&2
  echo "  $NC_API_KEY" >&2
  exit 1
fi

echo "  API User: $NAMECHEAP_API_USER"
echo "  Environment: $ENV"

# ── Proxy token ──────────────────────────────────────────────────────

echo "Fetching proxy token from BWS..."
export NAMECHEAP_PROXY_TOKEN=$(fetch_bws_secret_by_name "NAMECHEAP_PROXY_BEARER_TOKEN")

if [ -z "$NAMECHEAP_PROXY_TOKEN" ]; then
  echo "ERROR: Could not fetch NAMECHEAP_PROXY_BEARER_TOKEN from BWS." >&2
  exit 1
fi

echo "  Proxy token: loaded"
echo ""

# ── Build if needed ──────────────────────────────────────────────────

if [ ! -f "$SCRIPT_DIR/dist/services/namecheap-client.js" ]; then
  echo "Building project..."
  cd "$SCRIPT_DIR" && npm run build
  echo ""
fi

# ── Run tests ─────────────────────────────────────────────────────────

PASS=0
FAIL=0

run_test() {
  local name="$1"
  local description="$2"
  shift 2

  echo "━━━ TEST: $name"
  echo "    $description"
  echo ""

  if output=$("$@" 2>&1); then
    echo "$output"
    echo ""
    echo "    ✓ PASS"
    PASS=$((PASS + 1))
  else
    echo "$output"
    echo ""
    echo "    ✗ FAIL"
    FAIL=$((FAIL + 1))
  fi
  echo ""
}

# Test 1: Environment check
run_test "get_env" "Verify ${ENV} environment is active" \
  node -e "
    import('./dist/services/namecheap-client.js').then(m => {
      const expected = '${ENV}';
      const actual = m.getNamecheapEnvironment();
      console.log(JSON.stringify({
        environment: actual,
        configured: m.isNamecheapConfigured(),
      }, null, 2));
      if (actual !== expected) {
        console.error('Expected ' + expected + ' but got ' + actual);
        process.exit(1);
      }
    });
  "

# Test 2: List domains
run_test "domains.getList" "List all domains in the ${ENV} account" \
  node -e "
    import('./dist/services/namecheap-client.js').then(async m => {
      const result = await m.namecheapCommand('namecheap.domains.getList', { PageSize: 100 });
      const paging = result.CommandResponse.Paging;
      console.log(JSON.stringify({
        status: result.Status,
        totalDomains: paging?.TotalItems ?? 0,
        response: result.CommandResponse,
      }, null, 2));
    });
  "

# Test 3: Check domain availability
run_test "domains.check" "Check availability of test domains" \
  node -e "
    import('./dist/services/namecheap-client.js').then(async m => {
      const result = await m.namecheapCommand('namecheap.domains.check', {
        DomainList: 'test-infraops-12345.com,example.com,available-domain-test-98765.com'
      });
      console.log(JSON.stringify(result.CommandResponse, null, 2));
    });
  "

# Test 4: Get TLD list (proves full API round-trip)
run_test "domains.getTldList" "Fetch available TLDs (first 5)" \
  node -e "
    import('./dist/services/namecheap-client.js').then(async m => {
      const result = await m.namecheapCommand('namecheap.domains.getTldList');
      const tlds = result.CommandResponse.Tlds?.Tld;
      const list = Array.isArray(tlds) ? tlds.slice(0, 5) : [];
      console.log(JSON.stringify({
        totalTlds: Array.isArray(tlds) ? tlds.length : 0,
        sample: list.map(t => t.Name || t),
      }, null, 2));
    });
  "

# Test 5: splitDomain helper
run_test "splitDomain" "Verify domain splitting logic" \
  node -e "
    import('./dist/services/namecheap-client.js').then(m => {
      const tests = [
        ['devonwatkins.com', 'devonwatkins', 'com'],
        ['sub.example.co.uk', 'sub.example', 'co.uk'],
        ['my-site.org', 'my-site', 'org'],
      ];
      let allPassed = true;
      for (const [domain, expectedSld, expectedTld] of tests) {
        const { sld, tld } = m.splitDomain(domain);
        const ok = sld === expectedSld && tld === expectedTld;
        if (!ok) allPassed = false;
        console.log(\`  \${ok ? '✓' : '✗'} \${domain} → SLD=\${sld} TLD=\${tld}\`);
      }
      if (!allPassed) process.exit(1);
    });
  "

# ── Summary ───────────────────────────────────────────────────────────

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Environment: $ENV"
echo "  Results: $PASS passed, $FAIL failed"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

[ "$FAIL" -eq 0 ] && exit 0 || exit 1
