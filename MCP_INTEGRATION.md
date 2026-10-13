# MCP 集成说明 · MCP_INTEGRATION

本 Skill 基于**麦当劳中国官方 MCP Server** 构建。本文说明用到了哪些工具、调用流程、以及业务价值。

- **接入地址**：`https://mcp.mcd.cn`
- **传输协议**：Streamable HTTP
- **鉴权**：请求头 `Authorization: Bearer <MCD_MCP_TOKEN>`
- **Token 获取**：<https://open.mcd.cn/mcp>（手机号登录 → 控制台 → 激活，免费）

---

## 一、用到的 MCP Server / Tool

麦当劳 MCP 当前共开放 **35 个工具**（`tools/list` 实测），本 Skill 取其中形成「推荐 → 核价 → 下单」闭环的 8 个：

| Tool | 用途 | 在本 Skill 中的角色 |
| --- | --- | --- |
| `query-nearby-stores` | 查询附近门店（需传 `beType` + `searchType`，可带 `city`/`keyword`） | **定位门店**：拿到 `storeCode`，后续所有调用都依赖它；返回多家门店供用户切换 |
| `query-meals` | 查询门店在售餐品（必传 `storeCode` / `orderType` / `beType`） | **取菜单**：返回 `categories` + `meals` 映射表，含 `name` / `currentPrice` / `originalPrice` / `image` |
| `list-nutrition-foods` | 餐品营养数据（免入参，toon 紧凑格式返回） | **算营养**：热量 kcal、蛋白质 g |
| `available-coupons` | 麦麦省可领券列表（免入参） | **列优惠**：返回券标题（不含面额，见下文说明） |
| `calculate-price` | 官方核价（按商品列表计算优惠后总价） | **权威核价**：我方算法选品后，用官方口径复核总价；同时返回 `takeWayList`（取餐方式） |
| `query-my-coupons` | 用户卡包券资产 | **叠券**：用户已持有的券可参与比价 |
| `create-order` | 创建真实订单（到店 / 外送） | **一键下单**：套餐确认后，在用户麦当劳账户中创建未支付订单 |
| `query-order` | 查询订单状态 | **订单确认**：支付后核对订单状态 |

> 其余 27 个工具（积分商城、派对预约、抽奖、活动日历等）本 Skill 暂不使用，保持职责单一。

**实测要点（踩坑记录）**

1. **价格单位是「分」**：`calculate-price` 返回的 `price: 4430` 实际是 **¥44.30**，必须除以 100；
2. **`query-meals` 必须先有门店**：`storeCode` / `orderType` / `beType` 三者缺一不可，
   而 `storeCode` 只能从 `query-nearby-stores` 拿到；
3. **`query-nearby-stores` 的 `beType` 语义**：`1` = 到店自取（**不返回 beCode**，后续也不传），
   `5` = 得来速（**必须传 beCode**），本 Skill 统一走 `beType: 1`；
4. **营养数据是 toon 紧凑格式**，不是 JSON 数组：
   `[160]{productName,energyKj,energyKcal,protein,...}:\n 猪柳麦满分,null,1288,308,16,...`
   需要按表头列名逐行切分解析；
5. **菜名与营养表名不完全一致**：菜单里叫「薯条」，营养表里叫「中薯条」，且尺寸缺失
   （菜单只给一个「薯条」，营养表分大/中/小）。本 Skill 用
   **精确 → 归一化 → 包含 → 最长公共子串** 四级策略匹配，匹配不到的按同分类中位数估算并显式标注；
6. **优惠券拿不到面额**：`available-coupons` 只返回券标题和图片；
   `query-store-coupons` 在无券门店返回空数组；`query-promotions` 仅限企业团餐场景（`beType=6`）。
   因此本 Skill **不虚构优惠金额**——立省金额只来自菜单本身的 `originalPrice - currentPrice`，
   真实总价以 `calculate-price` 为准，可领券仅作展示。
7. **`create-order` 到店场景必传 `takeWayCode`**：该值**不能猜**，必须先调 `calculate-price`，
   从返回的 `data.takeWayList[].code` 里取（实测为 `eat-in` 堂食 / `take-in-store` 外带）。
   本 Skill 把 `calculate-price` 与 `create-order` 串成一步，前端展示取餐方式选项后传入；
8. **下单是真实动作**：`create-order` 会在用户账户中生成未支付订单并返回支付链接。
   本 Skill 在前端做了**二次确认面板**（门店 / 取餐方式 / 套餐 / 应付金额），杜绝误触。

---

## 二、调用流程

```
用户输入（星座 / 心情 / 代码状态 / 预算）
        │
        ▼
[1] query-nearby-stores(beType=1, searchType=2, city, keyword)
        │        → storeCode / storeName / address
        ▼
[2] query-meals(storeCode, orderType=1, beType=1)
        │        → 125 个原始条目，过滤套餐/组合/卡券类后得到 ~54 个单品
        │          （名称 / 现价 / 原价 / 商品图）
        ▼
[3] list-nutrition-foods()
        │        → toon 格式 160 行营养表，按名称四级匹配挂到餐品上
        ▼
[4] available-coupons()  → 可领券列表（仅标题，用于展示）
        │
        ▼
[5] 确定性算法（lib/fate.js，纯标准库）
      · 按菜名推导风味标签 → 结合「心情 + 星座元素 + 代码状态」打分
      · 穷举 主食×小食×饮品（≈3600 组合），预算内取总分最高
      · 预算富余再追加一份甜点
        │
        ▼
[6] calculate-price(storeCode, items)   → 官方核价复核总价 + takeWayList（取餐方式）
        │
        ▼
输出：本命套餐卡（组合 / 热量 / 蛋白 / 官方核价 / 本命指数 / 运势解读）

—— 用户确认后，进入下单分支 ——

[7] 用户选择取餐方式（eat-in 堂食 / take-in-store 外带）
        │
        ▼
[8] create-order(storeCode, orderType=1, beType=1, takeWayCode, items)
        │        → 真实订单号 + 支付链接（用户麦当劳账户，未支付）
        ▼
[9] 用户支付 → query-order(orderId) 可核对订单状态
```

> 菜单在服务端缓存 10 分钟（`LIVE_TTL`），避免重复拉取；未配置 Token 或 MCP 调用失败时，
> 自动回退到 `data/mcd-menu.json` 快照，保证 Demo 永远能跑。

---

## 三、关键设计：MCP 负责“事实”，代码负责“算术”

麦当劳 MCP 把菜单、营养、优惠券都开放成了**原子接口**，但这些接口单独拎出来都很碎——
真正有价值的不是「调一次接口」，而是**把它们编排成一条用户愿意每天用的闭环**。

因此本 Skill 明确划分了职责边界：

- **MCP 提供事实**：这份菜单有什么、这道菜多少热量、我有哪些券；
- **代码负责算术**：在预算内怎么组、怎么叠券最便宜——**绝不用大模型猜价格**；
- **Agent 负责表达**：把冷冰冰的组合翻译成一句「人话」。

这样做的好处是：**任何一次推荐结果都可以被逐条核验**，价格和热量对得上官方数据。

---

## 四、脱敏与配置

生产配置见 `mcp-config.example.json`，**只用环境变量占位符，不硬编码任何密钥**：

```json
{
  "mcpServers": {
    "mcd-mcp": {
      "type": "streamablehttp",
      "url": "https://mcp.mcd.cn",
      "headers": { "Authorization": "Bearer ${MCD_MCP_TOKEN}" }
    }
  }
}
```

> ⚠️ 请勿把真实 Token 提交到仓库。`.gitignore` 已忽略 `.env`。

---

## 五、业务价值

1. **降低决策成本**：把「今天吃什么」从 5 分钟的选择困难压缩到 3 秒；
2. **提高券核销率**：把用户卡包里闲置的优惠券自动算进最优解，让券真正被用掉；
3. **营养透明**：给出每餐热量与蛋白质，服务有控卡需求的用户；
4. **可复现**：确定性算法保证同样输入得到同样结果，评测、复现、对账都没有歧义。
