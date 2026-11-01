# 任务 008：相机自由旋转整个场景

背景：`docs/design/lbm3d-cl.md`。基线是当前 HEAD（任务 005 + 006 + 007，提交 `0196435` + 待提交的 007）。

## 问题

当前三维格点视角的相机始终围绕局部块（5×5×5）旋转，轨道控制器（OrbitControls）的 `target` 锁定在块中心。用户希望相机可以自由旋转整个场景，看到真实结构的全貌。

## 要做的

1. **改相机目标**：
   - `lattice-view.js` 里创建 OrbitControls 时，把 `target` 从局部块中心改为**整个结构的中心**（`L/2, H/2, W/2` 在世界坐标系里的位置）
   - 或者让用户可以拖动改变 target（右键拖动平移场景）

2. **初始相机位置**：
   - 调整 `camera.position` 让整个结构（真实结构 + 局部块）都在视野内
   - 建议从 `(L*1.5, H*1.5, W*2)` 或类似位置看向中心

3. **验证**：
   - 打开 `http://localhost:8771?mode=step&t=300&sub=0`，拖动鼠标旋转场景
   - 相机围绕整个结构旋转，而不是只围绕小块

## 允许改动的文件

- 修改：`lbm3d-cl/src/ui/lattice-view.js`（OrbitControls 的 target、camera 初始位置）
- 可选修改：`lbm3d-cl/src/ui/stage.js`（如果 target 在那里设置）

**不改**：`src/engine/`、`src/ui/block-view.js`、`index.html`、`style.css`、`test/`、`docs/`。

## 验收

- 打开 `http://localhost:8771?mode=step&t=300&sub=0`
- 拖动鼠标旋转场景，相机围绕整个结构（不只是小块）旋转
- 整个真实结构和局部块都在视野内
- `node --test lbm3d-cl/test` 的 6 项测试通过 5 项（预算测试失败是已知问题）
- `node --check lbm3d-cl/src/ui/lattice-view.js` 通过

## 提交

能提交就提交，信息 `[工程] lbm3d-cl 相机自由旋转整个场景`；不能就在汇报里说明，由我提交。

## 汇报要回答

1. 改了哪里（target 位置、camera 初始位置）
2. 相机是否围绕整个结构旋转
3. 测试是否通过
4. 推断清单、偏离说明、已知问题
