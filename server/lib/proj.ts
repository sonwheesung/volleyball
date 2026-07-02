// 멀티게임 프로젝트 코드 — 이 서버 인스턴스가 서비스하는 게임(§13.2). 모든 DB write에 주입되는 단일 소스.
// 향후 타 스포츠게임은 별도 배포(또는 env)로 PROJ_CODE만 바꿔 같은 코드/스키마 재사용.
export const PROJ_CODE = process.env.PROJ_CODE ?? 'volleyball';
