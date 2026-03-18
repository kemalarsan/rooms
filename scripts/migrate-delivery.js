#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function runMigrations() {
  console.log('Running delivery system migrations...');

  try {
    // 1. Add webhook_url column to participants table
    console.log('Adding webhook_url column to participants...');
    const { error: webhookError } = await supabase.rpc('exec_sql', {
      sql: 'ALTER TABLE participants ADD COLUMN IF NOT EXISTS webhook_url TEXT;'
    });
    
    if (webhookError && !webhookError.message.includes('already exists')) {
      console.error('Error adding webhook_url:', webhookError);
    } else {
      console.log('✓ webhook_url column added');
    }

    // 2. Create message_deliveries table
    console.log('Creating message_deliveries table...');
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS message_deliveries (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN ('pending', 'delivered', 'failed')),
        attempts INTEGER NOT NULL DEFAULT 0,
        last_attempt_at TIMESTAMPTZ,
        delivered_at TIMESTAMPTZ,
        error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `;
    
    const { error: tableError } = await supabase.rpc('exec_sql', {
      sql: createTableSQL
    });
    
    if (tableError && !tableError.message.includes('already exists')) {
      console.error('Error creating message_deliveries table:', tableError);
    } else {
      console.log('✓ message_deliveries table created');
    }

    // 3. Create indexes for performance
    console.log('Creating indexes...');
    const indexSQL = `
      CREATE INDEX IF NOT EXISTS idx_message_deliveries_participant_status 
      ON message_deliveries(participant_id, status);
      
      CREATE INDEX IF NOT EXISTS idx_message_deliveries_message_id 
      ON message_deliveries(message_id);
      
      CREATE INDEX IF NOT EXISTS idx_message_deliveries_retry 
      ON message_deliveries(status, attempts, last_attempt_at);
    `;
    
    const { error: indexError } = await supabase.rpc('exec_sql', {
      sql: indexSQL
    });
    
    if (indexError) {
      console.error('Error creating indexes:', indexError);
    } else {
      console.log('✓ indexes created');
    }

    console.log('✅ Migration completed successfully!');
    
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

// If exec_sql doesn't exist, try direct SQL execution via a simple function
async function createExecFunction() {
  try {
    const { error } = await supabase.rpc('exec_sql', { sql: 'SELECT 1;' });
    if (!error) return; // Function exists
  } catch (e) {
    // Function doesn't exist, try to create it or use alternative approach
  }

  console.log('exec_sql function not available, using direct table operations...');
  
  // Alternative: Use direct INSERT/UPDATE operations where possible
  // For schema changes, we'll need to handle differently
  console.log('⚠️  Database schema changes may need to be applied manually via Supabase dashboard');
  console.log('Please run these SQL commands in your Supabase SQL editor:');
  console.log(`
-- Add webhook_url column
ALTER TABLE participants ADD COLUMN IF NOT EXISTS webhook_url TEXT;

-- Create message_deliveries table  
CREATE TABLE IF NOT EXISTS message_deliveries (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'delivered', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_message_deliveries_participant_status 
ON message_deliveries(participant_id, status);

CREATE INDEX IF NOT EXISTS idx_message_deliveries_message_id 
ON message_deliveries(message_id);

CREATE INDEX IF NOT EXISTS idx_message_deliveries_retry 
ON message_deliveries(status, attempts, last_attempt_at);
  `);
}

if (require.main === module) {
  createExecFunction().then(() => runMigrations());
}

module.exports = { runMigrations };