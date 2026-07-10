// 가드용 env 로더 — dev는 .env.development.local(로컬 Supabase) 우선, 없으면 .env.local(운영)로 보충.
// 먼저 로드된 키가 우선(이미 설정된 키는 안 덮음 — 기존 `!process.env[...]` 패턴 유지, 순서만 dev 먼저).
// 각 가드의 "첫 import"로 둘 것: import 호이스팅 때문에 db 모듈 import보다 위에 있어야 주입이 db 연결보다 앞선다.
// 운영 DB를 명시적으로 겨냥하려면 실행 셸에서 DATABASE_URL을 오버라이드(이미 설정된 키는 안 덮으므로 그게 이긴다).
import { readFileSync } from 'fs';
import { join } from 'path';

for (const name of ['.env.development.local', '.env.local']) {
  try {
    for (const line of readFileSync(join(__dirname, '..', name), 'utf8').split('\n')) {
      const m = line.match(/^\s*(\w+)\s*=\s*"?([^"\n]*)"?\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch { /* 파일 없으면 통과(둘 다 없으면 db 기본값 → 연결 실패로 드러남) */ }
}
