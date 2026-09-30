# 后端重做工单规范（v88.7）

所有 worker 必读。这份规范里的每一条都是这个项目已经踩过的坑。

## 背景

`functions/` 共 118 文件 / 3784 行，其中 **48 个文件严重压缩**（最长单行超 400 字节，
最极端的 `_core/chat-support.js` 原本 12 行装 3943 字节）。这一轮把压缩写法还原成
可读的正常代码，**不改任何行为**。

## 硬约束（违反即回滚）

1. **不改 export 名字和签名**。别的文件在 import，改了就断链。
   `export { a as b } from './x.js'` 这种转发式也要原样保留。
2. **不改 SQL 语义**。WHERE 条件、JOIN、字段顺序、事务顺序一个都不能动。
   尤其注意 `changes()=1` 这类串联条件，以及 D1 `batch()` 里的语句顺序。
3. **不改任何中文文案**。错误信息、注释里的示例、返回给前端的字串，逐字保留。
4. **不改 API 路径、不改 HTTP 方法分发、不改状态码**。
5. **不引新依赖**，不装任何软件。
6. **不改 DOM / data-* 钩子**（这条主要针对前端，后端对应的是返回结构的字段名）。

## 风格要求

- 正常缩进与换行，变量名不缩写（原来 `const r=await...` 可以写成有意义的命名）。
- SQL 字符串可以保持单行（SQL 本身不该被折行），但**周边逻辑必须可读**。
- 关键决策加注释写清「为什么」，不要写「做了什么」的废话注释。
- 单个函数超过约 40 行就该拆；拆出的私有函数不加 export。

## 验证要求（每个文件都必须做）

改完之后**必须**跑一遍验证，证明行为没变：

```bash
cd "/Users/Lychee Jin/Desktop/网页制作/dengguang-city-git"
"/Users/Lychee Jin/.local/node-v20.19.0-darwin-arm64/bin/node" --check <你改的每个文件>
"/Users/Lychee Jin/.local/node-v20.19.0-darwin-arm64/bin/node" --experimental-vm-modules --test tests/backend-equiv.test.js
```

第二条是**真 SQLite** 的等价性守门（复用 `tests/local-d1.mjs`），会把基线版和你的新版本
各跑一遍比对落库结果。如果你的文件还没被那个测试覆盖，至少要：

- 确认 export 名单与基线逐字一致
- 对可执行的纯函数，**同时 import 基线版和新版**，喂同一批输入比对输出

## 已知的坑（务必先读 `tests/backend-equiv.test.js` 里的注释）

1. **假绿**：`0 条 SQL 一致` 不等于两版行为一致，往往是鉴权就崩了。
   凡是要断言「一致」，先断言「真的干了活」。
2. `getSession` 校验 `expires_at`，假数据漏给这个字段会被当成过期会话删掉 → 401。
3. `crypto.randomUUID()` 生成的 token 每次都不同，比对前要抹掉，否则全是假差异。
4. `db.batch()` 的**返回值**必须接住，有些逻辑靠 `result[i].meta.changes` 判断成败。
   重写时把返回值丢了 = 逻辑坏了。

## 交付

只改你工单里列出的文件。**不要碰** `functions/api/_schema.js`（迁移脚本，改错会毁生产库）、
`functions/_core/database.js`（除非明确派给你）、`functions/_shared/webauthn.js`
（安全原语，改动必须配针对性测试）、`.dev.vars`、`wrangler.toml`、任何 `functions/` 之外的文件。

交付时报告：改了哪些文件、每个文件原来多少行现在多少行、验证结果、以及**任何你发现但
没有改的疑点**（原样保留并加注释，不要顺手修）。
