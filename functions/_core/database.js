import {SCHEMA,MIGRATIONS} from '../api/_schema.js';
const pending=new WeakMap();
const ADDITIONS=[
 "ALTER TABLE daily_signin ADD COLUMN reward INTEGER NOT NULL DEFAULT 0",
 "ALTER TABLE webauthn_challenges ADD COLUMN token TEXT",
 "CREATE UNIQUE INDEX IF NOT EXISTS idx_challenge_token ON webauthn_challenges(token)",
 "ALTER TABLE passkeys ADD COLUMN sign_count INTEGER NOT NULL DEFAULT 0",
 "ALTER TABLE passkeys ADD COLUMN aaguid TEXT",
 "CREATE TABLE IF NOT EXISTS auth_attempts(id INTEGER PRIMARY KEY AUTOINCREMENT,fingerprint TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
 "CREATE INDEX IF NOT EXISTS idx_auth_attempts ON auth_attempts(fingerprint,created_at)",
 "ALTER TABLE kart_signups ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'",
 "ALTER TABLE circuit_signups ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'",
 "ALTER TABLE daily_signin ADD COLUMN streak INTEGER NOT NULL DEFAULT 1",
 "ALTER TABLE daily_signin ADD COLUMN emeralds_earned INTEGER NOT NULL DEFAULT 0",
 "ALTER TABLE license_signups ADD COLUMN name TEXT",
 "CREATE INDEX IF NOT EXISTS idx_ticket_source ON tickets(source_table,source_id)",
];
export function ensureDatabase(db){if(!db)throw new Error('DB not configured');if(pending.has(db))return pending.get(db);const run=(async()=>{
 await db.prepare('CREATE TABLE IF NOT EXISTS lc_schema_versions(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)').run();
 if(await db.prepare('SELECT version FROM lc_schema_versions WHERE version=51').first())return;
 await db.batch(SCHEMA.map(sql=>db.prepare(sql)));
 for(const sql of [...MIGRATIONS,...ADDITIONS]){try{await db.prepare(sql).run();}catch(e){if(!/duplicate column name/i.test(e.message))throw e;}}
 await db.prepare('INSERT OR IGNORE INTO lc_schema_versions(version) VALUES(51)').run();
 })().catch(e=>{pending.delete(db);throw e;});pending.set(db,run);return run;}
