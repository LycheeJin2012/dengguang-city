# 灯光市人民政府 · Light City Hall of MC

像素风 MC 城市政府官方网站，灯光市 (`github.com/LycheeJin2012/dengguang-city`)。

## 部署架构

- **静态站**：HTML + CSS + JS + 22 张图，无构建步骤（直接 Pages 部署）
- **后端**：Cloudflare Pages Functions + D1 (`dengguang-city-db`)
  - `/api/init` - 建表 + 默认 super admin（`LycheeJin` / 默认密码 `DengGuangWhat20120619`，登录后立即改！）
  - `/api/register` - 玩家注册
  - `/api/login` - 玩家/管理员登录（GET=查登录态，DELETE=登出）
  - `/api/messages` - 公开留言（GET）/ 玩家提交留言（POST）
  - `/api/bookings` - 玩家房间预订
  - `/api/kart` - 玩家卡丁车试跑报名
  - `/api/circuit` - 玩家国际赛车场试车报名
  - `/api/admin/messages` - 管理员管理留言
  - `/api/admin/players` - 管理员看玩家列表

## 本地测试

```bash
# 没有 wrangler / node 本地环境，部署在 Cloudflare Pages 后直接测试
# 打开 https://dengguang-city.pages.dev/api/init
```

## 数据安全

- 密码用 PBKDF2-SHA256 哈希（10 万轮，16 byte salt）
- Session token 32 byte 随机，存 D1，TTL 8 小时
- 公开 API 限流（生产建议加 CF Rate Limiting Rules）
- 留言/报名/预订需玩家登录；管理员 API 需 admin_id session
