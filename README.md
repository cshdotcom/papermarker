# PaperMarker — 试卷扫描 · AI 批改 · 一体机打印

<p align="center">
  <b>Next.js 16 全栈 + 原生 Android APP + 局域网打印/扫描一体机深度对接</b>
  <br/>
  <b>支持 Brother DCP-T428W 国行机（私有协议逆向）· 佳能 / 惠普等主流 IPP/eSCL 机型</b>
</p>

---

## 功能总览

| 模块 | 能力 |
|---|---|
| **登录门禁** | 账号密码登录（JWT），未登录无法访问任何页面与 API |
| **应用连接** | 网页端创建/停用/吊销 API Key，Android APP 用 `X-API-Key` 直连全部 API |
| **扫描采集** | 手机拍照（四角透视矫正）· eSCL/AirScan 网络扫描仪 · **Brother 54921 私有协议** |
| **AI 批改** | VLM 视觉大模型逐题判分（√ / × / 半对√上叉），题框 ROI 相对坐标定位 |
| **人工复核** | 图层开关（题框/标记/得分/答案）· 批注编辑 · 批量复核 |
| **PDF 导出** | 批注版 / **纯标记层（透明底可套印）** / 答案汇总 / 解析汇总，内嵌中文字体（思源黑体） |
| **打印下发** | IPP 通用（631）· **Brother 9100 直连 JPEG** · 失败自动降级浏览器打印 |
| **快速复印** | 托盘页面一键下发打印机（单/双面、份数） |
| **Android APP** | 原生 Kotlin/Java（零第三方依赖），拍照→裁切→上传→复核→打印全流程 |

## Brother DCP-T428W 逆向成果（合并自 [brother-dcp-t428w-scan-print](https://github.com/cshdotcom/brother-dcp-t428w-scan-print)）

国行 DCP-T428W **没有** AirPrint / Mopria / eSCL，官方只让装 iPrint&Scan。本项目把原厂 SDK（iPrint&Scan 6.14.2）字节码逆向出的私有协议直接合并进了服务端：

### 扫描（TCP 54921，真机已打通）
```
connect :54921 → 等 "+OK 200" → 直发 ESC X 帧 → 图像流（JPEG 块拼接）
帧格式：1B <cmd> 0A + "键=值\n" ASCII 正文 + 80
图像块头（10B）：[0]=0x64 JPEG / 0x82 页结束 / 0x80 全结束
                [1-2]=magic 0x0007 [3-4]=页码 [5]=0x84 [6-7]=进度 [8-9]=保留
                随后 2B 小端长度 + JPEG 负载
```
- 支持 100–600 dpi、灰度 CGRAY / 彩色 C256 / 黑白 TEXT、亮度对比度、平板/送稿器
- 实现在 `src/lib/brother-scan.ts`（Node `net` 原生 Socket，正确处理 TCP 粘包）
- 注意：**扫描会话独占**，扫描前请退出手机上的 iPrint&Scan APP

### 打印（TCP 9100 直连，实验路线）
```
PJL 头（@PJL ENTER LANGUAGE=JPEG）+ JPEG 字节 + UEL
```
- 批注/标记层由 `src/lib/mark-jpeg.ts`（sharp + SVG）直接渲染为高分辨率 JPEG 下发，无需 PDF 光栅化
- 文字版 PDF（答案/解析）自动降级为浏览器打印

## 快速开始

```bash
bun install
bun run db:push          # 初始化 SQLite
bun run dev              # http://localhost:3000
```

默认账号 `teacher` / `papermarker`（首次登录后请尽快修改数据库中的密码哈希）。

### 连接打印/扫描一体机

1. 进入 **设置** 页
2. 打印机：选 `IPP 通用`（佳能/惠普/兄弟海外版）或 `Brother 直连`（国行 DCP-T428W 等），填打印机 IP → 测试连接
3. 扫描仪：选 `eSCL 通用`（8095）或 `Brother 私有协议`（54921），填 IP → 测试握手
4. 保存后即可在扫描页直接取页、复核页一键打印

### 创建应用连接（Android APP）

1. 网页 **设置 → 应用连接（API Key）** → 输入应用名 → 创建
2. 复制 `pmk_` 开头的 Key（仅显示一次）
3. 打开 APP → 填服务器地址 → 点「改用 API Key 连接」→ 粘贴 Key → 连接

APP 也可以直接用账号密码登录。两种方式等效，API Key 可随时停用/吊销。

## Android APP

- 源码：`android-app/`（纯 Java + Android SDK 34，**无 Gradle、无第三方依赖**）
- 构建：`bash android-app/build.sh`（需要 aapt2 / javac / d8 / apksigner）
- 产物：`android-app/PaperMarker.apk`（v1.1，已含 API Key 连接）
- 网页端也可直接下载：首页 → 「下载 APK 安装包」

## 目录结构

```
├── src/lib/
│   ├── brother-scan.ts    # Brother 54921 扫描 + 9100 直连打印（逆向协议）
│   ├── scanner.ts         # eSCL/AirScan 通用扫描
│   ├── printer.ts         # IPP 打印
│   ├── mark-jpeg.ts       # 批注页 JPEG 渲染（Brother 打印用）
│   ├── pdf-render.ts      # 四类 PDF（批注/纯标记层/答案/解析，中文字体）
│   ├── auth.ts            # JWT + API Key 双通道鉴权
│   └── ai-gateway.ts      # VLM 批改网关
├── src/app/api/           # REST API（auth/tasks/upload/scan/print/apikeys…）
├── src/components/pm/     # 前端（登录/扫描/任务/复核/打印/设置）
├── prisma/schema.prisma   # User/Task/Annotation/File/ApiToken/打印扫描配置
├── android-app/           # 原生 Android APP 源码 + APK
└── assets/fonts/          # 思源黑体（PDF 中文渲染）
```

## API 鉴权方式

| 方式 | 用法 |
|---|---|
| JWT | 登录接口签发，`Authorization: Bearer <token>`（网页端） |
| API Key | 设置页创建，`X-API-Key: pmk_...` 或 `?apiKey=pmk_...`（APP / 第三方） |

所有 `/api/*` 业务接口同时接受两种凭据；文件下载支持 `?token=` / `?apiKey=` 查询参数。

## 致谢

- Brother 协议逆向：[cshdotcom/brother-dcp-t428w-scan-print](https://github.com/cshdotcom/brother-dcp-t428w-scan-print)（iPrint&Scan 6.14.2 字节码分析 + DCP-T428W 真机实测）
- 中文字体：[思源黑体 Noto Sans SC](https://github.com/notofonts/noto-cjk)（SIL OFL 1.1）

## License

MIT
