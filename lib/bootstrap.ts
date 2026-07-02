// 부팅 게이트 유틸 (AUTH_SYSTEM §4) — 버전 비교. 게이트 판정은 서버 bootstrap 응답 기준(앱 로컬 신뢰 금지).
// 버전 문자열 'a.b.c' 정수 비교. min 미만=강제, latest 미만=소프트.
export function cmpVersion(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** 앱 버전이 target 미만인가(target null이면 게이트 없음 → false). */
export const belowVersion = (appVer: string, target: string | null | undefined): boolean =>
  !!target && cmpVersion(appVer, target) < 0;
