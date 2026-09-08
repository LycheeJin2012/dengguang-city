import {SCHEMA,MIGRATIONS} from '../api/_schema.js';
const pending=new WeakMap();
const VERSION=52;
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
 if(await db.prepare('SELECT version FROM lc_schema_versions WHERE version=?').bind(VERSION).first())return;
 const oldGallery=new Set((await db.prepare('PRAGMA table_info(gallery_items)').all()).results.map(c=>c.name));
 await db.batch(SCHEMA.map(sql=>db.prepare(sql)));
 for(const sql of [...MIGRATIONS,...ADDITIONS]){try{await db.prepare(sql).run();}catch(e){if(!/duplicate column name/i.test(e.message))throw e;}}
 const galleryColumns={title:"TEXT NOT NULL DEFAULT ''",caption:'TEXT',image_url:'TEXT',is_active:'INTEGER NOT NULL DEFAULT 1',cat:"TEXT NOT NULL DEFAULT 'city'",label:"TEXT NOT NULL DEFAULT ''",file_url:"TEXT NOT NULL DEFAULT ''",is_featured:'INTEGER NOT NULL DEFAULT 0',is_published:'INTEGER NOT NULL DEFAULT 1',created_by:'INTEGER',updated_at:'TEXT'};
 const present=new Set((await db.prepare('PRAGMA table_info(gallery_items)').all()).results.map(c=>c.name));
 for(const [name,type] of Object.entries(galleryColumns))if(!present.has(name)){try{await db.prepare(`ALTER TABLE gallery_items ADD COLUMN ${name} ${type}`).run();}catch(e){if(!/duplicate column name/i.test(e.message))throw e;}}
 if(oldGallery.has('label'))await db.prepare("UPDATE gallery_items SET title=label WHERE (title IS NULL OR title='') AND label IS NOT NULL").run();
 if(oldGallery.has('file_url'))await db.prepare("UPDATE gallery_items SET image_url=file_url WHERE (image_url IS NULL OR image_url='') AND file_url IS NOT NULL").run();
 if(oldGallery.has('is_published'))await db.prepare('UPDATE gallery_items SET is_active=is_published').run();
 await db.prepare("UPDATE gallery_items SET label=title,file_url=COALESCE(image_url,''),is_published=is_active").run();
 await db.prepare('INSERT OR IGNORE INTO lc_schema_versions(version) VALUES(?)').bind(VERSION).run();
 })().catch(e=>{pending.delete(db);throw e;});pending.set(db,run);return run;}
