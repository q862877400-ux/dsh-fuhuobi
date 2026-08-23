# dsh-bie-beng · 插件别崩！！

> 装了个新插件，重启又崩了！
> 又得把报错信息复制给网页版 DeepSeek 让它当侦探？
> **让老夫代劳吧** —— 装前自动快照、崩了自动回滚、桌面一键救回，坏插件直接关小黑屋。

---

## 这玩意儿是干啥的

DSH 装插件翻车，轻则报错，重则整个起不来。这插件就是给你的 DSH 装了个**安全气囊**：

    装插件（任意方式）
      │  装之前自动拍照留底（快照）—— 不拦你装，就是留一手
      ▼
    重启 DSH
      │  启动自动体检：起没起来？页面渲染没？
      ├─ 正常 ──────► 啥事没有，继续用
      └─ 崩了 ──────► 自动回滚到上次能用的状态 → 再试一次
                     ├─ 还不行 → 自动揪出坏插件关进小黑屋（隔离）→ DSH 正常启动
                     └─ 事故自动写成报告 → 下次打开让 AI 帮你分析
      │
      └─ 更狠的情况：DSH 都起不来了 → 双击桌面「DSH 插件回滚」按钮，一键救回

## 亮点（就这么直接）

- 🛡️ **装前自动快照**：plugin_install / uninstall / toggle 一触发，先把所有 profile 的关键配置拍照留底
- 🔄 **崩了自动回滚**：启动体检不过，自动还原到最近一次好状态并重试
- 🕶️ **坏插件关小黑屋**：回滚也救不回来？从启动日志揪出罪魁祸首，disabled 隔离，DSH 照常开
- 🖥️ **桌面一键救回**：桌面生成固定名回滚按钮，**DSH 崩不崩都能双击用**
- 📋 **事故自动写报告**：崩了自动记录现场（日志+配置差异），下次会话 AI 直接上手分析
- 🗃️ **快照不泛滥**：每个 profile 保留最近 N 份（默认 10），旧的自动清

## 快速上手

    # 方式一：从本仓库（GitHub）
    dsh plugin --profile web add github:q862877400-ux/dsh-bie-beng

    # 方式二：从 npm（发布后）
    dsh plugin --profile web add dsh-bie-beng

重启 dsh web 生效。

**强烈建议**：用 scripts/boot-guard.ps1（Windows）或 scripts/boot-guard.sh 启动 DSH，自动体检 + 自动回滚才有意义。

### 生成桌面回滚按钮（本 fork 新增）

    node scripts/install-with-desktop-button.mjs --profile web
    # 可选参数：--pkg <spec> 先装 guard；--desktop <目录> 指定按钮位置；--remove-button 删按钮

桌面上会出现一个「**DSH 插件回滚**」按钮（固定名，只有一个，覆盖式更新）。
**双击它 = 还原最近一次好快照 + 重建依赖**，DSH 崩没崩都能用，恢复逻辑全在按钮里，不依赖 DSH 进程。

## 功能细节

| 能力 | 说明 |
| --- | --- |
| 安装前快照 | plugin_install / uninstall / toggle 工具触发前自动快照所有 profile（从不拒绝安装） |
| 守护启动 | boot-guard：启动前快照 → 健康检查（含 Web 渲染级检测，黑屏也算崩）→ 失败自动回滚重试一次 |
| 坏插件隔离 | 回滚与重试都失败时，从启动日志诊断坏插件 → 追加 disabled: true 隔离 → 报告被拉出的插件 |
| 一键回滚 | rollback.cmd（Windows）/ CLI dsh-guard rollback --good，DSH 崩溃时也可用 |
| 桌面按钮 | 本 fork 新增：install-with-desktop-button.mjs 自动生成桌面固定名回滚按钮 |
| 事故分析 | 启动失败自动写 incident 报告 + pending 标记，下次会话自动聚焦诊断 |
| 快照保留 | 每 profile 保留最近 N 个（默认 10，可设 2–100），自动清理旧快照 |

## 配置

    $DSH_HOME/guard/config.json（可选）：

    { "keepSnapshots": 10, "port": 3080 }

## 使用

- **Web 设置 → 备份管理**：查看/创建快照、设置保留数量
- **Agent 工具**：dsh_snapshot / dsh_rollback / incident_resolved
- **CLI**（DSH 故障时可用）：dsh-guard snapshot|list|rollback|keep|health|incident|resolve|profiles

## 和上游的关系

本仓库 fork 自 [lxzy-7/dsh-plugin-guard](https://github.com/lxzy-7/dsh-plugin-guard)（MIT）。
上游是本体，我们做了三件事：

1. 改了名、换了中文俏皮首页（就是你现在看的这份）
2. 新增桌面回滚按钮自动生成脚本 scripts/install-with-desktop-button.mjs
3. 事故提示文案中文化

引擎逻辑（快照/回滚/守护/隔离/事故报告）与上游一致，上游更新时拉过来合并即可。

## 许可证

MIT
