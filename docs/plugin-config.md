# 插件配置表单（pi.config.json）

Pi Web 的「设置 › 插件」为插件自己读的配置画一张表单。表单不是写死的：它由一个**描述文件**决定，描述文件声明「值存在哪里」和「每个键的类型、默认值、说明」。

## 描述文件放在哪

按优先级从高到低查找，命中第一个就停止：

| 顺序 | 路径 | 谁维护 |
| --- | --- | --- |
| 1 | `<插件包目录>/pi.config.json` | 插件作者（随版本发布） |
| 2 | `~/.pi/agent/plugin-configs/<npm 包名>.json` | 你 |
| 3 | `<Pi Web 安装目录>/plugin-configs/<npm 包名>.json` | Pi Web 自带的第三方配置库 |

- 只对**已配置的 npm/git 插件包**生效；包名取自 `npm:<name>`（钉版本号无妨）。
- 找到但解析失败的文件会**中止**查找并在页脚报一条诊断（文件名 + 原因），不会悄悄退到下一层去写别的键。
- 描述文件本身只决定「画什么、写哪里」，不会被执行。

Pi Web 自带三个：`pi-image-slim`、`pi-condense`、`visual-explainer`。

## 描述文件长什么样

```jsonc
{
  "storage": {
    "type": "file",                 // 或 "settings"
    "file": "pi-image-slim.json",   // 文件名，不能带路径
    "locations": ["global", "project"]   // 可选；默认两层都读
  },
  "fields": [
    {
      "key": "quality",
      "type": "integer",            // boolean | integer | number | string | enum | strings
      "default": 75,
      "min": 0,
      "max": 100,
      "control": "slider",          // 可选；按类型推断：switch / number / text / select / list
      "unit": "ms",                 // 可选：数值后面显示的单位
      "label": { "en": "WebP quality", "zh-CN": "WebP 质量" },
      "description": {
        "en": "0 saves the most bandwidth, 100 keeps the most detail.",
        "zh-CN": "0 最省流量，100 保留最多细节。"
      }
    }
  ]
}
```

`label` / `description` 可以直接写一个字符串（当作英文），也可以按语言给一份映射；界面按当前语言取，缺失时依次退回基语言（`zh-TW` → `zh`）、英文、第一个。

### 两种取值位置

| `storage` | 值写在哪里 |
| --- | --- |
| `{ "type": "file", "file": "x.json" }` | 全局：`<agent 目录>/x.json`；项目：`<项目>/.pi/x.json` |
| `{ "type": "settings", "namespace": "contextPrune" }` | pi 的 `settings.json` 里该命名空间（全局 `<agent 目录>/settings.json`，项目 `<项目>/.pi/settings.json`） |

`settings` 只改写声明的命名空间，pi 自己的键和其他插件的键原样保留；命名空间被清空后整个键会删掉。

### 字段属性

| 属性 | 说明 |
| --- | --- |
| `key` | 键名；支持点路径（`chainCompression.enabled`）写入嵌套对象 |
| `type` | `boolean` / `integer` / `number` / `string` / `enum` / `strings`（字符串数组） |
| `default` | 必填；插件在没人设置时用的值。`nullable: true` 时可为 `null` |
| `nullable` | 允许 `null`：表单里留空就写 `null` |
| `min` / `max` | 数值范围（含端点）；超出范围的值插件会忽略，表单也会拦住 |
| `step` | 滑块步长，默认 1 |
| `maxLength` | 字符串长度上限 |
| `options` | 仅 `enum`：`[{ "value": "turn", "label": { "en": "Per turn", "zh-CN": "按回合" } }]` |
| `dependsOn` | 仅在该键等于某值时才有意义，界面显示一行提示：`{ "key": "strip", "equals": true }` |

## 值怎么读、怎么写

插件自己也是分层读的（默认值 → 全局 → 项目），表单照这个顺序显示：

- 每一行显示**实际生效的值**，并标出来源：`默认` / `继承全局`，本层自己设置的不标。
- 项目没写的键显示全局的值，改全局后再切到项目，看到的就是新值。
- 保存只写**本层标为已设置的键**：改一行 = 在本层建一个覆盖；「恢复继承」把它删掉，让这一行重新跟随上一层；「清除本层设置」一次删掉本层所有键。
- 值按描述里的类型/范围/枚举在服务端再校验一次；未知键拒写；解析不了的 JSON 拒写并显示原因（不会覆盖用户还要手工修的文件）。
- 项目层写入要求信任该项目。

## 加一个插件

1. 找到插件**真正读取**的配置位置（它的 README / 源码里的 `readFileSync`、`getSettings()`）。
2. 在 `plugin-configs/<npm 包名>.json` 写一份描述（或放进插件包里做 `pi.config.json`）。
3. 打开「设置 › 插件」，选中它，表单就在「已解析资源」下面。

插件没有描述文件时不会显示表单——Pi Web 不会去猜一个它不认识的格式。
