/**
 * /api/admin/license-req —— 驾照申请单的审批。
 *
 * 走 resources.js 的通用 CRUD 工厂，这里只提供资源名。
 * 注意它和 /api/admin/license 是两回事：那个是「提交表」的审核。
 */
import { resource } from '../../_core/resources.js';

export const onRequest = resource('license-req');
