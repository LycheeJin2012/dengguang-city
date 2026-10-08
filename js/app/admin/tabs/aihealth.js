/**
 * 模型服务连通性面板（aihealth）。
 *
 * 存在理由：全站 5 处模型调用在上游异常时一律静默降级，页面照常可用，
 * 管理员拿到的是固定模板，却没有任何提示说明「AI 实际未在运行」。
 * 本面板是该状况唯一的暴露入口，因此只有超管可见（入口在 admin-navigation.js
 * 的 superOnly 白名单中）。
 *
 * 交互约定：
 *   - 打开面板只读取配置，不发起任何上游请求，避免每次查看都消耗额度
 *   - 连通性测试由超管手动触发，结果保留在本页直到下次重新进入
 *   - 密钥本身不在本页显示，也不显示任何片段；仅呈现「是否已配置」
 */

import { adminContext } from '../state.js';
import { $, api, post, esc, region } from '../../core.js';

const FIELD = (label, value) =>
  `<div class="field"><span>${esc(label)}</span><div class="aihealth-value">${esc(value)}</div></div>`;

/** 把测试结果渲染成一段说明。state 为 null 表示尚未执行测试。 */
function result(state) {
  if (!state) return '<p class="muted wide">尚未执行连通性测试。</p>';

  const head = state.ok
    ? '<strong class="ok">连通正常</strong>'
    : '<strong class="bad">连通失败</strong>';

  const rows = [
    state.status ? `上游状态码：${esc(String(state.status))}` : '',
    Number.isFinite(state.ms) ? `响应耗时：${esc(String(state.ms))} 毫秒` : '',
    state.sample ? `模型回声：${esc(state.sample)}` : '',
  ].filter(Boolean);

  const detail = state.error ? `<p class="form-error">${esc(state.error)}</p>` : '';

  return (
    `<div class="notice wide">${head}</div>` +
    (rows.length ? `<ul class="aihealth-rows wide">${rows.map((r) => `<li>${r}</li>`).join('')}</ul>` : '') +
    detail
  );
}

export async function render() {
  const view = adminContext.root.querySelector('#admin-view');

  view.innerHTML =
    '<div class="section-head"><h2>模型服务连通性</h2></div>' +
    '<div id="aihealth-body"><p class="muted">正在读取配置…</p></div>';

  // 测试结果只存在这个闭包里。重新进入 tab 会重新渲染，状态自然清空，
  // 这样就不会出现「面板上显示的是几小时前的结果」这种误导。
  let probe = null;

  const load = () =>
    region($('#aihealth-body', view), () => api('/api/admin/ai-health'), (d, box) => {
      box.innerHTML =
        '<div class="form-grid">' +
        FIELD('密钥状态', d.configured ? '已配置' : '尚未配置') +
        FIELD('服务地址', d.base_url) +
        FIELD('模型名称', d.model) +
        '</div>' +
        '<p class="muted wide">' +
        '灯灯草稿、模拟出题、工单分类、派单建议与自动回复均依赖该服务。' +
        '任一环节连接失败时，系统会自动改用固定模板继续运行，页面不会报错——' +
        '因此需要在此定期核验。' +
        '</p>' +
        (d.configured
          ? '<div class="actions"><button type="button" id="aihealth-test" class="primary">执行连通性测试</button></div>'
          : '<p class="form-error wide">尚未配置密钥，无法执行连通性测试。</p>') +
        '<div id="aihealth-result" class="wide">' +
        result(probe) +
        '</div>';

      const button = $('#aihealth-test', box);
      if (button) {
        button.onclick = async () => {
          const original = button.textContent;
          button.disabled = true;
          button.textContent = '测试进行中…';
          try {
            probe = await post('/api/admin/ai-health');
          } catch (e) {
            probe = { ok: false, status: 0, ms: 0, error: e.message };
          }
          $('#aihealth-result', box).innerHTML = result(probe);
          button.disabled = false;
          button.textContent = original;
        };
      }
    });

  await load();
}