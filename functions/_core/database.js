import {SCHEMA,MIGRATIONS} from '../api/_schema.js';
const pending=new WeakMap();
const VERSION=56;
const ADDITIONS=[

 "CREATE TABLE IF NOT EXISTS media_uploads(id TEXT PRIMARY KEY,owner_player_id INTEGER,owner_admin_id INTEGER,name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,chunk_count INTEGER NOT NULL,purpose TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'uploading',public_access INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
 "CREATE TABLE IF NOT EXISTS media_chunks(upload_id TEXT NOT NULL,part INTEGER NOT NULL,data TEXT NOT NULL,byte_size INTEGER NOT NULL,PRIMARY KEY(upload_id,part)) WITHOUT ROWID",
 "CREATE TABLE IF NOT EXISTS ticket_attachments(upload_id TEXT PRIMARY KEY,ticket_ref TEXT NOT NULL) WITHOUT ROWID",
 "CREATE INDEX IF NOT EXISTS idx_ticket_attachments_ref ON ticket_attachments(ticket_ref)",
 "CREATE TRIGGER IF NOT EXISTS limit_ticket_attachments BEFORE INSERT ON ticket_attachments WHEN (SELECT COUNT(*) FROM ticket_attachments WHERE ticket_ref=NEW.ticket_ref)>=5 BEGIN SELECT RAISE(ABORT,'ticket_attachment_limit'); END",
 "CREATE TRIGGER IF NOT EXISTS limit_ticket_attachment_bytes BEFORE INSERT ON ticket_attachments WHEN COALESCE((SELECT SUM(u.size) FROM media_uploads u JOIN ticket_attachments a ON a.upload_id=u.id WHERE a.ticket_ref=NEW.ticket_ref),0)+(SELECT size FROM media_uploads WHERE id=NEW.upload_id)>209715200 BEGIN SELECT RAISE(ABORT,'ticket_attachment_bytes'); END",
 "CREATE TRIGGER IF NOT EXISTS valid_ticket_attachment BEFORE INSERT ON ticket_attachments WHEN NOT EXISTS(SELECT 1 FROM media_uploads WHERE id=NEW.upload_id AND status='ready' AND purpose='ticket') BEGIN SELECT RAISE(ABORT,'ticket_attachment_missing'); END",
 "CREATE INDEX IF NOT EXISTS idx_media_owner ON media_uploads(owner_player_id,owner_admin_id)",
 "ALTER TABLE messages ADD COLUMN assignee_id INTEGER",
 "ALTER TABLE messages ADD COLUMN type TEXT NOT NULL DEFAULT '留言'",
 "ALTER TABLE message_comments ADD COLUMN author_name TEXT NOT NULL DEFAULT ''",
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
 const oldBookingColumns=new Set((await db.prepare('PRAGMA table_info(bookings)').all()).results.map(c=>c.name));
 const oldLicenseColumns=new Set((await db.prepare('PRAGMA table_info(license_signups)').all()).results.map(c=>c.name));
 const oldGallery=new Set((await db.prepare('PRAGMA table_info(gallery_items)').all()).results.map(c=>c.name));
 await db.batch(SCHEMA.map(sql=>db.prepare(sql)));
 for(const sql of [...MIGRATIONS,...ADDITIONS]){try{await db.prepare(sql).run();}catch(e){if(!/duplicate column name/i.test(e.message))throw e;}}
 for(const table of ['bookings','license_signups']){
  const columns=new Set((await db.prepare(`PRAGMA table_info(${table})`).all()).results.map(c=>c.name));
  if(!columns.has('status')){try{await db.prepare(`ALTER TABLE ${table} ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'`).run();}catch(e){if(!/duplicate column name/i.test(e.message))throw e;}}
 }
 if(oldLicenseColumns.size&&!oldLicenseColumns.has('status')&&oldLicenseColumns.has('result'))await db.prepare("UPDATE license_signups SET status=CASE WHEN result='passed' THEN 'passed' WHEN result='failed' THEN 'failed' ELSE 'pending' END").run();
 if(oldBookingColumns.size&&!oldBookingColumns.has('status')&&oldBookingColumns.has('state'))await db.prepare("UPDATE bookings SET status=CASE WHEN state IN ('pending','confirmed','completed','cancelled') THEN state ELSE 'pending' END").run();
 const galleryColumns={title:"TEXT NOT NULL DEFAULT ''",caption:'TEXT',image_url:'TEXT',is_active:'INTEGER NOT NULL DEFAULT 1',cat:"TEXT NOT NULL DEFAULT 'city'",label:"TEXT NOT NULL DEFAULT ''",file_url:"TEXT NOT NULL DEFAULT ''",is_featured:'INTEGER NOT NULL DEFAULT 0',is_published:'INTEGER NOT NULL DEFAULT 1',created_by:'INTEGER',updated_at:'TEXT'};
 const present=new Set((await db.prepare('PRAGMA table_info(gallery_items)').all()).results.map(c=>c.name));
 for(const [name,type] of Object.entries(galleryColumns))if(!present.has(name)){try{await db.prepare(`ALTER TABLE gallery_items ADD COLUMN ${name} ${type}`).run();}catch(e){if(!/duplicate column name/i.test(e.message))throw e;}}
 if(oldGallery.has('label'))await db.prepare("UPDATE gallery_items SET title=label WHERE (title IS NULL OR title='') AND label IS NOT NULL").run();
 if(oldGallery.has('file_url'))await db.prepare("UPDATE gallery_items SET image_url=file_url WHERE (image_url IS NULL OR image_url='') AND file_url IS NOT NULL").run();
 if(oldGallery.has('is_published'))await db.prepare('UPDATE gallery_items SET is_active=is_published').run();
 await db.prepare("UPDATE gallery_items SET label=title,file_url=COALESCE(image_url,''),is_published=is_active").run();
 await db.prepare("UPDATE message_comments SET author_name=COALESCE((SELECT username FROM players WHERE players.id=message_comments.player_id),'市民') WHERE author_name IS NULL OR author_name=''").run();
 await db.prepare('INSERT OR IGNORE INTO lc_schema_versions(version) VALUES(?)').bind(VERSION).run();
 })().catch(e=>{pending.delete(db);throw e;});pending.set(db,run);return run;}
