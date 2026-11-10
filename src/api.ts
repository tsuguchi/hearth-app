import { auth } from './firebase'

// Workers の API を、ログインの証明書を付けて呼ぶ
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string) {
    super(`API: ${status} ${code}`)
    this.status = status
    this.code = code
  }
}

export async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const user = auth.currentUser
  if (!user) throw new ApiError(401, 'unauthorized')
  const headers = new Headers(init.headers)
  headers.set('authorization', `Bearer ${await user.getIdToken()}`)
  if (typeof init.body === 'string') headers.set('content-type', 'application/json')
  let response: Response
  try {
    response = await fetch(path, { ...init, headers })
  } catch {
    throw new ApiError(0, 'network')
  }
  const data = await response.json().catch(() => ({})) as { error?: string }
  if (!response.ok) throw new ApiError(response.status, data.error ?? 'server_error')
  return data as T
}
