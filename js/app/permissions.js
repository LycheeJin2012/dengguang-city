/**
 * 顶栏两处入口的显示条件。
 *
 * 「市政后台」链接只有绑定了管理员身份的市民才看得见；「我的客栈」只有
 * 登录了酒店经营账号的人才看得见。core.js 渲染顶栏时逐个问这两个函数。
 *
 * 一行一个，纯判断无副作用 —— 放在这里是为了让 core.js 的导航不必
 * 认识 session 的具体结构。
 */

/** 顶栏「市政后台」入口：玩家已绑定管理员身份 */
export const canSeeMunicipalLink = (session) => Boolean(session?.player?.linked_admin_id);

/** 顶栏「我的客栈」入口：登录态里带着酒店经营账号 */
export const canSeeHotelOwnerLink = (session) => Boolean(session?.hotel_owner);
