// Primary navigation groups preserve existing child hashes and permission boundaries.
const superOnly = new Set(['tracks', 'hotels', 'rooms', 'requirements', 'announcements', 'gallery', 'admins', 'dms', 'owners', 'audit', 'knowledge', 'replyfeedback']);
export const groups = [
  { id: 'tickets', label: ['🎫 工单中心', '🎫 Tickets'], children: ['tickets'] },
  { id: 'dispatch', label: ['📋 派单', '📋 Dispatch'], children: ['dispatch'] },
  { id: 'support', label: ['🎧 人工客服', '🎧 Human support'], children: ['support','replyfeedback'] },
  { id: 'audit', label: ['📒 操作留痕', '📒 Operation audit'], children: ['audit'] },
  { id: 'accounts', label: ['👥 市民与账号', '👥 Citizens & accounts'], children: ['players', 'admins', 'password'] },
  { id: 'hotel-business', label: ['🏨 酒店业务', '🏨 Hotel services'], children: ['bookings', 'hotels', 'rooms', 'owners'] },
  { id: 'racing', label: ['🏁 赛车业务', '🏁 Racing'], children: ['kart', 'circuit', 'tracks', 'times'] },
  { id: 'driving', label: ['🚗 驾照与考试', '🚗 Licenses & exams'], children: ['license', 'requirements', 'questions', 'examreview'] },
  { id: 'knowledge', label: ['📚 灯灯问答', '📚 DengDeng answers'], children: ['knowledge'] },
  { id: 'content', label: ['📜 内容管理', '📜 Content'], children: ['announcements', 'gallery'] },
  { id: 'dms', label: ['✉️ 私信监管', '✉️ DM moderation'], children: ['dms'] },
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
