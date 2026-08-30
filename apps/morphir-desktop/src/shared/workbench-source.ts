import { unsupportedProviderError } from '@morphir/ui/workbench'
import type { WorkbenchSourceRef } from '@morphir/workspace'

export const desktopSourceRef = (locator: string): WorkbenchSourceRef => ({
  providerId: 'desktop-local',
  locator,
  displayName:
    locator
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .at(-1) || locator,
})

export const requireDesktopSourceRef = (value: unknown): WorkbenchSourceRef => {
  if (
    typeof value !== 'object' ||
    value === null ||
    typeof (value as Partial<WorkbenchSourceRef>).providerId !== 'string' ||
    typeof (value as Partial<WorkbenchSourceRef>).locator !== 'string' ||
    typeof (value as Partial<WorkbenchSourceRef>).displayName !== 'string'
  ) {
    throw new Error('Qualified Workbench source is required')
  }
  const source = value as WorkbenchSourceRef
  if (source.providerId !== 'desktop-local') {
    throw unsupportedProviderError('desktop-local', source)
  }
  return source
}
