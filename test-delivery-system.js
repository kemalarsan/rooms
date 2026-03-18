#!/usr/bin/env node

// Test script for the message delivery system
const API_BASE = 'http://localhost:3000/api';

// Test configuration
const TEST_API_KEY = 'sk_test_participant_123'; // Replace with actual API key
const TEST_ROOM_ID = 'room_test_delivery'; // Replace with actual room ID

async function apiCall(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${TEST_API_KEY}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });
  
  const text = await response.text();
  try {
    return { status: response.status, data: JSON.parse(text) };
  } catch {
    return { status: response.status, data: text };
  }
}

async function runTests() {
  console.log('🧪 Testing Rooms Delivery System\n');

  try {
    // Test 1: Check participant info
    console.log('1. Testing participant info...');
    const participantInfo = await apiCall('/participants/me');
    if (participantInfo.status === 200) {
      console.log(`✅ Current participant: ${participantInfo.data.name} (${participantInfo.data.id})`);
      console.log(`   Webhook URL: ${participantInfo.data.webhook_url || 'Not set'}`);
    } else {
      console.log(`❌ Failed to get participant info: ${participantInfo.status}`);
      return;
    }

    // Test 2: Update webhook URL
    console.log('\n2. Testing webhook URL update...');
    const updateResult = await apiCall('/participants/me', {
      method: 'PATCH',
      body: JSON.stringify({
        webhook_url: 'https://httpbin.org/post'
      })
    });
    if (updateResult.status === 200) {
      console.log('✅ Webhook URL updated successfully');
    } else {
      console.log(`⚠️  Could not update webhook URL: ${updateResult.status}`);
    }

    // Test 3: Check undelivered messages
    console.log('\n3. Testing undelivered messages...');
    const undelivered = await apiCall('/participants/me/messages/undelivered?limit=5');
    if (undelivered.status === 200) {
      console.log(`✅ Undelivered messages: ${undelivered.data.messages?.length || 0}`);
      if (undelivered.data.messages?.length > 0) {
        console.log(`   First message: "${undelivered.data.messages[0].content.slice(0, 50)}..."`);
      }
    } else {
      console.log(`❌ Failed to get undelivered messages: ${undelivered.status}`);
    }

    // Test 4: Send a test message to trigger delivery
    console.log('\n4. Testing message sending with delivery...');
    const sendResult = await apiCall(`/rooms/${TEST_ROOM_ID}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        content: `Test delivery system message at ${new Date().toISOString()}`
      })
    });
    if (sendResult.status === 201) {
      console.log(`✅ Message sent: ${sendResult.data.id}`);
      
      // Test delivery status
      console.log('\n5. Testing delivery status...');
      const statusResult = await apiCall(`/rooms/${TEST_ROOM_ID}/messages/${sendResult.data.id}/status`);
      if (statusResult.status === 200) {
        console.log(`✅ Delivery status retrieved:`);
        console.log(`   Total recipients: ${statusResult.data.total_recipients}`);
        console.log(`   Delivered: ${statusResult.data.delivered_count}`);
        console.log(`   Pending: ${statusResult.data.pending_count}`);
        console.log(`   Failed: ${statusResult.data.failed_count}`);
      } else {
        console.log(`❌ Failed to get delivery status: ${statusResult.status}`);
      }
    } else {
      console.log(`❌ Failed to send message: ${sendResult.status} - ${sendResult.data.error || sendResult.data}`);
    }

    // Test 6: Test retry endpoint (internal)
    console.log('\n6. Testing retry endpoint...');
    const retryResult = await fetch(`${API_BASE}/internal/delivery-retry`, { method: 'POST' });
    const retryData = await retryResult.json();
    if (retryResult.status === 200) {
      console.log(`✅ Retry process completed in ${retryData.duration_ms}ms`);
    } else {
      console.log(`⚠️  Retry process failed: ${retryResult.status}`);
    }

    // Test 7: Test global SSE stream
    console.log('\n7. Testing global SSE stream...');
    const sseUrl = `${API_BASE}/participants/me/stream?token=${TEST_API_KEY}`;
    console.log(`   SSE endpoint: ${sseUrl}`);
    console.log('   (You can test this manually in a browser or with curl)');

    console.log('\n🎉 Testing complete!');
    
  } catch (error) {
    console.error('\n💥 Test failed with error:', error.message);
  }
}

if (require.main === module) {
  runTests();
}

module.exports = { runTests };