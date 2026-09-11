import {SCHEMA,MIGRATIONS} from '../api/_schema.js';
const pending=new WeakMap();
export const SCHEMA_VERSION=67;
const VERSION=SCHEMA_VERSION;
const UPDATE_67=[
 "CREATE TABLE IF NOT EXISTS city_places(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,category TEXT NOT NULL DEFAULT 'facility',dimension TEXT NOT NULL DEFAULT 'overworld',x INTEGER NOT NULL,z INTEGER NOT NULL,description TEXT NOT NULL DEFAULT '',construction_status TEXT NOT NULL DEFAULT 'open',construction_note TEXT NOT NULL DEFAULT '',expected_end TEXT NOT NULL DEFAULT '',published INTEGER NOT NULL DEFAULT 0,revision INTEGER NOT NULL DEFAULT 1,updated_by INTEGER NOT NULL,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
 "ALTER TABLE sessions ADD COLUMN device_label TEXT NOT NULL DEFAULT '未记录设备'",
 "CREATE TABLE IF NOT EXISTS login_history(id INTEGER PRIMARY KEY AUTOINCREMENT,player_id INTEGER NOT NULL,method TEXT NOT NULL,device_label TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
 "CREATE INDEX IF NOT EXISTS idx_login_history_player ON login_history(player_id,id)",
];
const ADDITIONS=[...UPDATE_67,
 "CREATE TABLE IF NOT EXISTS support_chats(id INTEGER PRIMARY KEY AUTOINCREMENT,player_id INTEGER NOT NULL UNIQUE,status TEXT NOT NULL DEFAULT 'queued',assigned_admin_id INTEGER,requires_super INTEGER NOT NULL DEFAULT 0,reason TEXT NOT NULL DEFAULT '',auto_handoff INTEGER NOT NULL DEFAULT 1,needs_ticket INTEGER NOT NULL DEFAULT 0,ticket_summary TEXT,linked_ticket_id INTEGER,revision INTEGER NOT NULL DEFAULT 1,requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
 "CREATE TABLE IF NOT EXISTS support_chat_events(id INTEGER PRIMARY KEY AUTOINCREMENT,chat_id INTEGER NOT NULL,actor_type TEXT NOT NULL,actor_id INTEGER,actor_name TEXT NOT NULL,action TEXT NOT NULL,details TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
 "CREATE TABLE IF NOT EXISTS reply_feedback(id INTEGER PRIMARY KEY AUTOINCREMENT,player_id INTEGER NOT NULL,kind TEXT NOT NULL,target_id TEXT NOT NULL,ticket_ref TEXT,helpful INTEGER NOT NULL,reason TEXT NOT NULL DEFAULT '',comment TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(player_id,kind,target_id))",
 "CREATE TABLE IF NOT EXISTS ticket_triage(ticket_ref TEXT PRIMARY KEY,priority TEXT NOT NULL,urgency TEXT NOT NULL,complexity TEXT NOT NULL,reason TEXT NOT NULL,source TEXT NOT NULL,manual INTEGER NOT NULL DEFAULT 0,token TEXT,updated_by INTEGER,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP) WITHOUT ROWID",
 "CREATE TABLE IF NOT EXISTS exam_appeals(id INTEGER PRIMARY KEY AUTOINCREMENT,session_id TEXT NOT NULL,question_id TEXT NOT NULL,player_id INTEGER NOT NULL,original_score INTEGER NOT NULL,reason TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',reply TEXT,reviewer_id INTEGER,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,resolved_at TEXT,UNIQUE(session_id,question_id))",
 "CREATE TABLE IF NOT EXISTS exam_sessions(id TEXT PRIMARY KEY,player_id INTEGER NOT NULL,grade TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'generating',paper TEXT,answers TEXT NOT NULL DEFAULT '{}',results TEXT,score INTEGER,known_score INTEGER NOT NULL DEFAULT 0,pending_count INTEGER NOT NULL DEFAULT 0,revision INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,submitted_at TEXT)",
 "CREATE UNIQUE INDEX IF NOT EXISTS idx_exam_active ON exam_sessions(player_id) WHERE status IN ('generating','in_progress','grading')",
 "CREATE INDEX IF NOT EXISTS idx_exam_player ON exam_sessions(player_id,created_at)",
 "CREATE TABLE IF NOT EXISTS exam_session_events(id INTEGER PRIMARY KEY AUTOINCREMENT,session_id TEXT NOT NULL,actor_type TEXT NOT NULL,actor_id INTEGER,actor_name TEXT NOT NULL,action TEXT NOT NULL,details TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
 "CREATE TABLE IF NOT EXISTS knowledge_versions(article_id INTEGER NOT NULL,revision INTEGER NOT NULL,payload TEXT NOT NULL,actor_id INTEGER NOT NULL,actor_name TEXT NOT NULL,action TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(article_id,revision)) WITHOUT ROWID",
 "CREATE TABLE IF NOT EXISTS knowledge_articles(id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT NOT NULL,question TEXT NOT NULL,answer TEXT NOT NULL,keywords TEXT NOT NULL DEFAULT '',audience TEXT NOT NULL DEFAULT 'public',status TEXT NOT NULL DEFAULT 'draft',source_kind TEXT NOT NULL DEFAULT 'manual',source_id INTEGER,source_hash TEXT,revision INTEGER NOT NULL DEFAULT 1,created_by INTEGER NOT NULL,reviewed_by INTEGER,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
 "CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_source ON knowledge_articles(source_kind,source_id) WHERE source_id IS NOT NULL",
 "CREATE INDEX IF NOT EXISTS idx_knowledge_status ON knowledge_articles(status,audience)",
 "ALTER TABLE direct_messages ADD COLUMN knowledge_sources TEXT",
 "CREATE TABLE IF NOT EXISTS exam_question_drafts(id INTEGER PRIMARY KEY AUTOINCREMENT,created_by INTEGER NOT NULL,grade TEXT NOT NULL,q_type TEXT NOT NULL,payload TEXT NOT NULL,sources TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'draft',question_id INTEGER,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
 "CREATE TABLE IF NOT EXISTS ticket_auto_replies(ticket_ref TEXT PRIMARY KEY,content TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP) WITHOUT ROWID",
 "CREATE UNIQUE INDEX IF NOT EXISTS idx_support_active ON tickets(player_id) WHERE source_table='support' AND status IN ('open','in_progress')",
 // Older player tables predate these columns; CREATE TABLE IF NOT EXISTS never adds them.
 "ALTER TABLE players ADD COLUMN game_id TEXT",
 "ALTER TABLE players ADD COLUMN last_login_at TEXT",
 "CREATE TABLE IF NOT EXISTS dispatch_settings(id INTEGER PRIMARY KEY CHECK(id=1),enabled INTEGER NOT NULL DEFAULT 1,urgent_admin_id INTEGER,complex_admin_id INTEGER,max_active INTEGER NOT NULL DEFAULT 12,revision INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
 "INSERT OR IGNORE INTO dispatch_settings(id) VALUES(1)",
 "ALTER TABLE tickets ADD COLUMN dispatch_hold INTEGER NOT NULL DEFAULT 0",
 "ALTER TABLE tickets ADD COLUMN dispatch_token TEXT",
 "ALTER TABLE tickets ADD COLUMN dispatch_note TEXT",
 "ALTER TABLE messages ADD COLUMN dispatch_hold INTEGER NOT NULL DEFAULT 0",
 "ALTER TABLE messages ADD COLUMN dispatch_token TEXT",
 "ALTER TABLE messages ADD COLUMN dispatch_note TEXT",
 "ALTER TABLE tickets ADD COLUMN contact TEXT",
 "ALTER TABLE tickets ADD COLUMN public_reply_by INTEGER",
 "ALTER TABLE messages ADD COLUMN public_reply_by INTEGER",
 "CREATE TABLE IF NOT EXISTS hotel_owners(id INTEGER PRIMARY KEY AUTOINCREMENT,username TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,salt TEXT NOT NULL,linked_player_id INTEGER UNIQUE,status TEXT NOT NULL DEFAULT 'active',created_by INTEGER,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
 "ALTER TABLE sessions ADD COLUMN hotel_owner_id INTEGER",
 "ALTER TABLE hotels ADD COLUMN owner_id INTEGER",
 "ALTER TABLE admins ADD COLUMN specialties TEXT NOT NULL DEFAULT ''",
 "ALTER TABLE tickets ADD COLUMN kind TEXT NOT NULL DEFAULT 'service'",
 "ALTER TABLE tickets ADD COLUMN public_consent INTEGER NOT NULL DEFAULT 0",
 "ALTER TABLE tickets ADD COLUMN public_visible INTEGER NOT NULL DEFAULT 0",
 "ALTER TABLE tickets ADD COLUMN public_title TEXT",
 "ALTER TABLE tickets ADD COLUMN public_body TEXT",
 "ALTER TABLE tickets ADD COLUMN public_reply TEXT",
 "ALTER TABLE tickets ADD COLUMN target_player_id INTEGER",
 "ALTER TABLE tickets ADD COLUMN target_player_name TEXT",
 "ALTER TABLE tickets ADD COLUMN target_admin_id INTEGER",
 "ALTER TABLE messages ADD COLUMN public_consent INTEGER NOT NULL DEFAULT 1",
 "ALTER TABLE messages ADD COLUMN public_visible INTEGER NOT NULL DEFAULT 1",
 "ALTER TABLE messages ADD COLUMN public_title TEXT",
 "ALTER TABLE messages ADD COLUMN public_body TEXT",
 "ALTER TABLE messages ADD COLUMN public_reply TEXT",
 "ALTER TABLE messages ADD COLUMN target_player_id INTEGER",
 "ALTER TABLE messages ADD COLUMN target_player_name TEXT",
 "ALTER TABLE messages ADD COLUMN target_admin_id INTEGER",
 "CREATE TABLE IF NOT EXISTS ticket_events(id INTEGER PRIMARY KEY AUTOINCREMENT,ticket_ref TEXT NOT NULL,actor_type TEXT NOT NULL,actor_id INTEGER,actor_name TEXT NOT NULL,action TEXT NOT NULL,details TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
 "CREATE INDEX IF NOT EXISTS idx_ticket_events_ref ON ticket_events(ticket_ref,id)",
 "CREATE TABLE IF NOT EXISTS ticket_rewards(ticket_ref TEXT PRIMARY KEY,admin_id INTEGER NOT NULL,player_id INTEGER,amount INTEGER NOT NULL DEFAULT 10,paid INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,paid_at TEXT) WITHOUT ROWID",
 "CREATE TABLE IF NOT EXISTS ticket_comments(id INTEGER PRIMARY KEY AUTOINCREMENT,ticket_ref TEXT NOT NULL,player_id INTEGER NOT NULL,author_name TEXT NOT NULL,content TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
 "CREATE TABLE IF NOT EXISTS audit_events(id INTEGER PRIMARY KEY AUTOINCREMENT,request_id TEXT,actor_type TEXT NOT NULL,actor_id INTEGER,actor_name TEXT NOT NULL,player_id INTEGER,admin_id INTEGER,owner_id INTEGER,action TEXT NOT NULL,resource_type TEXT,resource_id TEXT,method TEXT,path TEXT,http_status INTEGER,details TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
 "CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_events(created_at,id)",
 "CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_events(resource_type,resource_id,id)",
 "CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_events(actor_type,actor_id,id)",

 "CREATE TABLE IF NOT EXISTS media_uploads(id TEXT PRIMARY KEY,owner_player_id INTEGER,owner_admin_id INTEGER,name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,chunk_count INTEGER NOT NULL,purpose TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'uploading',public_access INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
 "CREATE TABLE IF NOT EXISTS media_chunks(upload_id TEXT NOT NULL,part INTEGER NOT NULL,data TEXT NOT NULL,byte_size INTEGER NOT NULL,PRIMARY KEY(upload_id,part)) WITHOUT ROWID",
 "CREATE TABLE IF NOT EXISTS ticket_attachments(upload_id TEXT PRIMARY KEY,ticket_ref TEXT NOT NULL) WITHOUT ROWID",
 "CREATE INDEX IF NOT EXISTS idx_ticket_attachments_ref ON ticket_attachments(ticket_ref)",
 "CREATE TRIGGER IF NOT EXISTS limit_ticket_attachments BEFORE INSERT ON ticket_attachments WHEN (SELECT COUNT(*) FROM ticket_attachments WHERE ticket_ref=NEW.ticket_ref)>=5 BEGIN SELECT RAISE(ABORT,'ticket_attachment_limit'); END",
 "CREATE TRIGGER IF NOT EXISTS limit_ticket_attachment_bytes BEFORE INSERT ON ticket_attachments WHEN COALESCE((SELECT SUM(u.size) FROM media_uploads u JOIN ticket_attachments a ON a.upload_id=u.id WHERE a.ticket_ref=NEW.ticket_ref),0)+(SELECT size FROM media_uploads WHERE id=NEW.upload_id)>209715200 BEGIN SELECT RAISE(ABORT,'ticket_attachment_bytes'); END",
 "CREATE TRIGGER IF NOT EXISTS valid_ticket_attachment BEFORE INSERT ON ticket_attachments WHEN NOT EXISTS(SELECT 1 FROM media_uploads WHERE id=NEW.upload_id AND status='ready' AND purpose='ticket') BEGIN SELECT RAISE(ABORT,'ticket_attachment_missing'); END",
 "CREATE INDEX IF NOT EXISTS idx_media_owner ON media_uploads(owner_player_id,owner_admin_id)",
 "ALTER TABLE media_uploads ADD COLUMN owner_hotel_id INTEGER",
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
 // A verified v64 database already has every historical table and migration.
 // Apply only the additive v67 changes instead of replaying hundreds of remote statements.
 if(await db.prepare('SELECT version FROM lc_schema_versions WHERE version=64').first()){
  for(const sql of UPDATE_67){try{await db.prepare(sql).run();}catch(e){if(!/duplicate column name/i.test(e.message))throw e;}}
  await db.prepare('INSERT OR IGNORE INTO lc_schema_versions(version) VALUES(?)').bind(VERSION).run();return;
 }

 const oldBookingColumns=new Set((await db.prepare('PRAGMA table_info(bookings)').all()).results.map(c=>c.name));
 const oldLicenseColumns=new Set((await db.prepare('PRAGMA table_info(license_signups)').all()).results.map(c=>c.name));
 const oldTicketColumns=new Set((await db.prepare('PRAGMA table_info(tickets)').all()).results.map(c=>c.name));
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
 if(!oldTicketColumns.has('public_consent'))await db.prepare("UPDATE tickets SET public_consent=1,public_visible=1,public_title=(SELECT name FROM messages m WHERE m.id=tickets.source_id),public_body=(SELECT content FROM messages m WHERE m.id=tickets.source_id),public_reply=(SELECT admin_reply FROM messages m WHERE m.id=tickets.source_id) WHERE source_table='messages' AND EXISTS(SELECT 1 FROM messages m WHERE m.id=tickets.source_id)").run();
 await db.prepare('INSERT OR IGNORE INTO lc_schema_versions(version) VALUES(?)').bind(VERSION).run();
 })().catch(e=>{pending.delete(db);throw e;});pending.set(db,run);return run;}
