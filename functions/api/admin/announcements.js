/**
 * /api/admin/announcements —— 公告的增删改查。
 *
 * 走 resources.js 的通用 CRUD 工厂，这个文件只提供资源名。
 * 逻辑改动请改 _core/resources.js，不要在这里堆分支。
 */
import { resource } from '../../_core/resources.js';

export const onRequest = resource('announcements');
