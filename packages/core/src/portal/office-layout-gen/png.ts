import { deflateSync, inflateSync } from "node:zlib"
import type { PngImage } from "./types.ts"

function crc32(data: Uint8Array) {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    c ^= data[i]!
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1
  }
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array) {
  const typeBytes = new TextEncoder().encode(type)
  const len = new Uint8Array(4)
  new DataView(len.buffer).setUint32(0, data.length)
  const body = new Uint8Array(4 + typeBytes.length + data.length + 4)
  body.set(len, 0)
  body.set(typeBytes, 4)
  body.set(data, 8)
  const crc = new Uint8Array(4)
  new DataView(crc.buffer).setUint32(0, crc32(body.subarray(4, 8 + data.length)))
  body.set(crc, 8 + data.length)
  return body
}

function paethPredictor(a: number, b: number, c: number) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  if (pb <= pc) return b
  return c
}

function unfilterRgba(raw: Uint8Array, width: number, height: number) {
  const bpp = 4
  const stride = width * bpp + 1
  const pixels = new Uint8Array(width * height * bpp)
  const row = new Uint8Array(width * bpp)
  const prev = new Uint8Array(width * bpp)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * stride]!
    const filt = raw.subarray(y * stride + 1, y * stride + 1 + width * bpp)
    for (let i = 0; i < row.length; i++) {
      const left = i >= bpp ? row[i - bpp]! : 0
      const up = prev[i]!
      const upLeft = i >= bpp ? prev[i - bpp]! : 0
      const f = filt[i]!
      const v =
        filter === 1
          ? (f + left) & 0xff
          : filter === 2
            ? (f + up) & 0xff
            : filter === 3
              ? (f + Math.floor((left + up) / 2)) & 0xff
              : filter === 4
                ? (f + paethPredictor(left, up, upLeft)) & 0xff
                : f
      row[i] = v
    }
    pixels.set(row, y * width * bpp)
    prev.set(row)
  }
  return pixels
}

export function readPng(bytes: Uint8Array): PngImage {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 8
  let width = 0
  let height = 0
  const idat: Uint8Array[] = []
  while (offset + 8 <= bytes.length) {
    const len = view.getUint32(offset)
    const type = String.fromCharCode(bytes[offset + 4]!, bytes[offset + 5]!, bytes[offset + 6]!, bytes[offset + 7]!)
    const data = bytes.subarray(offset + 8, offset + 8 + len)
    offset += 12 + len
    if (type === "IHDR") {
      width = view.getUint32(data.byteOffset)
      height = view.getUint32(data.byteOffset + 4)
    }
    if (type === "IDAT") idat.push(data)
    if (type === "IEND") break
  }
  const compressed = Buffer.concat(idat.map((part) => Buffer.from(part)))
  const raw = inflateSync(compressed)
  return { width, height, pixels: unfilterRgba(raw, width, height) }
}

export async function readPngFile(filePath: string) {
  return readPng(new Uint8Array(await Bun.file(filePath).arrayBuffer()))
}

export function pngSizeFromBytes(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

export function deskTileSize(assetsDir: string, texture: string) {
  const filePath = `${assetsDir}/${texture}`
  const file = Bun.file(filePath)
  if (!file.size) return [2, 2] as const
  return Bun.file(filePath)
    .arrayBuffer()
    .then((buf) => {
      const { width, height } = pngSizeFromBytes(new Uint8Array(buf))
      return [
        Math.max(1, Math.ceil(width / 32)),
        Math.max(1, Math.ceil(height / 32)),
      ] as const
    })
}

export function blit(dst: Uint8Array, dstW: number, x: number, y: number, src: PngImage) {
  for (let py = 0; py < src.height; py++) {
    for (let px = 0; px < src.width; px++) {
      const si = (py * src.width + px) * 4
      const alpha = src.pixels[si + 3]!
      if (alpha < 8) continue
      const di = ((y + py) * dstW + (x + px)) * 4
      if (alpha < 255) {
        const inv = 255 - alpha
        dst[di] = Math.round((src.pixels[si]! * alpha + dst[di]! * inv) / 255)
        dst[di + 1] = Math.round((src.pixels[si + 1]! * alpha + dst[di + 1]! * inv) / 255)
        dst[di + 2] = Math.round((src.pixels[si + 2]! * alpha + dst[di + 2]! * inv) / 255)
        dst[di + 3] = Math.max(alpha, dst[di + 3]!)
        continue
      }
      dst[di] = src.pixels[si]!
      dst[di + 1] = src.pixels[si + 1]!
      dst[di + 2] = src.pixels[si + 2]!
      dst[di + 3] = src.pixels[si + 3]!
    }
  }
}

export function writePng(filePath: string, width: number, height: number, pixels: Uint8Array) {
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = new Uint8Array(13)
  const view = new DataView(ihdr.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  ihdr[8] = 8
  ihdr[9] = 6
  const stride = width * 4 + 1
  const raw = new Uint8Array(stride * height)
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0
    raw.set(pixels.subarray(y * width * 4, (y + 1) * width * 4), y * stride + 1)
  }
  const parts = [
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array()),
  ]
  return Bun.write(filePath, Buffer.concat(parts.map((part) => Buffer.from(part))))
}

export function newCanvas(width: number, height: number, bg: [number, number, number, number]) {
  const pixels = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    pixels[i * 4] = bg[0]
    pixels[i * 4 + 1] = bg[1]
    pixels[i * 4 + 2] = bg[2]
    pixels[i * 4 + 3] = bg[3]
  }
  return { width, height, pixels } satisfies PngImage
}
