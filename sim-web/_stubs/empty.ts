// react-native 스텁 — 브라우저엔 RN이 없다. 폴리필/전이 import가 가져가는 이름만 no-op 제공.
// 엔진(engine/)·셀렉터(data/)는 순수 TS라 실제로 RN을 쓰지 않으므로 안전.
export const Platform = { OS: 'web', select: (o: any) => o.web ?? o.default };
export const NativeModules: Record<string, unknown> = {};
export const TurboModuleRegistry = { get: () => null, getEnforcing: () => null };
export class NativeEventEmitter { addListener() { return { remove() {} }; } removeAllListeners() {} }
export default {};
