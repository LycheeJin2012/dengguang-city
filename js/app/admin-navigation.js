/**
 * 管理后台一级导航的分组与解析。
 *
 * 后台左侧按「12 组大菜单」折叠，子项就是各个 tab key。groups 是唯一定义处，
 * index.js 的 switchTab() 和 shared.js 的再导出都从这里取数据。
 *
 * ⚠️ 结构是被测试锁死的：tests/media.test.js 断言 groups 有 12 组、
 *    children 去重后 25 个，且前两组必须是 tickets / dispatch。
 *    增删分组或改子项 key 会直接挂测试 —— 改前先看那个断言。
 *
 * 权限边界靠 superOnly 这张白名单：不在表里的子项普通管理员也能看见。
 * 表里的只有超管能看到。filter 掉空分组是必要的 —— 全被过滤掉的大菜单
 * 渲染出来会是个点不开的空壳。
 *
 * v85：label 由 ['中文','English'] 收敛为纯中文字符串——纯中文化后没有第二语言了，
 * 留数组会让 menu.textContent 渲染成 "中文,English"。
 */

/** 仅超管可见的子项。非超管会在 navigationFor() 里被滤掉。 */
const superOnly = new Set([
  'citymap',
  'tracks',
  'hotels',
  'rooms',
  'requirements',
  'announcements',
  'gallery',
  'admins',
  'dms',
  'owners',
  'audit',
  'knowledge',
  'replyfeedback',
]);

export const groups = [
  { id: 'tickets', label: '🎫 工单中心', children: ['tickets'] },
  { id: 'dispatch', label: '📋 派单', children: ['dispatch'] },
  { id: 'support', label: '🎧 人工客服', children: ['support', 'replyfeedback'] },
  { id: 'audit', label: '📒 操作留痕', children: ['audit'] },
  { id: 'accounts', label: '👥 市民与账号', children: ['players', 'admins', 'password'] },
  { id: 'hotel-business', label: '🏨 客栈业务', children: ['bookings', 'hotels', 'rooms', 'owners'] },
  { id: 'racing', label: '🏁 赛车业务', children: ['kart', 'circuit', 'tracks', 'times'] },
  { id: 'driving', label: '🚗 驾照与考试', children: ['license', 'requirements', 'questions', 'examreview'] },
  { id: 'knowledge', label: '📚 灯灯问答', children: ['knowledge'] },
  { id: 'citymap', label: '🗺️ 地图与施工', children: ['citymap'] },
  { id: 'content', label: '📜 内容管理', children: ['announcements', 'gallery'] },
  { id: 'dms', label: '✉️ 私信巡查', children: ['dms'] },
];

/**
 * 按权限裁出当前身份可见的分组。
 * @param {boolean} isSuper 是否超管
 * @returns {Array<{id:string,label:string,children:string[]}>} 子项被滤空的分组直接不返回
 */
export function navigationFor(isSuper) {
  return groups
    .map((group) => ({
      ...group,
      children: group.children.filter((key) => isSuper || !superOnly.has(key)),
    }))
    .filter((group) => group.children.length);
}

/**
 * 把一个「可能是组 id、也可能是子项 key」的输入解析成 { group, child }。
 *
 * 用户可以直接敲 #rooms 进组，也可以敲 #tickets 进子项，两种都得认。
 * 认不出来（未知 key 或空 hash）一律退回第一组的第一个子项 —— 后台
 * 不允许停在「什么都不显示」的状态。
 */
export function resolveNavigation(key, isSuper) {
  const navigation = navigationFor(isSuper);
  const group =
    navigation.find((group) => group.id === key || group.children.includes(key)) || navigation[0];
  return {
    group,
    child: group.children.includes(key) ? key : group.children[0],
  };
}
