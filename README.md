# 一键复活（dsh-fuhuobi）

> 给自己制造一个复活币——备份一次，永远不慌。

```
复活币×1
插件安装前铸就的备用火焰。
当一切崩塌之际，双击此物，余烬复燃。
（一键恢复上一次成功启动的状态）
```

插件安装搞崩了？启动坏了？不怕，只要有复活币就能一键恢复原状。

每次成功启动后自动存一枚复活币（配置快照），遇到问题双击复活币，DSH 立刻回到上一次成功启动的正常状态。

## 快速开始

```sh
# 从 GitHub 安装
dsh plugin --profile web add github:q862877400-ux/dsh-fuhuobi

# 或从 npm 安装
dsh plugin --profile web add dsh-fuhuobi
```

重启 `dsh web`。这是标准 **bundle 插件**：加入 profile 层栈自动生效。

**强烈推荐用守护启动**（`scripts/boot-guard.ps1` Windows / `scripts/boot-guard.sh` macOS/Linux）替代直接启动——只有守护启动才会自动存复活币。

## 复活币机制

### 三级旋转

```
成功启动 #1 → 存快照 A → 复活币 = A
成功启动 #2 → 存快照 B → 复活币 = B，A 变为「前次备份」
成功启动 #3 → 存快照 C → 复活币 = C，B 变为「前次备份」，删除 A
```

永远保持：**1 枚当前复活币 + 1 份前次备份**，最多 2 份复活币专用快照。

### 什么时候自动存复活币

| 时机 | 说明 |
|------|------|
| ✅ 成功启动 | boot-guard 两阶段健康检查（HTTP 通 + 客户端渲染确认）通过后自动存 |
| ✅ 手动 | Web 界面「复活币口袋」页或 `dsh-fuhuobi revive-coin --mark` |
| ⚡ 插件安装前 | 自动快照（标签 auto-before-install），防手滑装崩 |

### 怎么复活

| 崩溃场景 | 恢复方式 |
|---------|---------|
| 网页能打开但黑屏 | 🔥 全屏复活界面，点「使用复活币」自动回滚并刷新（右上角 ✕ 可关闭） |
| 网页能打开、有报错界面 | 右下角提示「双击桌面 DSH复活币X1 即可恢复」（不遮挡报错） |
| 网页打不开（服务端挂了） | CLI 提示：双击桌面/根目录的 DSH复活币X1，或 `dsh-fuhuobi revive-coin` |
| 以上都覆盖不到 | 📁 桌面/DSH 根目录的 `DSH复活币X1.cmd`，双击即恢复 |

`DSH复活币X1.cmd` 会自动创建在 `$DSH_HOME/` 根目录，桌面也会放一个快捷方式（无桌面权限时根目录那份始终存在）。

## 命令

```
dsh-fuhuobi snapshot [--profile X] [--tag T] [--reason R] [--force]   手动快照
dsh-fuhuobi list     [--profile X]                                     列出快照
dsh-fuhuobi rollback [--profile X] [--id I | --good] [--skip-install]  回滚到指定/最近良好快照
dsh-fuhuobi keep     [N]                                               查看或设置保留快照数(最少 2)
dsh-fuhuobi health   [--port N]                                        检查后端健康状态
dsh-fuhuobi incident [--kind K] [--no-marker]                          生成事故定位报告
dsh-fuhuobi resolve                                                   标记待处理事故为已解决
dsh-fuhuobi revive-coin [--profile X] [--mark]                         查看/手动存复活币
dsh-fuhuobi revive-coin --use                                         用当前复活币恢复（DSH复活币X1.cmd 双击调用）
dsh-fuhuobi quarantine --diagnose                                     从启动日志识别导致失败的问题插件
dsh-fuhuobi quarantine --plugin <id> [--undo]                         隔离(禁用) / 恢复一个插件
dsh-fuhuobi quarantine --list                                         列出已隔离插件
dsh-fuhuobi profiles                                                  列出所有 profile
```

## 在 DSH Web 界面中使用

打开 **设置 → 复活币口袋**：

- 查看每个环境（profile）的快照与当前复活币/前次备份
- 点「用此复活币复活」恢复指定快照
- 点「＋ 手动存币」手动存一枚复活币
- 设置每个环境保留的快照数量（最少 2）

## 配置

`$DSH_HOME/guard/config.json`（首次写入时自动创建，全部可选）：

```json
{
  "keepSnapshots": 10,
  "port": 3080
}
```

所有路径锚定 `$DSH_HOME`（默认 `~/.dsh`）：

```
$DSH_HOME/rollbacks/<profile>/<stamp>/   快照（5 个配置文件 + manifest.json）
$DSH_HOME/guard/logs/                    启动/服务器日志、事故报告
$DSH_HOME/guard/pending-incident.json    待处理事故标记
$DSH_HOME/guard/revive-coin.json         复活币状态（当前 + 前次）
$DSH_HOME/DSH复活币X1.cmd                一键复活脚本（双击即用）
```

## 回滚语义

- 回滚 = 恢复 5 个配置文件 + `pnpm install --frozen-lockfile` 精确还原 node_modules。
- 每次回滚前自动先存一份 `pre-rollback` 快照：**回滚本身可逆**。
- "最后良好" = 最新的非 `pre-boot`/`pre-rollback` 标签快照。

## 安全说明

- 本插件只读写 profile 配置文件与快照，不执行第三方代码。
- 快照与事故报告是本地文件，不含凭据。
- 自动回滚只发生在"启动健康检查失败"时，运行期不会随意改动配置。

## 平台支持

| 组件 | Windows | macOS/Linux |
|------|---------|-------------|
| 插件（工具/钩子/提示注入） | ✅ | ✅ |
| dsh-fuhuobi CLI | ✅ | ✅ |
| 守护启动脚本 | PowerShell | bash |
| 桌面快捷方式 | ✅ 自动 | 手动（提示拖到桌面） |

## 开发

```sh
node scripts/smoke-test.js    # 引擎冒烟测试（临时 DSH_HOME，无副作用）
node scripts/guard-cli.js help
```

## 发布

MIT 许可。零运行时依赖，`prepublishOnly` 每次发布前自动跑冒烟测试。

```sh
npm publish
```

## License

MIT
