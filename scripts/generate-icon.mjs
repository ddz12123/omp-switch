/**
 * 生成应用图标：黑底圆角方块 + 白色字母 O（黑白设计，深浅色主题均清晰）。
 * 纯 Node 实现（SDF + 超采样渲染 + 手写 PNG/ICO 编码），无第三方依赖。
 *
 * 产出：
 *   build/icon.png      1024x1024（electron-builder 主图标，可自动转 icns）
 *   build/icon.ico      16/24/32/48/64/128/256 多尺寸（Windows）
 *   resources/icon.png  256x256（运行时窗口/托盘图标）
 *
 * 用法：node scripts/generate-icon.mjs
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// ---------- 设计参数（单位坐标系 0~1） ----------
const RECT_HALF = 0.45 // 圆角方块半宽（5% 外边距）
const RECT_RADIUS = 0.2 // 圆角半径
const BORDER_W = 0.012 // 内侧描边宽度（深色任务栏上勾出轮廓）
const BORDER_ALPHA = 0.18
const O_MID_R = 0.21 // 字母 O 圆环中线半径
const O_HALF_T = 0.052 // 圆环半厚度（总厚度 ≈ 0.104，粗体）
const BG = 17 // 背景灰度 #111111
const FG = 255 // 字形白色

/** 圆角矩形 SDF（中心在原点） */
function sdRoundRect(px, py) {
  const qx = Math.abs(px) - (RECT_HALF - RECT_RADIUS)
  const qy = Math.abs(py) - (RECT_HALF - RECT_RADIUS)
  const ax = Math.max(qx, 0)
  const ay = Math.max(qy, 0)
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - RECT_RADIUS
}

/** 单个采样点颜色，返回 [r,g,b,a]（0~255） */
function sample(u, v) {
  const px = u - 0.5
  const py = v - 0.5
  const rect = sdRoundRect(px, py)
  if (rect >= 0) return [0, 0, 0, 0]

  let c = BG
  // 内侧淡白描边
  if (rect > -BORDER_W) {
    c = c + (FG - c) * BORDER_ALPHA
  }
  // 字母 O：圆环
  if (Math.abs(Math.hypot(px, py) - O_MID_R) - O_HALF_T < 0) {
    c = FG
  }
  return [c, c, c, 255]
}

/** 渲染 size x size RGBA 像素（超采样抗锯齿） */
function render(size) {
  const ss = size <= 64 ? 8 : 4
  const pixels = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const u = (x + (sx + 0.5) / ss) / size
          const v = (y + (sy + 0.5) / ss) / size
          const [cr, cg, cb, ca] = sample(u, v)
          // 预乘累加，避免透明边缘发黑
          r += cr * ca
          g += cg * ca
          b += cb * ca
          a += ca
        }
      }
      const n = ss * ss
      const idx = (y * size + x) * 4
      pixels[idx] = a > 0 ? Math.round(r / a) : 0
      pixels[idx + 1] = a > 0 ? Math.round(g / a) : 0
      pixels[idx + 2] = a > 0 ? Math.round(b / a) : 0
      pixels[idx + 3] = Math.round(a / n)
    }
  }
  return pixels
}

// ---------- PNG 编码 ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(pixels, size) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  // 每行前加 filter type 0
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

// ---------- ICO 编码（内嵌 PNG，Vista+ 支持） ----------
function encodeIco(sizes) {
  const pngs = sizes.map((s) => encodePng(render(s), s))
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(sizes.length, 4)

  const entries = []
  let offset = 6 + sizes.length * 16
  for (let i = 0; i < sizes.length; i++) {
    const e = Buffer.alloc(16)
    e[0] = sizes[i] >= 256 ? 0 : sizes[i]
    e[1] = sizes[i] >= 256 ? 0 : sizes[i]
    e.writeUInt16LE(1, 4) // planes
    e.writeUInt16LE(32, 6) // bpp
    e.writeUInt32LE(pngs[i].length, 8)
    e.writeUInt32LE(offset, 12)
    offset += pngs[i].length
    entries.push(e)
  }
  return Buffer.concat([header, ...entries, ...pngs])
}

// ---------- 输出 ----------
mkdirSync(join(root, 'build'), { recursive: true })
mkdirSync(join(root, 'resources'), { recursive: true })

writeFileSync(join(root, 'build', 'icon.png'), encodePng(render(1024), 1024))
writeFileSync(join(root, 'build', 'icon.ico'), encodeIco([16, 24, 32, 48, 64, 128, 256]))
writeFileSync(join(root, 'resources', 'icon.png'), encodePng(render(256), 256))

console.log('图标已生成：build/icon.png、build/icon.ico、resources/icon.png')
