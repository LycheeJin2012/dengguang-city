// v27 临时 debug 端点 — 创建测试 super admin 用于排查
// GET /api/debug-create-admin
// 自动创建: username=test_super / password=DebugTest123
// 排查完删除本文件 + 调用 DELETE /api/debug-create-admin 移除账号
import { ok, err, hashPassword } from '../_shared.js';

const TEST_USERNAME = 'test_super';
const TEST_PASSWORD = 'DebugTest123';

export async function onRequestGet(context) {
  const { env } = context;
  if (!env.DB) return err(500, 'D1 not configured');
  try {
    const existing = await env.DB.prepare('SELECT id FROM admins WHERE username = ?').bind(TEST_USERNAME).first();
    if (existing) {
      return ok({ message: '已存在', id: existing.id, username: TEST_USERNAME, password: TEST_PASSWORD });
    }
    const { hash, salt } = await hashPassword(TEST_PASSWORD);
    const ins = await env.DB.prepare(
      'INSERT INTO admins (username, password_hash, salt, role) VALUES (?, ?, ?, ?)'
    ).bind(TEST_USERNAME, hash, salt, 'super').run();
    return ok({ message: '已创建', id: ins.meta.last_row_id, username: TEST_USERNAME, password: TEST_PASSWORD });
  } catch (e) {
    return err('失败: ' + (e.message || e), 500);
  }
}

export async function onRequestDelete(context) {
  const { env } = context;
  if (!env.DB) return err(500, 'D1 not configured');
  try {
    await env.DB.prepare('DELETE FROM admins WHERE username = ?').bind(TEST_USERNAME).run();
    return ok({ message: '已删除' });
  } catch (e) {
    return err('失败: ' + (e.message || e), 500);
  }
}
