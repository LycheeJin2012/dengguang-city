/**
 * /api/admin/hotel-rooms —— 客栈房型管理。
 *
 * 走 resources.js 的通用 CRUD 工厂，这里只提供资源名。
 */
import { resource } from '../../_core/resources.js';

export const onRequest = resource('hotel-rooms');
