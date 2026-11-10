// API の処理の結果。失敗したときは、HTTP の状態と、画面が文に直すための短い名前を返す
export type Result<T> = { ok: true, value: T } | { ok: false, status: number, error: string }

export function ok<T>(value: T): Result<T> {
  return { ok: true, value }
}

export function fail(status: number, error: string): { ok: false, status: number, error: string } {
  return { ok: false, status, error }
}
