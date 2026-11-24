import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { checkIconPng, loadAppIcon } from './icon'

// 只有檔頭的假 PNG:簽章 + IHDR 的長度、類型、寬、高,夠 checkIconPng 判斷
function fakePng(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0)
  bytes.writeUInt32BE(13, 8)
  bytes.write('IHDR', 12, 'ascii')
  bytes.writeUInt32BE(width, 16)
  bytes.writeUInt32BE(height, 20)
  return bytes
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'icon-test-'))
  const defaultPath = join(dir, 'default.png')
  const customPath = join(dir, 'custom.png')
  writeFileSync(defaultPath, fakePng(512, 512))
  return { dir, defaultPath, customPath }
}

describe('platform/icon', () => {
  it('accepts a square PNG at or above the minimum size', () => {
    assert.deepEqual(checkIconPng(fakePng(180, 180)), { ok: true })
    assert.deepEqual(checkIconPng(fakePng(1024, 1024)), { ok: true })
  })

  it('rejects non-PNG, non-square and too-small images with a reason', () => {
    assert.deepEqual(checkIconPng(Buffer.from('not an image')), { ok: false, reason: 'not a PNG file' })
    assert.deepEqual(checkIconPng(fakePng(300, 200)), { ok: false, reason: 'not square (300x200)' })
    assert.deepEqual(checkIconPng(fakePng(64, 64)), {
      ok: false,
      reason: 'too small (64x64, minimum 180x180)',
    })
  })

  it('uses the custom icon when it is valid', () => {
    const { customPath, defaultPath } = setup()
    writeFileSync(customPath, fakePng(256, 256))
    const icon = loadAppIcon(customPath, defaultPath)
    assert.equal(icon.source, 'custom')
    assert.equal(icon.fallbackReason, undefined)
    assert.equal(icon.bytes.readUInt32BE(16), 256)
  })

  it('falls back to the default without a reason when there is no custom icon', () => {
    const { customPath, defaultPath } = setup()
    const icon = loadAppIcon(customPath, defaultPath)
    assert.equal(icon.source, 'default')
    assert.equal(icon.fallbackReason, undefined)
  })

  it('falls back to the default with a reason when the custom icon is invalid or unreadable', () => {
    const { dir, customPath, defaultPath } = setup()
    writeFileSync(customPath, fakePng(300, 200))
    const invalid = loadAppIcon(customPath, defaultPath)
    assert.equal(invalid.source, 'default')
    assert.match(invalid.fallbackReason ?? '', /not square/)

    const directory = join(dir, 'is-a-directory.png')
    mkdirSync(directory)
    const unreadable = loadAppIcon(directory, defaultPath)
    assert.equal(unreadable.source, 'default')
    assert.match(unreadable.fallbackReason ?? '', /cannot read/)
  })

  it('throws when the default icon itself is missing', () => {
    const { dir, customPath } = setup()
    assert.throws(() => loadAppIcon(customPath, join(dir, 'missing-default.png')))
  })
})
