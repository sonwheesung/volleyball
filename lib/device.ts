// 기기 진단정보 (BACKEND_SYSTEM §13.17 §A) — 최소 수집(OS 종류·버전·앱버전). "어떤 폰에서 깨지나" 진단·환불 판단용.
// Platform.OS로 android/iOS는 무설치 확실. 모델명은 expo-device(네이티브)라 EAS 후 추가.
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import type { DeviceInfo } from './server';

export function getDeviceInfo(): DeviceInfo {
  return {
    platform: Platform.OS, // 'ios' | 'android' | 'web'
    osVersion: String(Platform.Version ?? ''), // iOS=버전문자 · Android=API 레벨
    appVersion: (Constants.expoConfig?.version as string) ?? '0.0.0',
  };
}
