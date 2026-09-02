// @ts-check

import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { TextDecoder, TextEncoder } from 'node:util'
import { NtExecutable, NtExecutableResource } from 'resedit'
import { DOMParser, XMLSerializer, onErrorStopParsing } from '@xmldom/xmldom'

const applicationNamespace = 'urn:schemas-microsoft-com:asm.v3'
const longPathNamespace = 'http://schemas.microsoft.com/SMI/2016/WindowsSettings'

/** @param {Uint8Array} bytes */
export function enableLongPathsInExecutable(bytes) {
  const executable = NtExecutable.from(bytes)
  const resources = NtExecutableResource.from(executable)
  const manifests = resources.entries.filter((entry) => entry.type === 24 && entry.id === 1)
  if (manifests.length === 0) throw new Error('Executable has no application manifest')
  let changed = false
  for (const manifest of manifests) {
    const document = new DOMParser({ onError: onErrorStopParsing }).parseFromString(
      new TextDecoder('utf-8', { fatal: true }).decode(manifest.bin),
      'text/xml',
    )
    const applications = document.getElementsByTagNameNS(applicationNamespace, 'application')
    if (applications.length !== 1) throw new Error('Expected one Windows manifest application')
    const application = applications.item(0)
    if (!application) throw new Error('Missing Windows manifest application')
    const declarations = application.getElementsByTagNameNS(longPathNamespace, 'longPathAware')
    if (declarations.length > 1) throw new Error('Duplicate longPathAware declarations')
    const existing = declarations.item(0)
    if (existing?.textContent === 'true') continue
    if (existing) {
      existing.textContent = 'true'
    } else {
      const settings = document.createElementNS(applicationNamespace, 'windowsSettings')
      const declaration = document.createElementNS(longPathNamespace, 'longPathAware')
      declaration.textContent = 'true'
      settings.appendChild(declaration)
      application.appendChild(settings)
    }
    manifest.bin = new TextEncoder().encode(new XMLSerializer().serializeToString(document)).buffer
    changed = true
  }
  if (!changed) return bytes
  resources.outputResource(executable)
  return new Uint8Array(executable.generate())
}

/** @param {import('electron-builder').AfterPackContext} context */
export default async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return
  const executable = join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`)
  // afterPack runs before signing. Preserve all other resources, including ASAR integrity.
  await writeFile(executable, enableLongPathsInExecutable(await readFile(executable)))
}
