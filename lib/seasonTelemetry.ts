// 시즌 종료 행동 텔레메트리 — 전송 트리거 · BACKEND_SYSTEM §13.27.
//
// endSeason 커밋 직후 fire-and-forget. lib/saveBackup.ts triggerSeasonBackup 패턴 미러:
//   **절대 throw 안 함 · store 무접촉**(비차단·결정론 격리) · 실패는 조용(무알림 — 게임 진행 무영향).
// 비PII: 행동 카운트만 전송(선수 이름·개인정보 0). 하위호환: 서버 미배포/구버전이면 sendSeasonTelemetry가 typed offline/error로 흡수.
//
// ★ src(롤오버 전 상태)·meta를 호출부(endSeason)가 넘긴다 — 롤오버 후 세이브는 그 시즌의 개입/방출/전지훈련 로그가
//   이미 리셋돼 사라지므로(§13.27), 세이브를 다시 읽는 대신 롤오버 전 스냅샷 참조를 전달받아 여기서 순수 집계한다.
import { computeSeasonTelemetry, type TelemetrySource, type TelemetryMeta } from '../data/seasonTelemetry';
import { sendSeasonTelemetry } from './server';
import { logError } from './log';

/** endSeason 롤오버 직후 호출(fire-and-forget). 순수 집계 → 서버 전송. 전 구간 try/catch 무해. */
export async function triggerSeasonTelemetry(src: TelemetrySource, meta: TelemetryMeta): Promise<void> {
  try {
    if (!src.selectedTeamId) return; // 진행 중 구단 없으면 전송 안 함(익명/로컬 통과)
    const payload = computeSeasonTelemetry(src, meta);
    await sendSeasonTelemetry(meta.season, payload); // 실패해도 typed 결과(throw 없음) — 조용히 통과
  } catch (e) {
    logError('seasonTelemetry:trigger', e); // 방어 — 어떤 이유로든 게임 진행 무영향
  }
}
