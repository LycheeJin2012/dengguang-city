// v50: D1 schema + 索引
// 所有 CREATE TABLE IF NOT EXISTS, 增量 ALTER, CREATE INDEX
// 25 张表 + 必要索引

export const SCHEMA = [
  // ===== 账号 =====
  `CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin',
    linked_player_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    game_id TEXT UNIQUE,
    status TEXT NOT NULL DEFAULT 'active',
    bio TEXT,
    avatar_emoji TEXT DEFAULT '👤',
    last_login_at TEXT,
    emeralds INTEGER NOT NULL DEFAULT 0,
    linked_admin_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    player_id INTEGER,
    admin_id INTEGER,
    combined INTEGER NOT NULL DEFAULT 0,
    ip TEXT,
    user_agent TEXT,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sess_player ON sessions(player_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sess_admin ON sessions(admin_id)`,

  // ===== 公告 / 图集 =====
  `CREATE TABLE IF NOT EXISTS announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    image_url TEXT,
    is_pinned INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_ann_pinned ON announcements(is_pinned, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS gallery_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    category TEXT,
    url TEXT NOT NULL,
    thumb TEXT,
    is_published INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_gal_cat ON gallery_items(category, sort_order)`,

  // ===== 留言 =====
  `CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER,
    name TEXT NOT NULL,
    contact TEXT NOT NULL,
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'unread',
    admin_reply TEXT,
    replied_at TEXT,
    replied_by INTEGER,
    previous_reply TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_msg_status ON messages(status, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_msg_player ON messages(player_id)`,
  `CREATE TABLE IF NOT EXISTS message_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL,
    player_id INTEGER,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  // ===== 工单 (admin 统一管理) =====
  `CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER,
    category TEXT NOT NULL,
    source_table TEXT,
    source_id INTEGER,
    title TEXT NOT NULL,
    body TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    priority TEXT NOT NULL DEFAULT 'normal',
    assignee_id INTEGER,
    admin_reply TEXT,
    replied_at TEXT,
    replied_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_ticket_cat ON tickets(category, status, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_ticket_player ON tickets(player_id)`,

  // ===== 酒店 / 房型 =====
  `CREATE TABLE IF NOT EXISTS hotels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    location TEXT,
    description TEXT,
    image_url TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS hotel_rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hotel_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    capacity INTEGER NOT NULL DEFAULT 2,
    beds TEXT,
    breakfast_included INTEGER NOT NULL DEFAULT 0,
    price_per_night INTEGER NOT NULL DEFAULT 0,
    description TEXT,
    image_url TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (hotel_id) REFERENCES hotels(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_rooms_hotel ON hotel_rooms(hotel_id, sort_order)`,
  `CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER,
    room_id TEXT NOT NULL,
    room_name TEXT,
    in_date TEXT NOT NULL,
    out_date TEXT NOT NULL,
    nights INTEGER NOT NULL,
    persons INTEGER NOT NULL DEFAULT 1,
    breakfast INTEGER NOT NULL DEFAULT 0,
    name TEXT NOT NULL,
    contact TEXT NOT NULL,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_book_player ON bookings(player_id, created_at DESC)`,

  // ===== 赛车 =====
  `CREATE TABLE IF NOT EXISTS race_tracks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    length_km REAL,
    laps INTEGER,
    difficulty TEXT,
    description TEXT,
    image_url TEXT,
    trial_price INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS kart_signups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER,
    name TEXT NOT NULL,
    contact TEXT NOT NULL,
    session TEXT,
    car INTEGER,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_kart_player ON kart_signups(player_id)`,
  `CREATE TABLE IF NOT EXISTS circuit_signups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER,
    name TEXT NOT NULL,
    contact TEXT NOT NULL,
    license TEXT,
    track_id INTEGER,
    session TEXT,
    car INTEGER,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_circuit_player ON circuit_signups(player_id)`,
  `CREATE TABLE IF NOT EXISTS race_times (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL,
    track_id INTEGER NOT NULL,
    time_ms INTEGER NOT NULL,
    kart_name TEXT,
    license_grade TEXT,
    verified INTEGER NOT NULL DEFAULT 0,
    recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_race_player ON race_times(player_id, recorded_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_race_track ON race_times(track_id, time_ms)`,

  // ===== 驾照 =====
  `CREATE TABLE IF NOT EXISTS license_requirements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    grade TEXT NOT NULL,
    title TEXT,
    description TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS license_signups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER,
    name TEXT NOT NULL,
    contact TEXT NOT NULL,
    exam_type TEXT,
    exam_date TEXT,
    exam_session TEXT,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS exam_questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    grade TEXT NOT NULL,
    question TEXT NOT NULL,
    options_json TEXT NOT NULL,
    correct_index INTEGER NOT NULL,
    explanation TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS exam_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL,
    grade TEXT NOT NULL,
    score INTEGER NOT NULL,
    total INTEGER NOT NULL,
    wrong_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  // ===== 私信 =====
  `CREATE TABLE IF NOT EXISTS direct_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_player_id INTEGER NOT NULL,
    to_player_id INTEGER NOT NULL,
    body TEXT NOT NULL,
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_dm_to ON direct_messages(to_player_id, is_read, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_dm_pair ON direct_messages(from_player_id, to_player_id, created_at DESC)`,

  // ===== 签到 / 通知 =====
  `CREATE TABLE IF NOT EXISTS daily_signin (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL,
    signin_date TEXT NOT NULL,
    streak INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (player_id, signin_date)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_signin_player ON daily_signin(player_id, signin_date DESC)`,
  `CREATE TABLE IF NOT EXISTS subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL,
    topic TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (player_id, topic)
  )`,
  `CREATE TABLE IF NOT EXISTS notification_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL,
    topic TEXT NOT NULL,
    payload TEXT,
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  // ===== Passkey / 鉴权 =====
  `CREATE TABLE IF NOT EXISTS passkeys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER,
    admin_id INTEGER,
    name TEXT,
    credential_id TEXT UNIQUE NOT NULL,
    public_key TEXT NOT NULL,
    counter INTEGER NOT NULL DEFAULT 0,
    transports TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_used_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS webauthn_challenges (
    token TEXT PRIMARY KEY,
    challenge TEXT NOT NULL,
    kind TEXT NOT NULL,
    subject TEXT,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
];

// 增量迁移 (老部署可能缺列)
export const MIGRATIONS = [
  `ALTER TABLE players ADD COLUMN linked_admin_id INTEGER`,
  `ALTER TABLE admins ADD COLUMN linked_player_id INTEGER`,
];
