// DB 클라이언트 싱글턴 — Next dev의 HMR이 매번 새 풀을 열지 않게 globalThis에 캐시.
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://volleyball:volleyball@localhost:5432/volleyball';

const g = globalThis as unknown as { __pg?: ReturnType<typeof postgres> };
// prepare:false — Supabase Transaction 풀러(:6543, PgBouncer transaction 모드)는 prepared statement 미지원이라
// 필수(BACKEND_SYSTEM §13.7). Direct/Session 연결에서도 무해하므로 무조건 켠다(항상 안전한 기본값).
const client = g.__pg ?? postgres(DATABASE_URL, { max: 10, prepare: false });
if (process.env.NODE_ENV !== 'production') g.__pg = client;

export const db = drizzle(client, { schema });
export { schema };
