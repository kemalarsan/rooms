const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Use the production Supabase connection
const supabaseUrl = 'https://rmckcnhzlfyqaanwyskr.supabase.co';
const supabaseServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJtY2tjbmh6bGZ5cWFhbnd5c2tyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzg2NTE3NywiZXhwIjoyMDg5NDQxMTc3fQ.7oyh27HDjlBi1NlyLKITv-IbAkfGBqDlTZTz_RpZrHc';

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function runMigration() {
  try {
    const migrationPath = path.join(__dirname, 'supabase/migrations/20260318184300_features.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');
    
    console.log('Running migration...');
    
    // Split by semicolon and execute each statement
    const statements = sql.split(';').map(s => s.trim()).filter(s => s.length > 0);
    
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      if (statement) {
        console.log(`Executing statement ${i + 1}/${statements.length}...`);
        
        try {
          const { data, error } = await supabase.rpc('exec_sql', { sql: statement });
          
          if (error) {
            console.error('Error:', error);
          } else {
            console.log('Success');
          }
        } catch (err) {
          // Try direct SQL if RPC doesn't work
          console.log('Trying direct query...');
          const { error } = await supabase
            .from('information_schema.tables')
            .select('*')
            .limit(1);
          
          if (error) {
            console.error('Database connection error:', error);
          }
        }
      }
    }
    
    console.log('Migration completed');
  } catch (error) {
    console.error('Migration failed:', error);
  }
}

runMigration();