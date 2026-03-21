#!/usr/bin/env bash
#
# Hivium Stress Test Suite
#
# Usage:
#   bash run.sh [test] [--agents N] [--messages N] [--rooms N] [--concurrency N]
#
# Tests:
#   throughput    — Message send rate (single room, one sender)
#   fanout        — Message delivery to N agents polling simultaneously
#   rooms         — Create N rooms, send messages across all
#   burst         — Send N messages as fast as possible, measure delivery lag
#   full          — Run all tests sequentially
#
set -euo pipefail

HIVIUM_URL="${HIVIUM_URL:-https://www.hivium.ai}"
ADMIN_KEY=$(cat /tmp/.openclaw-tokens/rooms-admin 2>/dev/null || echo "")
BASE_KEY=$(cat /tmp/.openclaw-tokens/rooms 2>/dev/null || echo "")

# Defaults
TEST="${1:-full}"
NUM_AGENTS=10
NUM_MESSAGES=50
NUM_ROOMS=5
CONCURRENCY=10

shift || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --agents)      NUM_AGENTS="$2"; shift 2 ;;
    --messages)    NUM_MESSAGES="$2"; shift 2 ;;
    --rooms)       NUM_ROOMS="$2"; shift 2 ;;
    --concurrency) CONCURRENCY="$2"; shift 2 ;;
    *) shift ;;
  esac
done

# ── Colors ───────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
info()    { echo -e "${CYAN}→${NC} $*"; }
ok()      { echo -e "${GREEN}✓${NC} $*"; }
warn()    { echo -e "${YELLOW}⚠${NC} $*"; }
fail()    { echo -e "${RED}✗${NC} $*"; }
header()  { echo ""; echo -e "${BOLD}━━━ $* ━━━${NC}"; echo ""; }

TMPDIR=$(mktemp -d)
trap "rm -rf $TMPDIR" EXIT

# ── Setup: Create test agents ────────────────────────────────────────

setup_agents() {
  local count=$1
  info "Creating $count test agents..."
  
  # Create a test room first
  local room_resp=$(curl -sf "$HIVIUM_URL/api/rooms" \
    -X POST \
    -H "Authorization: Bearer $BASE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"name\": \"Stress Test $(date +%s)\", \"room_type\": \"chat\"}" 2>&1)
  
  STRESS_ROOM=$(echo "$room_resp" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
  ok "Test room: $STRESS_ROOM"
  
  # Create invite for the room
  local inv_resp=$(curl -sf "$HIVIUM_URL/api/rooms/$STRESS_ROOM/invites" \
    -X POST \
    -H "Authorization: Bearer $BASE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"maxUses\": $((count + 5))}")
  
  INVITE_CODE=$(echo "$inv_resp" | python3 -c "import json,sys; print(json.load(sys.stdin)['code'])")
  
  # Register agents
  > "$TMPDIR/agents.txt"
  for i in $(seq 1 "$count"); do
    local resp=$(curl -sf "$HIVIUM_URL/api/agent-setup" \
      -X POST \
      -H "Content-Type: application/json" \
      -d "{\"name\": \"StressBot-$i\", \"invite_code\": \"$INVITE_CODE\"}" 2>&1)
    
    local key=$(echo "$resp" | python3 -c "import json,sys; print(json.load(sys.stdin).get('apiKey',''))")
    local pid=$(echo "$resp" | python3 -c "import json,sys; print(json.load(sys.stdin)['participant']['id'])")
    echo "$key|$pid|StressBot-$i" >> "$TMPDIR/agents.txt"
    printf "\r  Created %d/%d agents" "$i" "$count"
  done
  echo ""
  ok "Created $count agents in room $STRESS_ROOM"
}

# ── Cleanup ──────────────────────────────────────────────────────────

cleanup() {
  if [ -n "${STRESS_ROOMS_FILE:-}" ] && [ -f "$STRESS_ROOMS_FILE" ]; then
    info "Cleaning up test rooms..."
    # Would need a delete endpoint - for now just note them
    warn "Test rooms created (manual cleanup needed): $(cat "$STRESS_ROOMS_FILE" | wc -l | tr -d ' ') rooms"
  fi
  if [ -f "$TMPDIR/agents.txt" ]; then
    local agent_count=$(wc -l < "$TMPDIR/agents.txt" | tr -d ' ')
    warn "Test agents created (manual cleanup needed): $agent_count agents"
  fi
}

# ── Test 1: Throughput ───────────────────────────────────────────────

test_throughput() {
  header "TEST: Message Throughput (sequential sends)"
  info "Sending $NUM_MESSAGES messages to one room..."
  
  local sender_key=$(head -1 "$TMPDIR/agents.txt" | cut -d'|' -f1)
  local start_ts=$(python3 -c "import time; print(time.time())")
  local success=0
  local failed=0
  
  for i in $(seq 1 "$NUM_MESSAGES"); do
    local status=$(curl -so /dev/null -w "%{http_code}" \
      "$HIVIUM_URL/api/rooms/$STRESS_ROOM/messages" \
      -X POST \
      -H "Authorization: Bearer $sender_key" \
      -H "Content-Type: application/json" \
      -d "{\"content\": \"Throughput test message $i / $NUM_MESSAGES — $(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)\"}")
    
    if [ "$status" = "200" ] || [ "$status" = "201" ]; then
      success=$((success + 1))
    else
      failed=$((failed + 1))
    fi
    printf "\r  Sent %d/%d (ok=%d fail=%d)" "$i" "$NUM_MESSAGES" "$success" "$failed"
  done
  
  local end_ts=$(python3 -c "import time; print(time.time())")
  local duration=$(python3 -c "print(f'{$end_ts - $start_ts:.2f}')")
  local rate=$(python3 -c "d=$end_ts-$start_ts; print(f'{$success/d:.1f}' if d>0 else '∞')")
  
  echo ""
  echo ""
  echo -e "  Messages:   ${BOLD}$success / $NUM_MESSAGES${NC} delivered"
  echo -e "  Failed:     $failed"
  echo -e "  Duration:   ${BOLD}${duration}s${NC}"
  echo -e "  Rate:       ${BOLD}${rate} msg/sec${NC}"
  echo ""
  
  if [ "$failed" -eq 0 ]; then
    ok "Throughput test passed"
  else
    warn "Throughput test: $failed failures"
  fi
}

# ── Test 2: Burst + Delivery Lag ─────────────────────────────────────

test_burst() {
  header "TEST: Burst Send + Delivery Lag"
  info "Sending $NUM_MESSAGES messages concurrently, measuring delivery time..."
  
  local sender_key=$(head -1 "$TMPDIR/agents.txt" | cut -d'|' -f1)
  local receiver_key=$(sed -n '2p' "$TMPDIR/agents.txt" | cut -d'|' -f1)
  
  # Record send timestamp
  local send_ts=$(python3 -c "import time; print(time.time())")
  
  # Fire all messages in parallel using background processes
  local pids=""
  for i in $(seq 1 "$NUM_MESSAGES"); do
    curl -so /dev/null "$HIVIUM_URL/api/rooms/$STRESS_ROOM/messages" \
      -X POST \
      -H "Authorization: Bearer $sender_key" \
      -H "Content-Type: application/json" \
      -d "{\"content\": \"Burst #$i at $send_ts\"}" &
    pids="$pids $!"
    
    # Limit concurrent connections
    if [ $((i % CONCURRENCY)) -eq 0 ]; then
      wait $pids 2>/dev/null
      pids=""
    fi
  done
  wait $pids 2>/dev/null
  
  local burst_done=$(python3 -c "import time; print(time.time())")
  local burst_dur=$(python3 -c "print(f'{$burst_done - $send_ts:.2f}')")
  ok "Burst sent in ${burst_dur}s"
  
  # Now poll for delivery
  info "Polling receiver for delivered messages..."
  sleep 2  # Give server time to process
  
  local delivered=0
  local poll_start=$(python3 -c "import time; print(time.time())")
  
  for attempt in $(seq 1 10); do
    local resp=$(curl -sf "$HIVIUM_URL/api/participants/me/messages/undelivered" \
      -H "Authorization: Bearer $receiver_key" 2>/dev/null || echo '{"messages":[]}')
    
    local batch=$(echo "$resp" | python3 -c "import json,sys; msgs=json.load(sys.stdin).get('messages',[]); print(len(msgs))")
    
    if [ "$batch" -gt 0 ]; then
      delivered=$((delivered + batch))
      # ACK them
      local ids=$(echo "$resp" | python3 -c "import json,sys; msgs=json.load(sys.stdin).get('messages',[]); print(json.dumps([m['id'] for m in msgs]))")
      curl -sf "$HIVIUM_URL/api/participants/me/messages/ack" \
        -X POST \
        -H "Authorization: Bearer $receiver_key" \
        -H "Content-Type: application/json" \
        -d "{\"message_ids\": $ids}" > /dev/null 2>&1
    fi
    
    printf "\r  Poll %d: %d/%d messages delivered" "$attempt" "$delivered" "$NUM_MESSAGES"
    
    if [ "$delivered" -ge "$NUM_MESSAGES" ]; then break; fi
    sleep 1
  done
  
  local poll_end=$(python3 -c "import time; print(time.time())")
  local total_lag=$(python3 -c "print(f'{$poll_end - $send_ts:.2f}')")
  
  echo ""
  echo ""
  echo -e "  Burst send:     ${BOLD}${burst_dur}s${NC} for $NUM_MESSAGES messages"
  echo -e "  Delivered:      ${BOLD}$delivered / $NUM_MESSAGES${NC}"
  echo -e "  Total e2e lag:  ${BOLD}${total_lag}s${NC}"
  echo ""
}

# ── Test 3: Fan-out (multiple pollers) ───────────────────────────────

test_fanout() {
  header "TEST: Fan-out (1 message → $NUM_AGENTS receivers)"
  
  local sender_key=$(head -1 "$TMPDIR/agents.txt" | cut -d'|' -f1)
  
  # Send one message
  local send_ts=$(python3 -c "import time; print(time.time())")
  curl -sf "$HIVIUM_URL/api/rooms/$STRESS_ROOM/messages" \
    -X POST \
    -H "Authorization: Bearer $sender_key" \
    -H "Content-Type: application/json" \
    -d "{\"content\": \"Fan-out test $(date +%s)\"}" > /dev/null
  
  ok "Message sent"
  sleep 2
  
  # All other agents poll simultaneously
  info "All $((NUM_AGENTS - 1)) receivers polling..."
  local received=0
  local poll_pids=""
  
  > "$TMPDIR/fanout_results.txt"
  
  tail -n +2 "$TMPDIR/agents.txt" | while IFS='|' read -r key pid name; do
    (
      local resp=$(curl -sf "$HIVIUM_URL/api/participants/me/messages/undelivered" \
        -H "Authorization: Bearer $key" 2>/dev/null || echo '{"messages":[]}')
      local count=$(echo "$resp" | python3 -c "import json,sys; print(len(json.load(sys.stdin).get('messages',[])))")
      echo "$name:$count" >> "$TMPDIR/fanout_results.txt"
      
      # ACK
      if [ "$count" -gt 0 ]; then
        local ids=$(echo "$resp" | python3 -c "import json,sys; print(json.dumps([m['id'] for m in json.load(sys.stdin).get('messages',[])]))")
        curl -sf "$HIVIUM_URL/api/participants/me/messages/ack" \
          -X POST -H "Authorization: Bearer $key" \
          -H "Content-Type: application/json" \
          -d "{\"message_ids\": $ids}" > /dev/null 2>&1
      fi
    ) &
  done
  wait
  
  local total_receivers=$((NUM_AGENTS - 1))
  local got_msg=$(grep -c ":1" "$TMPDIR/fanout_results.txt" 2>/dev/null || echo "0")
  local fan_end=$(python3 -c "import time; print(time.time())")
  local fan_dur=$(python3 -c "print(f'{$fan_end - $send_ts:.2f}')")
  
  echo -e "  Receivers:     ${BOLD}$got_msg / $total_receivers${NC} got the message"
  echo -e "  Total time:    ${BOLD}${fan_dur}s${NC}"
  echo ""
  
  if [ "$got_msg" -eq "$total_receivers" ]; then
    ok "Fan-out: 100% delivery"
  else
    warn "Fan-out: $got_msg/$total_receivers delivered"
  fi
}

# ── Test 4: Multi-room ───────────────────────────────────────────────

test_rooms() {
  header "TEST: Multi-room ($NUM_ROOMS rooms, messages across all)"
  
  local sender_key=$(head -1 "$TMPDIR/agents.txt" | cut -d'|' -f1)
  STRESS_ROOMS_FILE="$TMPDIR/rooms.txt"
  echo "$STRESS_ROOM" > "$STRESS_ROOMS_FILE"
  
  # Create additional rooms
  info "Creating $((NUM_ROOMS - 1)) additional rooms..."
  for i in $(seq 2 "$NUM_ROOMS"); do
    local resp=$(curl -sf "$HIVIUM_URL/api/rooms" \
      -X POST \
      -H "Authorization: Bearer $BASE_KEY" \
      -H "Content-Type: application/json" \
      -d "{\"name\": \"Stress Room $i\", \"room_type\": \"chat\"}" 2>&1)
    
    local rid=$(echo "$resp" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
    echo "$rid" >> "$STRESS_ROOMS_FILE"
    
    # Join sender to room
    curl -sf "$HIVIUM_URL/api/rooms/$rid/join" \
      -X POST \
      -H "Authorization: Bearer $sender_key" > /dev/null 2>&1
  done
  ok "Created $NUM_ROOMS total rooms"
  
  # Send messages across all rooms
  local start_ts=$(python3 -c "import time; print(time.time())")
  local total_sent=0
  local msgs_per_room=$((NUM_MESSAGES / NUM_ROOMS))
  
  info "Sending $msgs_per_room messages to each room ($((msgs_per_room * NUM_ROOMS)) total)..."
  
  while read -r rid; do
    for i in $(seq 1 "$msgs_per_room"); do
      curl -so /dev/null "$HIVIUM_URL/api/rooms/$rid/messages" \
        -X POST \
        -H "Authorization: Bearer $sender_key" \
        -H "Content-Type: application/json" \
        -d "{\"content\": \"Room test $rid msg $i\"}" &
      total_sent=$((total_sent + 1))
      
      if [ $((total_sent % CONCURRENCY)) -eq 0 ]; then
        wait
      fi
    done
  done < "$STRESS_ROOMS_FILE"
  wait
  
  local end_ts=$(python3 -c "import time; print(time.time())")
  local duration=$(python3 -c "print(f'{$end_ts - $start_ts:.2f}')")
  local rate=$(python3 -c "d=$end_ts-$start_ts; print(f'{$total_sent/d:.1f}' if d>0 else '∞')")
  
  echo -e "  Rooms:      ${BOLD}$NUM_ROOMS${NC}"
  echo -e "  Total msgs: ${BOLD}$total_sent${NC}"
  echo -e "  Duration:   ${BOLD}${duration}s${NC}"
  echo -e "  Rate:       ${BOLD}${rate} msg/sec${NC} (across all rooms)"
  echo ""
  ok "Multi-room test complete"
}

# ── Test 5: Transcript API under load ────────────────────────────────

test_transcript() {
  header "TEST: Transcript API Performance"
  info "Fetching transcript for room with $NUM_MESSAGES+ messages..."
  
  local start_ts=$(python3 -c "import time; print(time.time())")
  local resp=$(curl -sf -w "\n%{http_code}|%{time_total}|%{size_download}" \
    "$HIVIUM_URL/api/rooms/$STRESS_ROOM/transcript?format=markdown" \
    -H "Authorization: Bearer $BASE_KEY")
  
  local http_code=$(echo "$resp" | tail -1 | cut -d'|' -f1)
  local time_total=$(echo "$resp" | tail -1 | cut -d'|' -f2)
  local size=$(echo "$resp" | tail -1 | cut -d'|' -f3)
  local size_kb=$(python3 -c "print(f'{int($size)/1024:.1f}')")
  
  echo -e "  Status:     ${BOLD}$http_code${NC}"
  echo -e "  Size:       ${BOLD}${size_kb} KB${NC}"
  echo -e "  Time:       ${BOLD}${time_total}s${NC}"
  echo ""
  
  # Also test JSON format
  local json_resp=$(curl -sf -w "\n%{http_code}|%{time_total}|%{size_download}" \
    "$HIVIUM_URL/api/rooms/$STRESS_ROOM/transcript?format=json" \
    -H "Authorization: Bearer $BASE_KEY")
  
  local json_time=$(echo "$json_resp" | tail -1 | cut -d'|' -f2)
  local json_size=$(echo "$json_resp" | tail -1 | cut -d'|' -f3)
  local json_kb=$(python3 -c "print(f'{int($json_size)/1024:.1f}')")
  
  echo -e "  JSON size:  ${BOLD}${json_kb} KB${NC}"
  echo -e "  JSON time:  ${BOLD}${json_time}s${NC}"
  echo ""
  ok "Transcript API test complete"
}

# ── Main ─────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}🐝 Hivium Stress Test Suite${NC}"
echo -e "   Target:      $HIVIUM_URL"
echo -e "   Agents:      $NUM_AGENTS"
echo -e "   Messages:    $NUM_MESSAGES"
echo -e "   Rooms:       $NUM_ROOMS"
echo -e "   Concurrency: $CONCURRENCY"
echo ""

if [ -z "$ADMIN_KEY" ] || [ -z "$BASE_KEY" ]; then
  fail "Missing tokens. Need /tmp/.openclaw-tokens/rooms-admin and /tmp/.openclaw-tokens/rooms"
  exit 1
fi

# Setup
setup_agents "$NUM_AGENTS"

case "$TEST" in
  throughput)  test_throughput ;;
  burst)       test_burst ;;
  fanout)      test_fanout ;;
  rooms)       test_rooms ;;
  transcript)  test_transcript ;;
  full)
    test_throughput
    test_burst
    test_fanout
    test_rooms
    test_transcript
    ;;
  *) fail "Unknown test: $TEST" ;;
esac

header "RESULTS SUMMARY"
cleanup
echo -e "${GREEN}Stress test complete.${NC}"
echo ""
