const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

// Use the direct Supabase PostgreSQL connection
const client = new Client({
  host: 'aws-0-us-east-1.pooler.supabase.com',
  port: 6543,
  database: 'postgres',
  user: 'postgres.rmckcnhzlfyqaanwyskr',
  password: 'Rooms2026!Supabase',
  ssl: {
    rejectUnauthorized: false
  }
});

async function runMigration() {
  try {
    console.log('Connecting to database...');
    await client.connect();
    console.log('Connected successfully');
    
    const migrationPath = path.join(__dirname, 'supabase/migrations/20260318184300_features.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');
    
    console.log('Running migration...');
    
    // Split by semicolon and execute each statement
    const statements = sql.split(';').map(s => s.trim()).filter(s => s.length > 0);
    
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      if (statement) {
        console.log(`Executing statement ${i + 1}/${statements.length}: ${statement.substring(0, 50)}...`);
        
        try {
          const result = await client.query(statement);
          console.log('✓ Success');
        } catch (err) {
          console.error('✗ Error:', err.message);
          // Continue with other statements
        }
      }
    }
    
    console.log('Migration completed');
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await client.end();
  }
}

runMigration();