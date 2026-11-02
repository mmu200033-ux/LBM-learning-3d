# LBM 三维学习演示

## 单文件运行

双击 `release/LBM-learning-3d/LBM-learning-3d.exe` 即可运行，不需要 Node.js，也不需要同目录下的其他文件。

程序内置网页和 400 帧浓度缓存，启动时解压到系统临时目录并在本机随机端口启动静态服务器，自动打开浏览器。关闭控制台窗口即可停止服务。

## 网页发布包

`release/LBM-learning-3d/` 同时包含可单独部署的网页文件：`index.html`、`style.css`、`src/`、`vendor/`、`cache/`。

## 开发

```bash
node tools/serve.mjs          # 本地预览 http://127.0.0.1:8770/
node tools/precompute-recording.mjs   # 重新生成默认浓度缓存
node --test test              # 运行测试
```

## 说明

默认浓度回放使用预计算缓存，可立即拖动完整 400 帧时间轴。更改 seed 后，如果没有对应缓存，页面会回退到浏览器实时计算。
