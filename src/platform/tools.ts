export type ToolId = 'tasks' | 'finance'

export type ToolDefinition = {
  readonly id: ToolId
  readonly name: string
  readonly href: `/${ToolId}`
  readonly description: string
  readonly icon: string
  readonly accent?: string
}

export const TOOLS: readonly ToolDefinition[] = [
  {
    id: 'tasks',
    name: '任務',
    href: '/tasks',
    description: '待辦、重複任務、習慣',
    icon: '☑',
  },
  {
    id: 'finance',
    name: 'finance',
    href: '/finance',
    description: '複式簿記記帳',
    icon: '¥',
  },
]

export function findToolByPathname(pathname: string): ToolDefinition | null {
  for (const tool of TOOLS) {
    if (pathname === tool.href || pathname.startsWith(`${tool.href}/`)) {
      return tool
    }
  }
  return null
}

export function toolLastUrlKey(toolId: ToolId): string {
  return `personal-tools:last-url:${toolId}`
}

export function isValidToolUrl(tool: ToolDefinition, url: string): boolean {
  return url === tool.href || url.startsWith(`${tool.href}/`) || url.startsWith(`${tool.href}?`)
}

export function resolveToolHref(tool: ToolDefinition, storedUrl: string | null | undefined): string {
  if (typeof storedUrl === 'string' && isValidToolUrl(tool, storedUrl)) {
    return storedUrl
  }
  return tool.href
}
