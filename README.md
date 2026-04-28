#forever 명령어(설치 후 사용)
npx forever start server.js

npx forever stop 0


#일반 시작
npm run dev


앱 배포

웹 변경 반영(프로젝트 루트에서 실행)
npx cap sync android
npx cap open android

디버그 APK 빌드 android 폴더로 이동
.\gradlew.bat assembleDebug

생성된 APK 위치
android/app/build/outputs/apk/debug/app-debug.apk