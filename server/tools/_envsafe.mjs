// env 파일에서 시크릿을 "절대 밖으로 새지 않게" 읽는 공용 로더.
//
// 왜 존재하나 (2026-08-07, 같은 사고 3회):
//   ① `set -a && . ./.env.staging` — 쉘 파서가 실패하면 **그 줄 전체를 stderr로 뱉는다**(비밀번호 포함).
//   ② 인라인 주석(` # TODO...`)을 값으로 흡수 → URL 인코딩되어 박제 + 파싱 실패 → 에러에 노출.
//   ③ 값이 `"..."`로 감싸져 있는데 따옴표를 안 벗김 → `new URL()` 실패 → **에러 메시지가 input 전체를 출력**.
//   셋 다 "임시 스크립트를 매번 새로 짜다가 방어를 빠뜨림"이 근인이다. 그래서 방어를 한 곳에 모은다.
//
// 규칙: env 값을 다루는 스크립트는 반드시 이 모듈을 쓴다. 직접 정규식으로 파싱하지 말 것.
import fs from 'fs';
import crypto from 'crypto';

/** env 파일 → Map. 인라인 주석 분리 + 따옴표 제거를 항상 수행한다. */
export function readEnv(path) {
  const map = new Map();
  if (!fs.existsSync(path)) return map;
  for (const line of fs.readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2];
    const c = v.match(/(\s+#.*)$/); // 인라인 주석
    if (c) v = v.slice(0, c.index);
    v = v.trim().replace(/^(["'])([\s\S]*)\1$/, '$2'); // 감싼 따옴표 제거
    map.set(m[1], v);
  }
  return map;
}

/**
 * 시크릿을 쓰는 작업을 안전하게 실행한다.
 * fn(secret) 안에서 어떤 예외가 나도 **원문이 섞일 수 있는 에러 메시지를 밖으로 내보내지 않는다** —
 * 에러 코드/이름만 남긴다. 이것이 ③번 사고의 직접적 봉인.
 */
export async function withSecret(secret, fn) {
  if (!secret) return { ok: false, reason: 'missing' };
  try {
    return { ok: true, value: await fn(secret) };
  } catch (e) {
    // e.message에 URL/DSN 원문이 실릴 수 있으므로 절대 통과시키지 않는다.
    return { ok: false, reason: `${e?.code ?? e?.name ?? 'error'}` };
  }
}

/** 값 자체 대신 비교용 지문. 로그·문서·채팅에 남겨도 안전하다. */
export const fp = (v) =>
  v ? crypto.createHash('sha256').update(v).digest('hex').slice(0, 12) : '(empty)';

/** URL에서 호스트만 뽑아 지문화(= /api/health의 dbRef와 같은 값). 실패해도 원문을 안 흘린다. */
export function dbRefOf(url) {
  if (!url) return 'unset';
  try {
    return fp(new URL(url).hostname);
  } catch {
    return 'unparsable';
  }
}
