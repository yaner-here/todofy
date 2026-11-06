import type { Operation, SqlRow, SqlValue } from "./database";

const CONFLICT = "todofy:crud-conflict";

export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Match Rust's Unicode White_Space trimming for existing data. */
export const trimWhitespace = (text: string) => text.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "");

export async function retry<T>(work: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      return await work();
    } catch (error) {
      const conflict = error === CONFLICT || (error instanceof Error && error.message === CONFLICT);
      if (!conflict || attempt === 9) throw error;
    }
  }
  throw new Error(CONFLICT);
}

export function check(statement: Operation["statement"], expected: SqlRow[], ...params: SqlValue[]): Operation {
  return { statement, params, expected };
}

/** SQLite BINARY compares UTF-8 bytes, whose order follows Unicode code points. */
export function compareText(a: string, b: string): number {
  if (a === b) return 0;
  if (!/[\uD800-\uDBFF]/.test(a) && !/[\uD800-\uDBFF]/.test(b)) return a < b ? -1 : 1;
  let left = 0, right = 0;
  while (left < a.length && right < b.length) {
    const first = a.codePointAt(left)!;
    const second = b.codePointAt(right)!;
    if (first !== second) return first < second ? -1 : 1;
    left += first > 0xffff ? 2 : 1;
    right += second > 0xffff ? 2 : 1;
  }
  return left < a.length ? 1 : right < b.length ? -1 : 0;
}
