// POST /api/init - 初始化 D1 表 + 默认 super admin
// GET  /api/init - 返回 schema 状态
import { ok, err, hashPassword } from '../_shared.js';

const SCHEMA = [
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
    game_id TEXT,
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
    contact TEXT,
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new',
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
    persons INTEGER NOT NULL,
    breakfast INTEGER NOT NULL DEFAULT 0,
    name TEXT NOT NULL,
    contact TEXT NOT NULL,
    note TEXT,
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
  )`
];

export async function onRequestGet(context) {
  const { env } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  // 检查表是否存在
  const tables = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
  ).all();
  return ok({ tables: tables.results.map(r => r.name), schema_count: SCHEMA.length });
}

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');

  // 1. 建表
  for (const sql of SCHEMA) {
    await env.DB.prepare(sql).run();
  }

  // 2. 创建默认 super admin（如果不存在）
  const existing = await env.DB.prepare(
    'SELECT id FROM admins WHERE username = ?'
  ).bind('LycheeJin').first();

  let adminInfo = null;
  if (!existing) {
    // 默认密码：DengGuangWhat20120619（生产环境应该让用户立刻改）
    const defaultPw = 'DengGuangWhat20120619';
    const { hash, salt } = await hashPassword(defaultPw);
    const ins = await env.DB.prepare(
      'INSERT INTO admins (username, password_hash, salt, role) VALUES (?, ?, ?, ?)'
    ).bind('LycheeJin', hash, salt, 'super').run();
    adminInfo = { username: 'LycheeJin', role: 'super', default_password: defaultPw, action: 'created' };
  } else {
    adminInfo = { username: 'LycheeJin', action: 'already_exists' };
  }

  // 3. 返回初始化结果
  const tables = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ).all();

  return ok({
    initialized: true,
    tables: tables.results.map(r => r.name),
    admin: adminInfo
  });
}
