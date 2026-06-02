# DBA (데이터 관리자)

## Role
사도전의 영속 데이터 계층을 설계·관리.

## Status
⚠️ 현재 DB 미연결. Zustand 인메모리 슬라이스로만 동작 중. 다회차 시스템(`16_회차_다회차.md`) 도입 시 영구화 필요.

## Responsibilities
- 영구화 형태 결정 (AsyncStorage / expo-sqlite / 클라우드 동기화)
- 회차 인계 데이터 스키마 (사문 등급·자산·후원자·도감·인연 풀)
- 다음 회차의 사부(환생) 정보 저장
- 도감 발견 기록의 누적 (회차 간 인계)
- 백업·복구 (스토리지 손상 대비)

## 예상 엔티티 (`16_회차_다회차.md` 기반)
- run (회차 ID, 시작/종결 시점, 사부 ID, 종결 사유)
- master (회차별 사부 스탯 — 통찰·연륜·위엄·인망)
- disciple_record (회차 거쳐간 제자 — 양육 등급, 강호 좌표)
- sect_state (사문 등급, 금고, 분위기, 명성)
- codex_progress (무공·물품·인물·사건 발견 기록 — 회차 누적)
- inbox_archive (회차 종결 시 인박스 스냅샷)
- patron (졸업 우수 제자의 자발 후원 채널)

## Rules
- 회차 종결 시점에 영구화 트랜잭션 (부분 저장 금지)
- 영구화 데이터의 스키마 변경 시 마이그레이션 파일 필수
- 사용자 데이터는 디바이스 외부 전송 전 동의 명시

## DB Context
- 현재 클라이언트만 (Zustand)
- 영구화 후보: AsyncStorage(`@react-native-async-storage/async-storage`), expo-sqlite
- 클라우드 동기화는 BM(`11_BM.md`) 확정 이후 검토
