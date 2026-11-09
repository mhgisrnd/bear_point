require("dotenv").config();
const { pushEnabled, startPushWorker } = require("../src/services/bearEstimatePush");

if (!pushEnabled()) {
  console.error("FCM_PROJECT_ID를 설정해야 푸시 발송 작업을 시작할 수 있습니다.");
  process.exitCode = 1;
} else {
  startPushWorker({ keepAlive: true });
}
