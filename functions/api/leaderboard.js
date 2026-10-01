/**
 * GET /api/leaderboard —— 固定 410 Gone。
 *
 * 榜单功能已下线，但旧客户端可能还在调。用 410 明确告诉调用方
 * 「不是出错了，是这个接口被撤了」，与 404 区分开。
 * 文案被测试钉住，改动前先确认没有调用方。
 */
import { endpoint, fail } from '../_core/request.js';

export const onRequestGet = (c) =>
  endpoint(async () => {
    fail(410, '榜单功能已移除');
  });
