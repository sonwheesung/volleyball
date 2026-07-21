import { fileURLToPath } from 'url';
import { dirname } from 'path';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // 배구명가 백엔드 — 순수 API + 관리자 대시보드. 이미지 최적화 등은 불필요.
  reactStrictMode: true,
  // 모노레포(바깥 Expo 앱 + server/)의 락파일 2개 때문에 Turbopack이 워크스페이스 루트를
  // 바깥 리포로 오인 → server/app 라우트 전부 404(dev 실사고 2026-07-21). 루트를 명시 고정.
  turbopack: { root: dirname(fileURLToPath(import.meta.url)) },
};

export default nextConfig;
