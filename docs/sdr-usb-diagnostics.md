# SDR USB 연결 진단 — 1단계

## 이번에 사용한 빌드·검증 명령어

PowerShell에서 프로젝트 루트(`C:\workspace\bear_point`)를 기준으로 실행한다.

```powershell
# JavaScript 문법 및 UI 테스트
node --check public/js/sdr/diagnostics.js
node --test tests/sdr-diagnostics.test.cjs

# 웹 파일을 Android 프로젝트에 반영
npx cap copy android

# APK 빌드 및 Android 정적 검사
cd android
.\gradlew.bat :app:assembleDebug :app:lintDebug --no-daemon --console=plain
```

최종 웹 파일 반영 후에는 `npx cap copy android`를 프로젝트 루트에서 다시 실행하고,
`android` 폴더에서 아래 명령으로 APK를 재생성했다.

```powershell
.\gradlew.bat :app:assembleDebug --no-daemon --console=plain
```

생성 APK: `android/app/build/outputs/apk/debug/BearMap.apk` (프로젝트 루트 기준).

## 이번 단계의 범위

이 단계는 Android USB Host 장치 조회, 접근 권한, `openDevice()` 연결 확인만 수행한다.
튜너 초기화, IQ 수집, 주파수 설정, RF 수신, 오디오, 대역 탐색은 아직 구현하지 않았다.
USB 연결 성공을 비콘 수신 성공으로 해석하면 안 된다.

## 구현

- `android/app/src/main/java/com/bearpoint/app/RtlSdrPlugin.java`: 앱 내부 Capacitor Java 플러그인.
- `public/js/sdr/diagnostics.js`, `public/css/sdr-diagnostics.css`: 지도 화면의 **SDR 연결** 진단 창.
- Android 기본 USB API만 사용한다. 별도 드라이버 앱, 루팅, 추가 npm 라이브러리는 필요 없다.
- 초기 허용 USB ID: `0BDA:2832`, `0BDA:2838`. 다른 USB 장치는 표시하되 접근 버튼은 비활성화한다.
- USB ID는 RTL-SDR 후보 판단용이다. 실제 튜너는 미확인으로 표시한다.
- 모든 USB 상태 변경은 메인 스레드에서 직렬 처리한다. 권한 요청은 한 번에 하나, 90초 제한이다.
- 고유 PendingIntent URI로 늦게 도착한 이전 권한 응답을 배제한다.
- 권한 결과 필터에는 `bearpoint-usb` URI 스킴을 등록한다. URI 없는 USB 연결·분리 이벤트는 별도 필터로 수신한다.
- 앱 복귀, 상태 조회, 시간초과 직전에 실제 USB 권한을 재확인한다. 이미 승인된 요청은 대기 상태를 종료한다.
- 분리, 취소, 종료 시 대기 요청과 연결을 정리한다. 재연결 시 권한을 다시 확인한다.
- JavaScript에 USB 파일 디스크립터를 노출하지 않는다. USB 인터페이스 claim 및 RF 초기화는 다음 단계에 맡긴다.
- 진단 창을 닫으면 연결을 해제한다. 이 단계는 백그라운드 수신 서비스가 아니다.
- 장치 연결 시 앱 자동 실행은 추가하지 않았다. 앱 실행 후 목록 조회 또는 새로고침을 사용한다.

## API

현재처럼 일반 HTML/JS를 사용하는 앱은 Android가 주입한 `window.Capacitor.Plugins.RtlSdr`로 접근한다.
별도 JS 런타임이 제공하는 `registerPlugin()`은 함수가 실제로 있을 때만 대체 경로로 사용한다.

| 메서드 | 반환 / 동작 |
| --- | --- |
| `getStatus()` / `listDevices()` | `hostSupported`, `state`, `devices`, `connectedDeviceId`, `lastError`, `rfReady:false` |
| `requestDevicePermission({deviceId})` | 권한 승인 후 장치 정보 반환. 거부·시간초과·분리 시 reject |
| `openDevice({deviceId})` | 승인된 지원 장치를 열고 상태 반환. 권한 자동 요청 없음 |
| `closeDevice()` | 대기 요청 취소 및 연결 해제. 반복 호출 가능 |
| `addListener("usbStateChanged", callback)` | 연결·분리·권한 변화·앱 복귀 시 상태 전달 |

`deviceId`는 현재 연결에서만 유효한 Android 장치 경로다. DB에 영구 식별자로 저장하지 않는다.
장치 목록에는 `name`, `vendorId`, `productId`, `candidate`, `hasPermission`, `connected`, `tuner:"unverified"`가 포함된다.

## 빌드 및 연결

프로젝트 루트에서:

```powershell
npx cap copy android
cd android
.\gradlew.bat :app:assembleDebug :app:lintDebug --no-daemon
```

APK: `android/app/build/outputs/apk/debug/BearMap.apk`.
빌드 도구는 SDK 35 및 Java 21 조합을 위해 AGP 8.6.1 / Gradle 8.7로 맞췄다.
기존 `org.gradle.java.home` 경로가 없는 개발 PC는 자신의 JDK 21 경로를 설정해야 한다.

실물 연결:

```text
개발 PC <-- 무선 ADB --> Android 휴대폰
                             |
                            OTG
                             |
                          RTL-SDR
```

PC를 호스트로 한 허브에 휴대폰과 SDR을 함께 꽂으면 휴대폰의 USB Host 검증이 되지 않는다.
USB 권한 확인에는 안테나나 실제 발신기가 필요하지 않다.
휴대폰의 USB 디버깅 승인과 앱의 SDR 접근 승인은 서로 다른 권한이다.
APK 재설치에는 기존 데이터 보존을 위해 `adb install -r`을 사용하며 앱 삭제나 데이터 초기화는 하지 않는다.

## 실기기 검증표

UI 비동기 흐름 자동 검증: `node --test tests/sdr-diagnostics.test.cjs`.
이 테스트는 모의 DOM/Capacitor 브리지를 사용하므로 Android 권한 창이나 실제 USB 통신을 검증하지 않는다.

Android 권한 응답 필터 회귀 테스트: `RtlUsbIntentFilterTest`.
테스트 컴파일은 `android` 폴더에서 `.\gradlew.bat :app:compileDebugAndroidTestJavaWithJavac`로 확인한다.
실제 실행은 연결된 테스트 기기/에뮬레이터에서 아래 명령을 사용한다(테스트 실행 과정에서 앱과 테스트 APK를 설치함).

```powershell
.\gradlew.bat :app:connectedDebugAndroidTest "-Pandroid.testInstrumentationRunnerArguments.class=com.bearpoint.app.RtlUsbIntentFilterTest"
```

승인 후 대기 오류의 원인: 요청 식별용 URI를 PendingIntent에 넣었지만 이전 IntentFilter는 URI를 허용하지 않아 결과가 전달되지 않았다.
URI 필터를 보완했으며, 이 계측 테스트의 실행과 실제 권한 창 검증은 연결된 기기에서 별도로 수행해야 한다.

- [ ] 미연결: 장치 없음 표시, 오류 없이 새로고침 가능.
- [ ] 앱 실행 전 연결: 최초 조회에 동글 표시.
- [ ] 앱 실행 중 연결: 이벤트 또는 새로고침으로 표시.
- [ ] 권한 전: 권한 없음 표시, 시리얼 접근 예외 없음.
- [ ] 권한 승인: 권한 있음으로 변경, 연결 확인 버튼 활성화.
- [ ] 권한 거부: 오류 안내 후 재요청 가능.
- [ ] 권한 대기 중 연속 클릭: 요청 중복 없음.
- [ ] 권한 대기 중 분리/취소: 요청 종료, 늦은 응답으로 연결되지 않음.
- [ ] 연결 확인: USB 연결 완료와 RF 미검증 표시.
- [ ] 연결 상태에서 분리/재연결: 이전 연결 제거, 새 권한 상태 재조회.
- [ ] 앱 백그라운드 중 분리 후 복귀: 올바른 목록 표시.
- [ ] 진단 창 닫기 및 다시 열기: 연결 해제 상태, 재연결 가능.
- [ ] 일반 USB 장치: 진단 화면은 표시하지만 접근 요청 금지.
- [x] 웹 브라우저: Android 전용 안내, USB 버튼 비활성화 (Chrome에서 확인).

## 이번 구현의 검증 결과

- 기존 변경 전 Android debug 빌드 성공.
- AGP 8.6.1 / Gradle 8.7에서 USB 플러그인 포함 debug 빌드 성공.
- `:app:lintDebug`: 오류 0, 경고 23. 기존 파일 공유 코드·Manifest 순서·리소스·의존성 관련 경고가 남아 있다.
- `node --test tests/sdr-diagnostics.test.cjs`: 6개 테스트 통과. Android 주입 브리지, 선택적 registerPlugin 경로, 초기화 실패 시 창 표시를 포함한다.
- Chrome에서 진단 창 열기, Android 전용 안내 및 비활성 버튼을 확인.
- 휴대폰은 ADB `unauthorized` 상태여서 APK 설치·실제 USB 권한·동글 연결 검증은 수행하지 못했다.

## 다음 단계

공식 libusb와 Osmocom librtlsdr의 검증된 버전을 고정해 NDK로 빌드하고, Android에서 얻은 연결을 JNI로 전달한다.
`libusb_wrap_sys_device()` 연동과 파일 디스크립터 수명을 구현한 뒤 실제 튜너 식별, 단일 주파수 IQ 수신을 검증한다.
현재 `openDevice()` 성공은 그 네이티브 경로의 성공을 보증하지 않는다.
