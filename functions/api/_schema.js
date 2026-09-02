// v40.5: SCHEMA + MIGRATIONS 拆出来, init.js GET 路径 dynamic import
// 之前 56 条 CREATE/ALTER + 22 条 MIGRATIONS 数组在 init.js 顶部, 任何 GET 都要加载
// 现在只在 POST /api/init 显式初始化时 dynamic import, GET 路径零负担

// 基础 SCHEMA（新部署用 CREATE TABLE IF NOT EXISTS）
export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin',
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
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    player_id INTEGER,
    admin_id INTEGER,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
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
  `CREATE TABLE IF NOT EXISTS kart_signups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER,
    session TEXT,
    car TEXT,
    name TEXT NOT NULL,
    contact TEXT NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS circuit_signups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER,
    name TEXT NOT NULL,
    contact TEXT NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS license_signups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER,
    exam_type TEXT NOT NULL,
    exam_date TEXT,
    exam_session TEXT,
    contact TEXT NOT NULL,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    result TEXT,
    result_by INTEGER,
    result_at TEXT,
    reviewed_by INTEGER,
    reviewed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS message_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL,
    player_id INTEGER,
    author_name TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS direct_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_player_id INTEGER NOT NULL,
    to_player_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    read_at TEXT,
    replied_by_admin_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS passkeys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER,
    admin_id INTEGER,
    name TEXT NOT NULL,
    credential_id TEXT UNIQUE NOT NULL,
    public_key_jwk TEXT NOT NULL,
    counter INTEGER NOT NULL DEFAULT 0,
    transports TEXT,
    last_used_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS webauthn_challenges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    challenge TEXT UNIQUE NOT NULL,
    purpose TEXT NOT NULL,
    player_id INTEGER,
    admin_id INTEGER,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    image_url TEXT,
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT,
    FOREIGN KEY (created_by) REFERENCES admins(id)
  )`,
  // v18: 首页图集管理 (super only, 公开读)
  `CREATE TABLE IF NOT EXISTS gallery_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    num INTEGER NOT NULL,
    title TEXT NOT NULL,
    caption TEXT,
    image_url TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  // v25: 后台管理酒店/赛车场/驾照考试 (公开读, super 写)
  `CREATE TABLE IF NOT EXISTS hotels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    address TEXT,
    description TEXT,
    image_url TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS hotel_rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hotel_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    capacity INTEGER NOT NULL DEFAULT 2,
    beds TEXT,
    breakfast_included INTEGER NOT NULL DEFAULT 1,
    price_per_night INTEGER NOT NULL,
    description TEXT,
    image_url TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
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
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS license_requirements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    exam_type TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    requirements TEXT,
    min_age INTEGER,
    duration_minutes INTEGER,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  // v19: 每日签到
  `CREATE TABLE IF NOT EXISTS daily_signin (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL,
    signin_date TEXT NOT NULL,
    reward INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(player_id, signin_date)
  )`,
  // v47: tickets 工单 (admin 后台统一入口, 替代分散的 messages/license/bookings/kart 3 个 tab)
  // 双写: messages/license/bookings/circuit_signups/kart_signups POST 时同时写一张 ticket
  // 字段: player_id 提交人, category 工单类型, source_table/source_id 反向追溯原表
  //      status 状态 open|in_progress|resolved|closed, priority 优先级 low|normal|high|urgent
  //      assignee_id 派单给的 admin, admin_reply 管理员回复快照
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
  // v47: race_times 赛道成绩 + 排行榜
  // time_ms 用毫秒存, 显示时再格式化为 mm:ss.fff
  // verified=1 表示管理员确认 (后续可加截图/录像审核流程)
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
  // v47: exam_questions 驾照模拟题库
  // grade: B|A|S (B=初级/A=中级/S=高级)
  // q_type: choice(单选)|multi(多选)|judge(判断)
  // options: JSON 数组 (e.g. '["A. xxx","B. xxx",...]'), answer: 'A' / 'AB' / 'true'
  `CREATE TABLE IF NOT EXISTS exam_questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    grade TEXT NOT NULL,
    q_type TEXT NOT NULL DEFAULT 'choice',
    question TEXT NOT NULL,
    options TEXT,
    answer TEXT NOT NULL,
    explanation TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  // v47: exam_attempts 练习记录 (错题本/历史)
  `CREATE TABLE IF NOT EXISTS exam_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL,
    question_id INTEGER NOT NULL,
    is_correct INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  // v47: subscriptions 订阅
  // type: announcement(公告)|reply(留言被回复)|dm(私信)
  // channel: site(站内, 默认)|email|Telegram
  `CREATE TABLE IF NOT EXISTS subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    target_id INTEGER,
    channel TEXT NOT NULL DEFAULT 'site',
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  // v47: notification_log 站内通知 (v47 阶段只做 site channel, 邮件/Telegram 后接)
  `CREATE TABLE IF NOT EXISTS notification_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    link TEXT,
    read_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
];

// ALTER 迁移：给已存在的表加新字段（重复加会报"duplicate column"，吞掉）
export const MIGRATIONS = [
  `ALTER TABLE players ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`,
  `ALTER TABLE players ADD COLUMN bio TEXT`,
  `ALTER TABLE players ADD COLUMN avatar_emoji TEXT DEFAULT '👤'`,
  `ALTER TABLE messages ADD COLUMN admin_reply TEXT`,
  `ALTER TABLE messages ADD COLUMN replied_at TEXT`,
  `ALTER TABLE messages ADD COLUMN replied_by INTEGER`,
  // 修复 license_signups 缺 result_by/result_at 列
  `ALTER TABLE license_signups ADD COLUMN result_by INTEGER`,
  `ALTER TABLE license_signups ADD COLUMN result_at TEXT`,
  `ALTER TABLE license_signups ADD COLUMN reviewed_by INTEGER`,
  // v17.5: passkeys 支持 admin (player_id 改为可空 + 加 admin_id)
  `ALTER TABLE passkeys ADD COLUMN admin_id INTEGER`,
  // v17.7: messages 支持"AI 自动回复后被人工覆盖"的历史追溯
  `ALTER TABLE messages ADD COLUMN previous_reply TEXT`,
  // v17.8: announcements 兼容迁移
  `ALTER TABLE announcements ADD COLUMN updated_at TEXT`,
  // v25.33: 公告封面图
  `ALTER TABLE announcements ADD COLUMN image_url TEXT`,
  // v25.50: 赛车场试车价格（💎/次）
  `ALTER TABLE race_tracks ADD COLUMN trial_price INTEGER NOT NULL DEFAULT 0`,
  // v17.8: direct_messages 加 replied_by_admin_id (DM 回复人审计)
  `ALTER TABLE direct_messages ADD COLUMN replied_by_admin_id INTEGER`,
  // v17.8: admins 加 linked_player_id (管理员/玩家账号绑定)
  `ALTER TABLE admins ADD COLUMN linked_player_id INTEGER`,
  // v17.9: players 加 linked_admin_id (玩家反向绑定管理员,合并登录)
  `ALTER TABLE players ADD COLUMN linked_admin_id INTEGER`,
  // v17.9: backfill players.linked_admin_id 从 admins.linked_player_id 反向回填
  `UPDATE players SET linked_admin_id = (SELECT id FROM admins WHERE admins.linked_player_id = players.id) WHERE linked_admin_id IS NULL`,
  // v18: 加 D1 索引加速常用查询
  `CREATE INDEX IF NOT EXISTS idx_messages_status_created ON messages(status, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_messages_player ON messages(player_id)`,
  `CREATE INDEX IF NOT EXISTS idx_dm_from_to ON direct_messages(from_player_id, to_player_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_dm_to_unread ON direct_messages(to_player_id, read_at)`,
  `CREATE INDEX IF NOT EXISTS idx_dm_pair_created ON direct_messages(from_player_id, to_player_id, created_at DESC)`,
  // v43.2: 玩家管理 /api/admin/players 用 last_session 关联 sessions 表, 必须有 player_id 索引
  // 之前漏建, 导致每个玩家都全表扫描 sessions, 23 玩家 × N sessions ≈ 23 * 全表扫 = 卡顿
  `CREATE INDEX IF NOT EXISTS idx_sessions_player ON sessions(player_id)`,
  `CREATE INDEX IF NOT EXISTS idx_bookings_player ON bookings(player_id)`,
  `CREATE INDEX IF NOT EXISTS idx_kart_player ON kart_signups(player_id)`,
  `CREATE INDEX IF NOT EXISTS idx_circuit_player ON circuit_signups(player_id)`,
  `CREATE INDEX IF NOT EXISTS idx_license_player ON license_signups(player_id)`,
  `CREATE INDEX IF NOT EXISTS idx_msg_comments_msg ON message_comments(message_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_passkeys_player ON passkeys(player_id)`,
  `CREATE INDEX IF NOT EXISTS idx_passkeys_admin ON passkeys(admin_id)`,
  `CREATE INDEX IF NOT EXISTS idx_announcements_created ON announcements(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_webauthn_expires ON webauthn_challenges(expires_at)`,
  // v19: 每日签到 — players.emeralds 绿宝石余额 + daily_signin 表 (已建在 SCHEMA)
  `ALTER TABLE players ADD COLUMN emeralds INTEGER NOT NULL DEFAULT 0`,
  // v42: circuit_signups 加 track_id / session / car / license / emeralds_charged 字段
  // (国际赛车场试车报名之前只存 name/contact/note, 用户选的比赛场次/车型/驾照丢了)
  `ALTER TABLE circuit_signups ADD COLUMN track_id INTEGER`,
  `ALTER TABLE circuit_signups ADD COLUMN session TEXT`,
  `ALTER TABLE circuit_signups ADD COLUMN car TEXT`,
  `ALTER TABLE circuit_signups ADD COLUMN license TEXT`,
  `ALTER TABLE circuit_signups ADD COLUMN emeralds_charged INTEGER NOT NULL DEFAULT 0`,
  // v47: 5 张新表索引
  `CREATE INDEX IF NOT EXISTS idx_tickets_cat_status ON tickets(category, status, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_tickets_player ON tickets(player_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_tickets_assignee ON tickets(assignee_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_race_times_track ON race_times(track_id, time_ms)`,
  `CREATE INDEX IF NOT EXISTS idx_race_times_player ON race_times(player_id, recorded_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_exam_questions_grade ON exam_questions(grade, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_exam_attempts_player ON exam_attempts(player_id, question_id)`,
  `CREATE INDEX IF NOT EXISTS idx_subs_player ON subscriptions(player_id, type)`,
  `CREATE INDEX IF NOT EXISTS idx_notif_player_unread ON notification_log(player_id, read_at, created_at DESC)`,
];
