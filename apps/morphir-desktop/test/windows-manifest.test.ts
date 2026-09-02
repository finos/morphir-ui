import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { NtExecutable, NtExecutableResource } from 'resedit'
import { DOMParser } from '@xmldom/xmldom'
import { enableLongPathsInExecutable } from '../scripts/windows-manifest.mjs'

const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <asmv3:application xmlns:asmv3="urn:schemas-microsoft-com:asm.v3">
    <asmv3:windowsSettings><dpiAware xmlns="http://schemas.microsoft.com/SMI/2005/WindowsSettings">true/pm</dpiAware></asmv3:windowsSettings>
  </asmv3:application>
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3"><security><requestedPrivileges><requestedExecutionLevel level="asInvoker" uiAccess="false"/></requestedPrivileges></security></trustInfo>
  <compatibility xmlns="urn:schemas-microsoft-com:compatibility.v1"><application><supportedOS Id="{8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a}"/></application></compatibility>
</assembly>`

function executableWithManifest(xml?: string): Uint8Array {
  const executable = NtExecutable.createEmpty(false)
  const resources = NtExecutableResource.from(executable)
  if (xml !== undefined) {
    resources.entries.push({
      type: 24,
      id: 1,
      lang: 1033,
      codepage: 65001,
      bin: new TextEncoder().encode(xml).buffer,
    })
  }
  resources.entries.push({
    type: 'INTEGRITY',
    id: 'ELECTRONASAR',
    lang: 1033,
    codepage: 65001,
    bin: new TextEncoder().encode('keep-asar-integrity').buffer,
  })
  resources.outputResource(executable)
  return new Uint8Array(executable.generate())
}

test('packaged executable opts into long paths without changing privilege, DPI, or ASAR resources', () => {
  const output = enableLongPathsInExecutable(executableWithManifest(manifest))
  const resources = NtExecutableResource.from(NtExecutable.from(output))
  const entry = resources.entries.find((entry) => entry.type === 24 && entry.id === 1)!
  const document = new DOMParser().parseFromString(new TextDecoder().decode(entry.bin), 'text/xml')
  const longPaths = document.getElementsByTagNameNS(
    'http://schemas.microsoft.com/SMI/2016/WindowsSettings',
    'longPathAware',
  )
  expect(longPaths.length).toBe(1)
  expect(longPaths.item(0)?.textContent).toBe('true')
  expect(
    document
      .getElementsByTagNameNS('urn:schemas-microsoft-com:asm.v3', 'requestedExecutionLevel')
      .item(0)
      ?.getAttribute('level'),
  ).toBe('asInvoker')
  expect(
    document
      .getElementsByTagNameNS('urn:schemas-microsoft-com:asm.v3', 'requestedExecutionLevel')
      .item(0)
      ?.getAttribute('uiAccess'),
  ).toBe('false')
  expect(
    document
      .getElementsByTagNameNS('http://schemas.microsoft.com/SMI/2005/WindowsSettings', 'dpiAware')
      .item(0)?.textContent,
  ).toBe('true/pm')
  expect(
    document.getElementsByTagNameNS('urn:schemas-microsoft-com:compatibility.v1', 'supportedOS')
      .length,
  ).toBe(1)
  const integrity = resources.entries.find((entry) => entry.type === 'INTEGRITY')!
  expect(new TextDecoder().decode(integrity.bin)).toBe('keep-asar-integrity')
  expect(enableLongPathsInExecutable(output)).toEqual(output)
})

test('fails the build when the executable has no application manifest', () => {
  expect(() => enableLongPathsInExecutable(executableWithManifest())).toThrow(
    'application manifest',
  )
})

test('enables an existing disabled declaration without duplicating it', () => {
  const xml = manifest.replace(
    '</asmv3:application>',
    '<asmv3:windowsSettings><longPathAware xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">false</longPathAware></asmv3:windowsSettings></asmv3:application>',
  )
  const resources = NtExecutableResource.from(
    NtExecutable.from(enableLongPathsInExecutable(executableWithManifest(xml))),
  )
  const entry = resources.entries.find((entry) => entry.type === 24 && entry.id === 1)!
  const document = new DOMParser().parseFromString(new TextDecoder().decode(entry.bin), 'text/xml')
  const declarations = document.getElementsByTagNameNS(
    'http://schemas.microsoft.com/SMI/2016/WindowsSettings',
    'longPathAware',
  )
  expect(declarations.length).toBe(1)
  expect(declarations.item(0)?.textContent).toBe('true')
})

test('rejects malformed XML instead of repairing an unknown manifest', () => {
  expect(() => enableLongPathsInExecutable(executableWithManifest('<assembly>'))).toThrow()
})

test('rejects an unexpected application namespace', () => {
  const xml = manifest.replaceAll('urn:schemas-microsoft-com:asm.v3', 'urn:unexpected')
  expect(() => enableLongPathsInExecutable(executableWithManifest(xml))).toThrow(
    'Expected one Windows manifest application',
  )
})

test('Windows manifest hook runs before signing', () => {
  const config = readFileSync(new URL('../electron-builder.yml', import.meta.url), 'utf8')
  expect(config).toContain('afterPack: ./scripts/windows-manifest.mjs')
  expect(config).not.toContain('afterSign: ./scripts/windows-manifest.mjs')
})
