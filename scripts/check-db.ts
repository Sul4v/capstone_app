import { sql } from '@vercel/postgres';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function checkDB() {
    try {
        console.log('Checking database connection...');
        const { rows } = await sql`SELECT count(*) as count FROM interactions`;
        console.log(`Success! Found ${rows[0].count} interactions in the database.`);

        const recent = await sql`SELECT * FROM interactions ORDER BY created_at DESC LIMIT 1`;
        if (recent.rows.length > 0) {
            console.log('Most recent interaction:');
            console.log(JSON.stringify(recent.rows[0], null, 2));
        }
    } catch (error) {
        console.error('Database check failed:', error);
    }
}

checkDB();
