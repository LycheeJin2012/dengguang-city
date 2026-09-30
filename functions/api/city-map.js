import { endpoint, identity, body, string, integer, reply, fail } from '../_core/request.js';

/** 公开视图能看到的列；管理视图额外带 published/revision。 */
const PUBLIC_FIELDS =
  'id,name,category,dimension,x,z,description,construction_status,construction_note,expected_end,updated_at';

const CATEGORIES = ['hotel', 'rail', 'road', 'park', 'facility'];
const STATES = ['open', 'planned', 'construction', 'closed'];

/** boolean 字段前端可能送 true/false/1/0/'1'/'0'，都要认。 */
const BOOLEAN_INPUTS = [0, 1, false, true, '0', '1'];

/** YYYY-MM-DD 且必须是真实存在的日期（挡掉 2026-02-31 这类）。 */
const isRealDate = (value) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value;

/**
 * GET /api/city-map —— 地图点位列表。
 * ?manage=1 切到管理视图：只有超管能进，且会看到未发布点位。
 */
export const onRequestGet = (c) =>
  endpoint(async () => {
    const isManage = new URL(c.request.url).searchParams.get('manage') === '1';
    // 权限检查在查询之前：管理视图的额外列（published/revision）不能漏给普通访客。
    if (isManage) await identity(c, 'super');

    const places = (
      await c.env.DB
        .prepare(
          `SELECT ${PUBLIC_FIELDS}${isManage ? ',published,revision' : ''} FROM city_places WHERE dimension='overworld' ${
            isManage ? '' : 'AND published=1'
          } ORDER BY id DESC LIMIT 1000`
        )
        .all()
    ).results;
    return reply({ places });
  });

/**
 * POST /api/city-map —— 新建或更新点位（乐观锁）。
 *
 * 带 id 即为更新，必须同时回传当前 revision；服务端用它做 CAS，
 * 冲突返回 409 让前端刷新，避免两个人同时编辑互相覆盖。
 * 更新和审计在同一个 batch 里，靠 changes()=1 让「真的改了」才记审计。
 */
export const onRequestPost = (c) =>
  endpoint(async () => {
    const admin = await identity(c, 'super');
    const input = await body(c.request);
    const db = c.env.DB;

    const id = input.id ? integer(input.id) : null;
    const revision = id ? integer(input.revision) : null;

    const name = string(input.name, '地点名称', 80);
    const description = string(input.description || '', '地点说明', 2000, { required: false });
    const note = string(input.construction_note || '', '施工说明', 1500, { required: false });
    const category = input.category;
    const dimension = input.dimension ?? 'overworld';
    const state = input.construction_status;

    if (!CATEGORIES.includes(category) || dimension !== 'overworld' || !STATES.includes(state)) {
      fail(400, '地点分类、维度或施工状态无效');
    }

    // 坐标允许字符串或数字，但空串/纯空白不行（Number('') 会静默变 0）。
    if (
      !['string', 'number'].includes(typeof input.x) ||
      !['string', 'number'].includes(typeof input.z) ||
      String(input.x).trim() === '' ||
      String(input.z).trim() === ''
    ) {
      fail(400, '坐标不能为空');
    }
    const x = integer(input.x, 'X', -30000000, 30000000);
    const z = integer(input.z, 'Z', -30000000, 30000000);

    const expectedEnd = string(input.expected_end || '', '预计恢复日期', 10, { required: false });
    if (expectedEnd && !isRealDate(expectedEnd)) fail(400, '预计恢复日期无效');

    if (!BOOLEAN_INPUTS.includes(input.published)) fail(400, '发布状态无效');
    const published = Number(input.published);

    // 供 INSERT / UPDATE 复用的列值，末位是操作者 id。
    const values = [
      name, category, dimension, x, z, description, state, note, expectedEnd, published, admin.id,
    ];

    // 审计快照记的是「这次写进去的样子」，revision 写的是落库后的新值。
    const snapshot = JSON.stringify({
      name, category, dimension, x, z, description,
      construction_status: state,
      construction_note: note,
      expected_end: expectedEnd,
      published,
      revision: id ? revision + 1 : 1,
    });

    // 放在 batch 里的第二条：CREATE 时用 last_insert_rowid() 兜底取新 id，
    // UPDATE 时直接给 id。changes()=1 保证没改到行时不留审计痕迹。
    const auditInsert = () =>
      db
        .prepare(
          "INSERT INTO audit_events(actor_type,actor_id,actor_name,admin_id,action,resource_type,resource_id,http_status,details) SELECT 'admin',?,?,?,'map.saved','city_places',COALESCE(?,CAST(last_insert_rowid() AS TEXT)),200,? WHERE changes()=1"
        )
        .bind(admin.id, admin.username, admin.id, id ? String(id) : null, snapshot);

    if (id) {
      const [updateResult] = await db.batch([
        db
          .prepare(
            "UPDATE city_places SET name=?,category=?,dimension=?,x=?,z=?,description=?,construction_status=?,construction_note=?,expected_end=?,published=?,updated_by=?,revision=revision+1,updated_at=datetime('now') WHERE id=? AND revision=?"
          )
          .bind(...values, id, revision),
        auditInsert(),
      ]);
      // changes 为 0 有两种可能：不存在，或别人已经改过（revision 不匹配）。都让前端刷新。
      if (!updateResult.meta.changes) fail(409, '地点已被修改或不存在，请刷新后重试');
      return reply({ id });
    }

    const [insertResult] = await db.batch([
      db
        .prepare(
          'INSERT INTO city_places(name,category,dimension,x,z,description,construction_status,construction_note,expected_end,published,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?,?)'
        )
        .bind(...values),
      auditInsert(),
    ]);
    return reply({ id: insertResult.meta.last_row_id }, 201);
  });
