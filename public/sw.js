/**
 * PaperMarker Service Worker
 *
 * 作用：
 *  1. 使网站成为可安装 PWA（添加到主屏幕/桌面）
 *  2. 安装后运行在 standalone 上下文，Chrome 允许局域网访问（PNA）
 *  3. 离线缓存核心资源（shell 策略）
 *
 * 注意：本 SW 不缓存 API 响应（API 需实时联网）。
 */

const CACHE = 'papermarker-v1'
const CORE_ASSETS = ['/', '/icon-192.png', '/icon-512.png', '/manifest.webmanifest']

// 安装：预缓存核心资源
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(CORE_ASSETS).catch(() => {}))
  )
  self.skipWaiting()
})

// 激活：清理旧缓存
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  )
  self.clients.claim()
})

// fetch 策略：
//  - 局域网请求（192.168/10./172.16-31/localhost）→ 直接放行，不缓存
//  - 同源导航请求 → 网络优先，失败回退缓存
//  - 同源静态资源 → 缓存优先
//  - 其他 → 直接放行
self.addEventListener('fetch', (event) => {
  const req = event.request
  const url = new URL(req.url)

  // 局域网请求：直接透传，不拦截（PNA 由 Chrome 处理权限）
  if (
    url.hostname.startsWith('192.168.') ||
    url.hostname.startsWith('10.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(url.hostname) ||
    url.hostname === 'localhost' ||
    url.hostname.endsWith('.local')
  ) {
    return // 不调用 respondWith，让浏览器直接处理
  }

  // 只处理同源 GET
  if (req.method !== 'GET' || url.origin !== self.location.origin) {
    return
  }

  // 导航请求：网络优先，失败回退缓存（离线可打开）
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {})
          return res
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('/')))
    )
    return
  }

  // 静态资源：缓存优先
  event.respondWith(
    caches.match(req).then(
      (cached) =>
        cached ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {})
          }
          return res
        })
    )
  )
})
