// OTA 자동 적용(부팅 전용) 순수 헬퍼 (AUTH_SYSTEM §4) — RN/네이티브 무의존.
//   여기엔 결정 로직(킬스위치 판정·타임아웃 레이스)만 둔다. 실제 expo-updates 호출(check/fetch/reload)은
//   BootGate에서 — 이 모듈은 node 가드(tools/_dv_ota.ts)가 직접 import해 검증하므로 expo-updates를 import하지 않는다.

/** checkForUpdateAsync 타임아웃(ms) — 서버 응답 지연/오프라인 시 조용히 통과(비차단). */
export const OTA_CHECK_TIMEOUT_MS = 4000;
/** fetchUpdateAsync 타임아웃(ms) — 번들 다운로드 상한. check보다 커야 한다(다운로드가 조회보다 오래 걸림). */
export const OTA_FETCH_TIMEOUT_MS = 9000;

/** 원격 킬스위치 훅 — 서버 bootstrap이 `otaAutoApply:false`를 주면 부팅 자동적용을 차단한다.
 *  기본 on: undefined/null(오프라인·미설정)·{}·true 모두 허용. false일 때만 차단.
 *  부팅 시점 리로드는 무해(콜드부팅 동치·재수화 멱등)라 오프라인(boot null)에서도 true. */
export function otaAutoApplyEnabled(boot: { otaAutoApply?: boolean } | null | undefined): boolean {
  return boot?.otaAutoApply !== false;
}

/** 타임아웃 레이스 — p가 ms 안에 끝나면 그 값을, 초과하면 reject한다. 순수(Promise+setTimeout만).
 *  타이머는 어느 쪽이 이기든 정리한다(누수 방지). */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`otaGate: timeout ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}
