/**
 * GET /api/my-audit —— 固定 403。
 *
 * 内部操作留痕只给管理端监督查看，玩家侧一律拒绝。
 * 刻意用 403 而不是 404：这条路由是存在的，只是你不该走。
 */
import { endpoint, fail } from '../_core/request.js';

export const onRequestGet = (c) =>
  endpoint(async () => {
    fail(403, '内部操作留痕仅供管理端监督查看');
  });
