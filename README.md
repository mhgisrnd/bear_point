#forever 명령어(설치 후 사용)
npx forever start server.js

npx forever stop 0


#일반 시작
npm run dev


앱 배포

웹 변경 반영(프로젝트 루트에서 실행)
npx cap sync android
npx cap open android

배포
.\gradlew.bat assembleDebug

생성된 APK 위치
android/app/build/outputs/apk/debug/app-debug.apk

안드로이드 AndroidManifest.xml 재빌드 필요 시
.\gradlew.bat assembleDebug --no-daemon


아이콘 추가/수정 시
npx capacitor-assets generate