/**
 * /api/admin/gallery —— 相册管理。
 *
 * 走 resources.js 的通用 CRUD 工厂，这里只提供资源名。
 */
import { resource } from '../../_core/resources.js';

export const onRequest = resource('gallery');
