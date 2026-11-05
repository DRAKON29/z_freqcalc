/** Конфигурация доступа к Python-сервису (ТЗ 3.1, 6.3). */
export function apiBase(): string {
  return process.env.NEXT_PUBLIC_API_BASE ?? '/api'
}

/** Порт мини-сервиса для шлюза песочницы (XTransformPort). */
export function apiPortQuery(): string {
  const port = process.env.NEXT_PUBLIC_API_PORT
  return port ? `?XTransformPort=${port}` : ''
}

export function apiUrl(path: string): string {
  return `${apiBase()}${path}${apiPortQuery()}`
}
