# Bambu Lab Monitor / 拓竹打印监控台

## 中文说明

这是一个用于在局域网中监控和控制 Bambu Lab 打印机的本地 Web 应用。它提供打印状态、温度、耗材、事件记录、远程控制和实时视频查看能力；内置相机会自动在标准视频通道和 Bambu 6000 图像通道之间选择可用连接。

### 主要功能

- 查看打印状态、进度、温度、风扇、灯光、耗材和 HMS 信息。
- 发送暂停、继续、停止、速度、灯光、录像和延时摄影命令。
- 查看内置相机或外部相机视频流。
- 保存运行历史和事件日志。
- 可选配置 Webhook，把重要事件推送到外部服务。

### 使用前准备

- Node.js 和 pnpm。
- 打印机与运行本项目的电脑在同一局域网内。
- 打印机的 IP 地址、序列号和 LAN 访问码。
- 如需内置相机视频，请在打印机上启用局域网视频或 Liveview 相关开关。

### 安装与运行

```bash
pnpm install
pnpm dev
```

默认开发服务会启动前端和后端。打开终端输出中的本地地址即可访问页面。

### 配置打印机

1. 打开页面后点击右上角的连接配置按钮。
2. 填写打印机名称、IP/Host、端口、序列号和访问码。
3. 默认控制端口通常为 `8883`。
4. 保存后可选择立即连接。
5. 在监控设置中可启用或关闭视频、选择内置/外部相机、配置 Webhook 和历史保留天数。

### 构建与校验

```bash
pnpm test
pnpm typecheck
pnpm build
```

构建产物会输出到 `dist/`，后端编译产物会输出到 `server-dist/`。

## English

This is a local web app for monitoring and controlling Bambu Lab printers on your LAN. It shows print status, temperatures, filament, event logs, remote controls, and live camera video. The built-in camera path automatically chooses between the standard video channel and the Bambu 6000 image channel when available.

### Features

- View print state, progress, temperatures, fans, lights, filament, and HMS messages.
- Send pause, resume, stop, speed, light, recording, and timelapse commands.
- Watch the built-in camera or an external camera stream.
- Keep local history samples and event logs.
- Optionally send important events to an external service with Webhook.

### Requirements

- Node.js and pnpm.
- The printer and this app must be on the same local network.
- Printer IP address, serial number, and LAN access code.
- For built-in camera video, enable the printer's LAN video or Liveview setting.

### Install And Run

```bash
pnpm install
pnpm dev
```

The dev command starts both the frontend and backend. Open the local URL printed in the terminal.

### Printer Setup

1. Open the app and click the connection settings button in the top-right corner.
2. Enter printer name, IP/Host, port, serial number, and access code.
3. The default control port is usually `8883`.
4. Save and optionally connect immediately.
5. In monitor settings, you can enable video, choose built-in or external camera, configure Webhook, and set history retention days.

### Build And Verify

```bash
pnpm test
pnpm typecheck
pnpm build
```

Frontend build output goes to `dist/`; backend build output goes to `server-dist/`.
