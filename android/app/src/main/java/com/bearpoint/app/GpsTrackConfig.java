package com.bearpoint.app;

/** Recording thresholds. Distance is independent of the reported GPS accuracy. */
final class GpsTrackConfig {
    private GpsTrackConfig() {}
    // 마지막 저장 위치에서 이 거리(m) 이상 이동해야 다음 좌표를 저장합니다.
    static final double MIN_DISTANCE_METERS = 10;
    // GPS가 보고한 수평 오차(m)가 이 값을 초과하면 좌표를 제외합니다.
    static final double MAX_ACCURACY_METERS = 100;
    // 현재 시각과 이 시간(ms)보다 차이 나는 오래된 좌표는 제외합니다.
    static final long MAX_LOCATION_AGE_MS = 60000;
    // 두 저장 위치 사이의 계산 속도(m/s)가 이 값을 초과하면 비정상 이동으로 제외합니다.
    static final double MAX_SPEED_METERS_PER_SECOND = 60;
}
