import { sql } from '@vercel/postgres';

export async function initDB() {
    try {
        await sql`
      CREATE TABLE IF NOT EXISTS interactions (
        id SERIAL PRIMARY KEY,
        session_id VARCHAR(255) NOT NULL,
        user_question TEXT NOT NULL,
        expert_answer TEXT NOT NULL,
        expert_name VARCHAR(255),
        user_name VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;
        console.log('[DB] Interactions table checked/created.');

        // Check if user_name column exists (migration for existing table)
        try {
            await sql`ALTER TABLE interactions ADD COLUMN IF NOT EXISTS user_name VARCHAR(255)`;
        } catch (e) {
            // Ignore if column already exists or other minor error
        }

    } catch (error) {
        console.error('[DB] Failed to initialize database:', error);
        // Don't throw here to allow app to function even if DB fails (graceful degradation)
    }
}

export async function saveInteraction(
    sessionId: string,
    userQuestion: string,
    expertAnswer: string,
    expertName?: string,
    userName?: string
) {
    try {
        // Ensure table exists before inserting (lazy init)
        // In a real prod app, this might be done in a migration script, 
        // but for this prototype, checking here is safer if the user hasn't run migrations.
        // To optimize, we could cache the init result.
        await initDB();

        await sql`
      INSERT INTO interactions (session_id, user_question, expert_answer, expert_name, user_name)
      VALUES (${sessionId}, ${userQuestion}, ${expertAnswer}, ${expertName}, ${userName})
    `;
        console.log(`[DB] Saved interaction for session ${sessionId}`);
    } catch (error) {
        console.error(`[DB] Failed to save interaction for session ${sessionId}:`, error);
    }
}
