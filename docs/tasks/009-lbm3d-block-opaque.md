# 任务 009：局部块里碳和离聚物改回不透明

背景：`docs/design/lbm3d-cl.md`。基线是当前 HEAD（任务 005 + 006 + 007 + 008，提交 `0196435` + 待提交的 007 + 008）。

## 问题

用户截图显示时间步模式下，局部块（5×5×5）里的碳（深灰）和离聚物（蓝）变透明了，和周围真实结构里的不透明碳/离聚物不一致，导致看不清局部块的真实相位分布。

## 要做的

1. **找到局部块固相网格**：
   - `block-view.js` 里应该有创建局部块固相（碳、离聚物、铂）网格的代码
   - 检查这些网格的 `material.opacity` 和 `material.transparent`

2. **改回不透明**：
   - 碳、离聚物、铂的 `opacity` 改为 `1.0`
   - `transparent` 改为 `false`（或者保持 `true` 但 `opacity = 1.0`）
   - 确保局部块里的相位颜色和 `palette.js` 里定义的 `PHASE_COLOR` 一致

3. **验证**：
   - 打开 `http://localhost:8771?mode=step&t=300&sub=0`
   - 局部块里的碳、离聚物、铂是不透明的，和周围真实结构一致

## 允许改动的文件

- 修改：`lbm3d-cl/src/ui/block-view.js`（局部块固相网格的材质）
- 可选修改：`lbm3d-cl/src/ui/palette.js`（如果需要调整颜色常量）

**不改**：`src/engine/`、`src/ui/lattice-view.js`、`index.html`、`style.css`、`test/`、`docs/`。

## 验收

- 打开 `http://localhost:8771?mode=step&t=300&sub=0`
- 局部块里的碳、离聚物、铂是**不透明**的
- 颜色和周围真实结构一致（碳深灰、离聚物蓝、铂金色）
- `node --test lbm3d-cl/test` 的 6 项测试通过 5 项（预算测试失败是已知问题）
- `node --check lbm3d-cl/src/ui/block-view.js` 通过

## 提交

能提交就提交，信息 `[工程] lbm3d-cl 局部块固相改回不透明`；不能就在汇报里说明，由我提交。

## 汇报要回答

1. 改了哪里（哪个网格、材质的哪个属性）
2. 局部块固相是否不透明、颜色是否和真实结构一致
3. 测试是否通过
4. 推断清单、偏离说明、已知问题
