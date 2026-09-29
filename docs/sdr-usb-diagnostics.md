# SDR 연결·IQ 분석·WFM 방송 수신 테스트

## 현재 단계: IQ 스트림과 테스트용 WFM 모노 음성

실행 명령(프로젝트 루트 PowerShell):

```powershell
node --check public/js/sdr/diagnostics.js
node --check public/js/sdr/spectrum.js
node --test tests/sdr-diagnostics.test.cjs tests/sdr-spectrum.test.cjs tests/sdr-wfm.test.cjs
npx cap copy android
cd android
.\gradlew.bat :app:assembleDebug :app:testDebugUnitTest :app:lintDebug --no-daemon --console=plain
```

`npx cap sync android`도 가능하다. Gradle 명령은 **android 폴더에서** 실행한다.
APK는 **`android/app/build/outputs/apk/debug/BearMap.apk`**다.
NDK **26.1.10909125**, CMake **3.22.1**을 추가로 사용한다.
ABI는 arm64-v8a, armeabi-v7a, x86_64다. 새 라이브러리는 16 KiB ELF 정렬로 링크하지만,
기존 의존성을 포함한 앱 전체의 16 KiB 기기 호환성은 별도 검증 대상이다.

### 주파수 조정

수신 주파수는 각 숫자의 ▲/▼로 해당 자릿수만큼 올리거나 내립니다. 최소 간격은 **0.001 MHz(1 kHz)**이며 자리올림·자리내림을 처리합니다. 선택한 대역을 벗어나는 버튼은 비활성화됩니다.
**직접 입력**을 누르면 숫자 입력으로 전환되고, **완료** 또는 Enter로 돌아옵니다. 수신 중에는 변경할 수 없으며 정지 후 조정합니다.
이번 UI 변경은 `node --test tests/sdr-diagnostics.test.cjs tests/sdr-spectrum.test.cjs`, `npx cap copy android`, Android 폴더의 `.\gradlew.bat :app:assembleDebug --no-daemon --console=plain`으로 확인합니다.

### 화면 문구 정리

USB 영역은 **USB 장치**라는 접이식 목록으로 표시합니다. 장치는 테두리가 있는 카드로 구분하고, 연결 전에는 **권한 허용 및 연결** 또는 **연결** 버튼을 제공합니다. 연결 후에는 버튼 대신 녹색 **연결됨** 배지를 표시합니다. 새로고침·연결 해제는 목록 아래의 보조 버튼입니다.

WFM은 새 수신을 시작하여 IQ 데이터가 확인되면 기본으로 음성을 켭니다. 사용자는 수신 결과의 **음소거** 버튼으로 끌 수 있습니다. 음소거·오디오 포커스 상실·출력 장치 분리 후에는 측정 갱신만으로 소리를 다시 켜지 않습니다. 출력 사용이 거부되면 RF 수신은 유지하고 오디오 오류를 표시합니다. IQ 모드는 음성을 켜지 않습니다.

기본 화면은 연결 상태·설정 입력·수신량/전력·수신음 버튼·스펙트럼 중심으로 구성한다.
반복적인 연결/수신 안내와 하단 설명을 제거하고, 설정값 해설과 비콘 미검증·앱 이탈 시 정지 안내는 접힌 **도움말**에 둔다.
샘플레이트에 따른 수신 구간/데이터량은 **고급 설정**, 실제 적용 설정·누적량·포화율·FFT 구간/간격은 **측정 정보**에 둔다.
스펙트럼 아래에는 수신/정지 상태와 최대 지점 값만 짧게 표시한다. 오류와 출력 장치 분리 안내는 유지한다.

### 화면과 사용 순서

1. 지도 오른쪽 위 배경지도 버튼 왼쪽 **SDR** 버튼을 누른다.
2. **USB 장치**에서 RTL2832U의 **권한 허용 및 연결**을 누르고 Android 허용 창에서 승인한다. 승인 후 자동 연결되며 목록이 접힌다. 이미 권한이 있으면 **연결** 한 번으로 연결한다.
3. 방송 음성 테스트는 수신 대역 **FM 방송**, 수신 모드 **WFM**을 선택한다. FM 기본 주파수는 **103.500 MHz**이며, 초기 기본값은 샘플레이트 **1.024 MS/s**, Gain 요청 **10 dB**, PPM **0**, 디엠퍼시스 **75 µs**다. 테스트 설정 적용 버튼은 제거했다. 대역·모드 선택은 사용자가 바꾼 고급 설정을 초기화하지 않는다.
4. **수신 시작**을 누르면 WFM 수신음이 자동으로 켜진다. 수신 결과의 **음소거**로 끄고 **소리 켜기**로 다시 켠다. IQ 모드에는 수신음이 없다.
5. 설정을 바꾸려면 정지 후 다시 시작한다.

USB 권한과 연결은 화면에서 한 번의 동작으로 진행한다. 내부에서는 권한 요청 완료 후 `openDevice()`를 순서대로 호출한다.
목록에는 RTL-SDR 후보만 표시하며 USB LAN·오디오 등 다른 장치는 숨긴다. 현재 후보 기준은 VID `0BDA`, PID `2832` 또는 `2838`이다. 다른 제품이 이 USB ID로 인식돼도 튜너 초기화·IQ 수신 성공까지 확인해야 실제 호환을 판단할 수 있다. 다른 USB ID는 현재 후보 목록에 포함하지 않는다.
권한 거부·취소·분리 시 연결하지 않으며, 창을 닫거나 요청을 취소한 뒤 늦게 승인 응답이 와도 다시 연결하지 않는다.
연결 실패 시 오류를 표시하고, 이미 받은 권한은 다시 요청하지 않고 연결만 재시도할 수 있다. RF 수신은 여전히 **수신 시작**으로 따로 실행한다.
이 연결 흐름 변경은 UI/스펙트럼 테스트 **19개**로 확인했다(자동 연결, 연결 실패 후 재시도, 창 닫기 후 늦은 승인, 거부·취소 포함). Android 실기기 권한 창의 승인 후 자동 연결은 새 APK에서 확인한다.

이어폰은 Android에서 먼저 연결하고 **미디어 출력**으로 선택한다. 앱은 Android의 미디어 출력 경로를 사용하며 Bluetooth 장치 선택/페어링은 앱 밖에서 한다.
앱의 음량 슬라이더는 제거했으며 별도 감쇠 없이 재생한다. 음량은 휴대폰의 Android 미디어 볼륨으로 조절한다. Bluetooth·유선 등의 현재 출력 장치가 분리되거나 오디오 포커스를 잃으면 음소거한다. 다시 켜려면 출력 상태를 확인하고 버튼을 누른다.
수신 시작·정지는 스크롤되지 않는 하단 제어부에 있다. WFM 소리 켜기/음소거와 출력 상태는 **수신 결과의 수신 데이터·대역 전력 바로 아래** 수신음 패널에 있다. 좁은 화면에서도 측정값 두 칸의 폭을 유지하도록 음성 제어를 별도 행에 배치했다. USB 목록은 연결 후 접히고, 샘플레이트/Gain/PPM/음색 보정은 **고급 설정**에 들어 있다.
USB 연결·수신 설정·수신 결과는 모두 접고 펼칠 수 있다. 처음에는 수신 설정이 펼쳐져 있고 수신 결과는 접혀 있다.
새로운 수신이 시작되면 설정을 접고 결과를 펼쳐 해당 영역으로 이동한다. 이후 사용자가 접은 결과를 매 갱신마다 강제로 펼치지 않는다.
소리 켜기 버튼은 청록색, 재생 중 표시되는 음소거 버튼은 주황색이다. 버튼 문구와 눌림 상태도 함께 바뀐다.
설정 자체는 연결 전에도 준비할 수 있지만 수신 시작은 USB 연결 완료 후 가능하다.

**수신 주파수** 입력 하나로 IQ 수신 중심과 WFM 복조 주파수를 동일하게 설정한다.
FM 대역의 기본 주파수는 **103.500 MHz**다. 중심/듣기 주파수를 따로 맞추지 않는다.
WFM에 필요한 채널 여유 검증은 유지하며, 같은 중심 주파수에서는 모든 샘플레이트 프리셋을 사용할 수 있다. 첫 테스트는 **1.024 MS/s**를 권장한다.
중심에서 복조하므로 동글의 중심 DC 성분이 음질에 영향을 줄 가능성은 실기기에서 확인한다.

허용 대역: 현장 VHF **148–174 MHz**, FM 방송 테스트 **88–108 MHz**.
FM을 처음 선택하면 사용자 시험 방송인 **103.500 MHz**로 맞춘다. 각 대역의 입력값은 현재 앱 세션에서 따로 기억한다.
수신 대역은 입력 범위 선택이며, **수신 모드**에서 IQ 분석/WFM을 따로 선택한다. WFM을 선택하면 FM 대역으로 전환한다. VHF로 돌아가면 IQ 분석으로 전환한다.
샘플레이트는 **0.250 / 1.024 / 1.536 / 2.048 / 2.400 MS/s**, 기본값은 **1.024**를 유지한다.
Gain 요청 −10–50 dB, PPM −100–100.
기본 **150 MHz는 임의의 테스트 값**이며 실제 발신 주파수를 뜻하지 않는다.
RTL·튜너 AGC는 끄고, 요청 Gain에 가장 가까운 튜너 지원 값을 적용하여 표시한다.
입력은 현재 앱 세션에서 유지되며 앱 재실행 시 기본값으로 돌아온다.

결과: 튜너 이름, 실제 주파수/샘플레이트/Gain, PPM, MB/s, 누적 MB, 시간, 대역 전력 dBFS, 포화율, **주파수별 전력 스펙트럼**.
1.024 MS/s에서는 약 **2.048 MB/s**, 2.048 MS/s에서는 약 **4.096 MB/s**가 기대된다(십진 MB).
103.5 MHz / 1.024 MS/s의 이론적 수신 구간은 **102.988–104.012 MHz**다.
화면에 중심 주파수 ± 샘플레이트/2의 이론적 구간과 샘플레이트 × 2 byte의 예상 수신량을 표시한다.
실제 활용 대역은 필터·가장자리 특성으로 더 좁을 수 있다. 설정 대역 경계에서도 표시 구간은 원래 값 그대로 보여준다.
FM 테스트는 우선 기본 1.024 MS/s로 진행한다. 2.400 MS/s는 약 2.4 MHz 폭 / 4.8 MB/s이며,
더 넓게 받는 대신 USB·처리 부담이 늘어난다. 100–105 MHz 전체를 한 번에 수신하지는 못한다.
샘플레이트가 다르면 잡음과 포함 신호도 달라지므로 대역 전력 비교 시 Gain과 샘플레이트를 고정한다.
공식 librtlsdr 헤더는 225001–300000 / 900001–3200000 Hz를 허용하지만,
2.4 MS/s 초과에서 샘플 손실을 예상한다고 명시한다. 이번 UI는 지원 구간 안의 5개 프리셋으로 제한한다.
관련 근거: `android/app/src/main/cpp/third_party/rtl-sdr/include/rtl-sdr.h`의 `rtlsdr_set_sample_rate` 주석.
원시 unsigned 8-bit I/Q 성분을 `(x−127.5)/127.5`로 정규화하고 평균 제곱의 `10 log10`을 표시한다.
포화율은 값이 0 또는 255인 성분의 비율이다.

**USB 연결 성공, IQ 스트림 성공, 실제 비콘 확인은 별개다.**
IQ에는 잡음도 포함된다. 대역 전력에는 중심 DC와 다른 신호도 포함되므로 특정 비콘의 세기나 dBm이 아니다.
Gain·샘플레이트·안테나 조건이 다른 수치를 직접 비교하지 않는다.
WFM 모노 복조와 오디오 재생을 추가했다. 스테레오/RDS, 다른 복조 모드, 비콘·펄스 판정, 대역 탐색, 백그라운드 서비스, 관측 저장은 아직 없다.
이번 동기 읽기 진단은 장시간 무손실 캡처를 보증하지 않는다.

### 스펙트럼 사용법과 계산

- **03 · 수신 결과** 아래 그래프에서 가로축 MHz / 세로축 dBFS/bin을 확인한다.
- 예: 103.5 MHz / 1.024 MS/s라면 102.988–104.012 MHz를 표시한다. 중심 점선은 103.5 MHz다.
- 주변보다 높거나 넓게 솟는 부분은 해당 주파수 부근의 에너지를 보여준다. 이것만으로 방송·비콘 종류가 판정되지는 않는다.
- 중심의 가는 봉우리는 동글 DC 성분일 수 있다. 그래프에는 그대로 표시하되 최대 지점 표시에서는 중심 ±3 FFT bin과 양 끝 5%를 제외한다.
- 정지 또는 오류 시 마지막 그래프임을 표시한다. 새 수신 시작·USB 해제 후에는 이전 그래프를 지운다.
- 고정 세로축은 **−120–0 dBFS/bin**이다. 위의 대역 전체 전력과는 계산 대상이 달라 수치가 같지 않다. 실제 dBm으로 보정한 값도 아니다.
- 1024-point complex FFT, periodic Hann window, 최대 4개 연속 프레임의 **선형 전력 평균**을 사용한다.
  bin 간격은 실제 적용 샘플레이트 / 1024다(1.024 MS/s에서 1000 Hz).
- FFT 전력은 `|FFT(window × IQ)|² / (2 × sum(window)²)`를 프레임 평균한 뒤 `10 log10`하고 −120–0으로 제한한다.
  이는 기존 I/Q 성분별 full-scale 기준에 맞춘 톤 전력 표시이며, Hann 주엽·잡음 대역폭을 포함한 정확한 PSD/dBm 계측은 아니다.
- raw unsigned 8-bit IQ 중 최대 8192성분(4×1024 I/Q쌍)을 약 500 ms마다 JNI에서 Java 작업 스레드로 전달한다.
  `SdrSpectrum`에서 계산하며 JS에는 **1024개 전력 값과 실제 적용 주파수·샘플레이트**만 전달한다.
- 전 구간을 연속 FFT로 처리하는 것은 아니다. 짧은 비콘 펄스는 스냅샷 사이에서 놓칠 수 있으며 향후 펄스 검출은 별도로 구현한다.
- 추가 FFT 처리의 실제 기기 처리량·발열 영향은 확인 대상이다. 첫 테스트는 기존 1.024 MS/s / Gain 10 / PPM 0을 유지한다.

### 네이티브 구현과 수명 관리

`RtlSdrPlugin` → `SdrReceiver` 작업 스레드 → `SdrNative` JNI → librtlsdr → libusb.

- 별도 드라이버 앱 없이 Android 승인 fd를 `libusb_wrap_sys_device()`에 전달한다.
- libusb context는 `NO_DEVICE_DISCOVERY`로 생성한다.
- 초기화·읽기·네이티브 해제는 단일 작업 스레드가 담당한다.
- 정지·분리 시 세대 토큰으로 이전 결과를 무효화한다. native close 후 Java fd를 닫는다.
- bulk 읽기는 250 ms 제한이며 3초간 데이터가 없으면 오류로 종료한다.
  초기화·해제 제어 전송에는 upstream timeout이 적용되어 전체 정지가 250 ms 안에 끝난다는 보장은 없다.
- IQ 원본과 fd는 JS에 전달하지 않고 약 500 ms마다 집계 수치만 전달한다.
- 창 닫기는 수신·USB 연결을 해제한다. 앱 일시중지/화면 꺼짐은 수신을 정지하며 자동 재시작하지 않는다.

### WFM 처리와 확장 구조

JNI의 복조기 생성 함수는 모드 이름으로 처리기를 생성한다. 현재 구현은 `wfm` 한 가지이며 `iq`에서는 복조기를 생성하지 않는다.
앞으로 NFM/AM/USB/CW를 추가할 때 USB 권한·IQ 수집·스펙트럼 경로를 재사용하고, 모드에 맞는 복조기와 설정 검증/UI를 추가한다. 아직 구현하지 않은 모드를 선택지에 노출하지 않는다.

`wfm_demod.h`는 직접 구현한 상태 유지 DSP다. 주파수 이동 → 100 kHz 저역 FIR/데시메이션 → 위상 차 FM 복조 → 15 kHz 오디오 FIR/분수 리샘플링 → 50/75 µs 디엠퍼시스 → DC 제거 → 모노 48 kHz PCM16 순서다.
첫 IQ 블록의 실제 샘플레이트를 확인한 뒤 복조기를 초기화한다. 이후 블록에서 PCM을 생성하므로 시작 직후 첫 블록은 음성으로 출력하지 않는다.
필터·발진기·이전 위상·홀수 바이트 상태를 USB 블록 사이에서 유지한다. 스테레오 부반송파와 RDS를 해석하지 않는다.
PCM은 JS를 거치지 않고 `SdrAudioOutput`의 별도 스레드에서 `AudioTrack`으로 재생한다. 오디오 큐는 최대 8개 블록이며, 넘치면 블록을 버리고 누락 횟수를 표시해 USB 읽기를 막지 않는다.
Media AudioFocus를 요청하며 소리 켜기는 WFM 수신 중에만 가능하다. 별도 드라이버 앱·마이크 권한·Bluetooth 페어링 제어를 추가하지 않았다.
정지·오류·USB 분리·창 닫기·앱 일시중지는 음성 출력도 멈춘다. 높은 샘플레이트의 처리량·발열과 Bluetooth 지연은 실제 기기에서 확인해야 한다.

WFM 자체에는 새 외부 DSP 라이브러리를 추가하지 않았다. 기존 libusb/librtlsdr의 라이선스와 보관·배포 조건은 그대로 적용한다.

### 이번 WFM 검증

- Node 테스트 **21개**: USB 권한/브리지, 설정 경계, 스펙트럼, WFM 단일 주파수 프리셋/음소거/기기 볼륨 사용/설정 검증, C++ 복조 테스트.
- 복조 테스트 **4개**는 APK에 들어가는 동일 C++ 헤더를 NDK Clang으로 WASM 빌드해 실행한다. 5개 샘플레이트의 합성 FM 1 kHz 톤 복원과 48 kHz 출력 수, 음·양 주파수 이동, 홀수 USB 블록 경계의 동일 결과, 50/75 µs 고음 감쇠와 잘못된 설정 거부를 확인한다.
- 이 테스트는 NDK 26.1.10909125의 Windows Clang/LLD를 사용한다. 다른 위치는 `SDR_TEST_CLANG`으로 `clang++.exe`를 지정한다. 임시 WASM 파일은 OS 임시 디렉터리에 생성되며 APK에는 포함되지 않는다.
- Android 단위 테스트 **7개**: 주파수/샘플레이트/WFM 채널 경계 3개, FFT 4개.
- `assembleDebug`, `testDebugUnitTest`, `lintDebug` 성공. Chrome의 390 px 폭 모의 화면에서 프리셋, 설정 잠금, 소리/출력 상태 및 고정 하단 제어부를 확인했다.
- **실제 WFM 방송 청취·Bluetooth 출력은 미검증**이다. ADB 기기가 연결되지 않아 새 APK의 하드웨어 동작을 대신 확인할 수 없다.

실기기에서는 방송이 들리는지, 방송 주파수를 바꾸면 수신음이 바뀌는지, 정지/재시작과 창 닫기 후 소리가 멈추는지, Bluetooth 분리 후 자동 음소거되는지 확인한다. 재생이 끊기면 오디오 누락 횟수, 수신량, 샘플레이트, 오류 내용을 함께 기록한다.
소리가 안 나오면 먼저 앱의 소리 켜기, Android 미디어 음량·출력 경로, 안테나 및 해당 지역 방송 수신 여부를 확인한다. IQ 수신량이 증가하는 것만으로 FM 방송을 정상 복조했다고 판단하지 않는다.

주요 추가 파일: `SdrReceiver.java`, `SdrNative.java`, `SdrSettings.java`, `SdrSpectrum.java`, `android/app/src/main/cpp/sdr_jni.cpp`, `CMakeLists.txt`, `public/js/sdr/spectrum.js`.
JS와 Android 모두 대역에 따른 주파수 경계와 샘플레이트 프리셋을 검증한다. 두 대역 사이의 임의 주파수는 허용하지 않는다.

### 라이브러리와 라이선스

공식 libusb **1.0.30**과 Osmocom rtl-sdr 커밋 **797f8143266d983c56d8f35d2d442527529dd8a5**를 포함한다.
FC0013 드라이버도 빌드한다. libusb는 LGPL-2.1-or-later, rtl-sdr는 GPL-2.0-or-later다.
출처는 `android/app/src/main/cpp/THIRD_PARTY.md`, 수정사항은 `rtl-sdr-android.patch`에 기록했다.
라이선스 원문과 NDK 고지는 `public/licenses/sdr`에 들어가 APK에 포함된다.
조직 내부 사용을 전제로 소스·패치·빌드 파일을 함께 보관한다. 외부 배포 전에는 전체 앱의 GPL 의무를 다시 검토한다.
동적 링크만으로 GPL 의무가 사라지는 것은 아니다.

### 실기기 확인 사항

스펙트럼 추가 검증: Node 테스트 **14개**, Android 단위 테스트 **6개** 통과(설정 2개 + FFT 4개).
FFT 테스트는 합성 양·음 주파수 톤의 위치·전력, 프레임 평균, Hann 누설 억제, 무입력 처리 등을 확인한다.
최종 `assembleDebug`, `testDebugUnitTest`, `lintDebug` 성공(오류 0, 기존 경고 23).
Chrome에서 그래프 축·중심선·수신 대기 화면 배치를 확인했으며 APK의 JS/CSS/HTML이 최종 원본과 일치한다.
개발 환경에 ADB 기기가 연결되어 있지 않아 새 스펙트럼 경로의 실제 동글 실행은 아직 하지 않았다.
103.5 MHz / 1.024 MS/s / Gain 10 / PPM 0으로 수신 후 그래프와 수신량이 계속 갱신되는지 확인한다.

FM 범위 확장 검증: Node 테스트 **10개**, Android 설정 검증 단위 테스트 **2개** 통과.
`assembleDebug`, `testDebugUnitTest`, `lintDebug` 성공(오류 0, 기존 경고 23).
Chrome에서 대역 선택·설정 설명 배치를 확인했고, APK의 JS/CSS가 최종 원본과 일치함을 확인했다.
실제 103.5 MHz RF 수신과 추가 샘플레이트는 기기에서 확인해야 한다.

개발 환경 검증: `assembleDebug` 및 `lintDebug` 성공(오류 0, 기존 경고 23),
이전 IQ 단계의 Node 테스트 8개 통과, Chrome에서 설정 화면과 Android 전용 안내 확인.
최종 APK에 3개 ABI의 SDR 라이브러리·설정 UI·라이선스 파일 포함을 확인했다.
ADB 연결 기기가 없어 새 네이티브 수신 경로의 실기기 실행은 아직 하지 않았다.

- 사용자 보고로 이전 단계의 USB 권한 승인·연결 확인은 성공했다.
- 사용자 보고: 1.024 MS/s에서 약 2 MB/s 수신과 −47.2 dBFS 표시 확인. 이는 IQ 전송 검증이며 알려진 비콘·방송 검출 결과는 아니다.
- FM 대역과 확장된 샘플레이트의 실제 수신은 수정 APK를 설치한 기기에서 검증한다.
- 새 단계의 튜너 식별, IQ 누적량 증가, 알려진 시험 신호에 대한 RF 반응은 실기기 확인이 필요하다.
- 정지·재시작, 수신 중 USB 분리, 창 닫기·재연결, 앱 이동·복귀를 확인한다.
- 포화가 많으면 정지 후 Gain을 낮춰 재시작한다.
- 대역 전력 변화만으로 목표 비콘이 검출됐다고 결론 내리지 않는다.
- 오류 발생 시 오류 전문과 설정, 연결 구조를 기록한다.
- Node 테스트는 모의 브리지 테스트이며 실제 USB·RF 검증을 대체하지 않는다.

---

# 이전 1단계 기록: USB 연결 진단

아래는 네이티브 수신 구현 전의 기록이다. 현재 동작과 범위는 위 내용을 따른다.

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
- `public/js/sdr/diagnostics.js`, `public/css/sdr-diagnostics.css`: 지도 우측 상단 **배경지도 선택 버튼 왼쪽의 SDR 버튼**에서 여는 진단 창.
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
