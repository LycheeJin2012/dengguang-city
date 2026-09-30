import { validatePublicImage } from './uploads.js';
import { endpoint, identity, body, integer, string, fail, reply } from './request.js';

// 字段规则用声明式描述，validated() 照着它做校验和转换。
// 同一个表在后台和公开端共用这套规则，避免两边校验漂移。
const str = (max = 200, required = false) => ({ type: 'text', max, required });
const num = (value = 0, min = 0, max = 1000000) => ({ type: 'number', value, min, max });
const bool = { type: 'number', value: 1, min: 0, max: 1 };

export const resources = {
  hotels: {
    table: 'hotels',
    key: 'hotels',
    fields: {
      owner_id: { type: 'nullable-id' },
      name: str(100, true),
      address: str(),
      description: str(2000),
      image_url: { type: 'url' },
      sort_order: num(),
      is_active: bool,
    },
  },
  'hotel-rooms': {
    table: 'hotel_rooms',
    key: 'rooms',
    fields: {
      hotel_id: num(null, 1),
      name: str(100, true),
      capacity: num(2, 1, 6),
      beds: str(),
      breakfast_included: bool,
      price_per_night: num(),
      description: str(2000),
      image_url: { type: 'url' },
      sort_order: num(),
      is_active: bool,
    },
  },
  'race-tracks': {
    table: 'race_tracks',
    key: 'tracks',
    fields: {
      name: str(100, true),
      length_km: { ...num(), decimal: true },
      laps: num(1, 1),
      difficulty: str(),
      description: str(2000),
      image_url: { type: 'url' },
      trial_price: num(),
      sort_order: num(),
      is_active: bool,
    },
  },
  'license-req': {
    table: 'license_requirements',
    key: 'requirements',
    fields: {
      exam_type: { type: 'enum', values: ['B', 'A', 'S', 'written', 'road', 'upgrade'], value: 'B' },
      title: str(100, true),
      description: str(2000),
      requirements: str(2000),
      min_age: num(),
      duration_minutes: num(30, 1),
      sort_order: num(),
      is_active: bool,
    },
  },
  announcements: {
    table: 'announcements',
    key: 'announcements',
    fields: {
      title: str(80, true),
      content: str(2000, true),
      image_url: { type: 'url' },
    },
  },
  gallery: {
    table: 'gallery_items',
    key: 'items',
    fields: {
      cat: { type: 'enum', values: ['city', 'road', 'kart', 'nature', 'announcement'], value: 'city' },
      is_featured: num(0, 0, 1),
      num: num(1, 1),
      title: str(100, true),
      caption: str(500),
      image_url: { type: 'url', required: true },
      sort_order: num(),
      is_active: bool,
    },
  },
};

export function validated(fields, data, partial = false) {
  const out = {};
  for (const [key, rule] of Object.entries(fields)) {
    // partial（PATCH）只处理请求里出现的键；全量（POST）用规则里的缺省值补齐。
    if (partial && !(key in data)) continue;

    let value = data[key] ?? rule.value;
    if (rule.type === 'text') {
      value = string(value ?? '', key, rule.max, { required: rule.required });
    }
    if (rule.type === 'nullable-id') {
      value = value ? integer(value, key) : null;
    }
    if (rule.type === 'number') {
      if (value == null) fail(400, `${key} 必填`);
      if (rule.decimal) {
        value = Number(value);
        if (!Number.isFinite(value) || value < rule.min || value > rule.max) fail(400, `${key} 数值无效`);
      } else {
        value = integer(value, key, rule.min, rule.max);
      }
    }
    if (rule.type === 'enum' && !rule.values.includes(value)) fail(400, `${key} 选项无效`);
    if (rule.type === 'url') {
      value = string(value ?? '', key, 1500000, { required: !!rule.required });
      if (
        value &&
        !/^https?:\/\//i.test(value) &&
        !/^data:image\/(png|jpeg|webp|gif);base64,/i.test(value) &&
        !/^\/?assets\/(?!.*\.\.)/.test(value) &&
        !/^\/api\/uploads\?/.test(value)
      ) {
        fail(400, '图片必须是 http(s) URL、本站资源或 PNG/JPEG/WebP/GIF 图片');
      }
    }
    out[key] = value;
  }
  return out;
}

// 画廊的列名是历史遗留的 title/file_url/is_published，
// 外部用 title/image_url/is_active，这里做双向映射。
// created_by / created_at 不在这里填：要等调用方确认过管理员身份再补。
function applyGalleryAliases(values) {
  if ('title' in values) values.label = values.title;
  if ('image_url' in values) values.file_url = values.image_url;
  if ('is_active' in values) values.is_published = values.is_active;
  values.updated_at = new Date().toISOString();
}

// 删除前要检查的引用关系。历史记录一律不许删，只能停用，
// 否则赛道上曾经跑过的时间、房间曾经被订过的单子会变成孤儿。
function blockingReferences(name) {
  if (name === 'hotels') return [['hotel_rooms', 'hotel_id']];
  if (name === 'hotel-rooms') return [['bookings', 'room_id']];
  if (name === 'race-tracks') return [['circuit_signups', 'track_id'], ['race_times', 'track_id']];
  return [];
}

async function readRows(env, def, name, url) {
  const where = [];
  const binds = [];
  const id = url.searchParams.has('id') ? integer(url.searchParams.get('id')) : null;
  if (id) {
    where.push('id=?');
    binds.push(id);
  }
  if (name === 'hotel-rooms' && url.searchParams.has('hotel_id')) {
    where.push('hotel_id=?');
    binds.push(integer(url.searchParams.get('hotel_id')));
  }
  return (
    await env.DB
      .prepare(
        `SELECT * FROM ${def.table}${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY ${
          'sort_order' in def.fields ? 'sort_order, ' : ''
        }id DESC LIMIT 500`
      )
      .bind(...binds)
      .all()
  ).results;
}

async function deleteRow(env, def, name, id) {
  for (const [table, column] of blockingReferences(name)) {
    if (await env.DB.prepare(`SELECT id FROM ${table} WHERE ${column}=? LIMIT 1`).bind(id).first()) {
      fail(409, '此记录已有房型、报名或历史记录，请改为停用以保留历史');
    }
  }
  await env.DB.prepare(`DELETE FROM ${def.table} WHERE id=?`).bind(id).run();
  return reply({ deleted: id });
}

async function insertRow(env, def, name, values, publicImage) {
  const operations = [
    env.DB
      .prepare(`INSERT INTO ${def.table}(${Object.keys(values).join(',')}) VALUES(${Object.keys(values).map(() => '?').join(',')})`)
      .bind(...Object.values(values)),
  ];
  if (name === 'announcements') {
    // 公告同时推给所有订阅了公告的在册市民。
    operations.push(
      env.DB
        .prepare(
          "INSERT INTO notification_log(player_id,type,title,body,link) SELECT DISTINCT s.player_id,'announcement',?,?,'/#notice' FROM subscriptions s JOIN players p ON p.id=s.player_id WHERE s.type='announcement' AND s.enabled=1 AND p.status='active'"
        )
        .bind(values.title, values.content.slice(0, 500))
    );
  }
  if (publicImage) {
    operations.push(env.DB.prepare('UPDATE media_uploads SET public_access=1 WHERE id=?').bind(publicImage));
  }
  // batch 的第一个返回值就是 INSERT 本身，id 得从这儿拿。
  const results = await env.DB.batch(operations);
  return reply({ id: results[0].meta.last_row_id, created: true }, 201);
}

async function updateRow(env, def, name, id, values, publicImage) {
  // 画廊自己维护 updated_at（而且要带毫秒时间戳），所以不给它追加 datetime('now')。
  const updatedAt = name !== 'gallery' ? ", updated_at=datetime('now')" : '';
  const operations = [
    env.DB
      .prepare(`UPDATE ${def.table} SET ${Object.keys(values).map((k) => k + '=?').join(',')}${updatedAt} WHERE id=?`)
      .bind(...Object.values(values), id),
  ];
  if (publicImage) {
    operations.push(env.DB.prepare('UPDATE media_uploads SET public_access=1 WHERE id=?').bind(publicImage));
  }
  await env.DB.batch(operations);
  return reply({ id, updated: true });
}

export function resource(name) {
  const def = resources[name];
  return (context) =>
    endpoint(async () => {
      const { env, request } = context;
      const method = request.method;
      const isCreate = method === 'POST';
      // 读要管理员，写只要超管。
      const admin = await identity(context, method !== 'GET' ? 'super' : 'admin');
      const url = new URL(request.url);
      const id = url.searchParams.has('id') ? integer(url.searchParams.get('id')) : null;

      if (method === 'GET') return reply({ [def.key]: await readRows(env, def, name, url) });

      if (!['POST', 'PATCH', 'DELETE'].includes(method)) fail(405, '不支持此请求方式');
      if (method !== 'POST') {
        if (!id) fail(400, 'id 必填');
        if (!(await env.DB.prepare(`SELECT id FROM ${def.table} WHERE id=?`).bind(id).first())) fail(404, '记录不存在');
      }
      if (method === 'DELETE') return deleteRow(env, def, name, id);

      const input = await body(request);
      // 画廊：把前端沿用的旧字段名先折成新字段名，再交给统一校验。
      if (name === 'gallery') {
        if (input.title === undefined && input.label !== undefined) input.title = input.label;
        if (input.image_url === undefined && input.file_url !== undefined) input.image_url = input.file_url;
        if (input.is_active === undefined && input.is_published !== undefined) input.is_active = input.is_published ? 1 : 0;
      }

      const values = validated(def.fields, input, !isCreate);
      if (!Object.keys(values).length) fail(400, '没有可更新的字段');
      if (values.owner_id && !(await env.DB.prepare("SELECT id FROM hotel_owners WHERE id=? AND status='active'").bind(values.owner_id).first())) {
        fail(404, '酒店老板账户不存在或已停用');
      }

      const publicImage = values.image_url ? await validatePublicImage(context, values.image_url, admin) : null;

      if (name === 'hotel-rooms' && values.hotel_id && !(await env.DB.prepare('SELECT id FROM hotels WHERE id=?').bind(values.hotel_id).first())) {
        fail(404, '酒店不存在');
      }
      if (name === 'announcements' && isCreate) values.created_by = admin.id;
      if (name === 'gallery') {
        applyGalleryAliases(values);
        if (isCreate) {
          values.created_by = admin.id;
          values.created_at = values.updated_at;
        }
      }

      if (isCreate) return insertRow(env, def, name, values, publicImage);
      return updateRow(env, def, name, id, values, publicImage);
    });
}
