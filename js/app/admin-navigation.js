// Primary navigation groups preserve existing child hashes and permission boundaries.
// v85：label 由 ['中文','English'] 收敛为纯中文字符串——纯中文化后没有第二语言了，
// 留数组会让 menu.textContent 渲染成 "中文,English"。
const superOnly = new Set(['citymap','tracks', 'hotels', 'rooms', 'requirements', 'announcements', 'gallery', 'admins', 'dms', 'owners', 'audit', 'knowledge', 'replyfeedback']);
export const groups = [
  { id: 'tickets', label: '🎫 工单中心', children: ['tickets'] },
  { id: 'dispatch', label: '📋 派单', children: ['dispatch'] },
  { id: 'support', label: '🎧 人工客服', children: ['support','replyfeedback'] },
  { id: 'audit', label: '📒 操作留痕', children: ['audit'] },
  { id: 'accounts', label: '👥 市民与账号', children: ['players','admins', 'password'] },
  { id: 'hotel-business', label: '🏨 客栈业务', children: ['bookings', 'hotels', 'rooms', 'owners'] },
  { id: 'racing', label: '🏁 赛车业务', children: ['kart', 'circuit', 'tracks', 'times'] },
  { id: 'driving', label: '🚗 驾照与考试', children: ['license', 'requirements', 'questions', 'examreview'] },
  { id: 'knowledge', label: '📚 灯灯问答', children: ['knowledge'] },
  { id: 'citymap', label: '🗺️ 地图与施工', children: ['citymap'] },
  { id: 'content', label: '📜 内容管理', children: ['announcements', 'gallery'] },
  { id: 'dms', label: '✉️ 私信巡查', children: ['dms'] },
];
export function navigationFor(isSuper) {
  return groups.map(group => ({ ...group, children: group.children.filter(key => isSuper || !superOnly.has(key)) }))
    .filter(group => group.children.length);
}
export function resolveNavigation(key, isSuper) {
  const navigation = navigationFor(isSuper);
  const group = navigation.find(group => group.id === key || group.children.includes(key)) || navigation[0];
  return { group, child: group.children.includes(key) ? key : group.children[0] };
}
