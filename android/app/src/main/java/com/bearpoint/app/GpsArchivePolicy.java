package com.bearpoint.app;

/** Pure guards shared by the transactional archive operation and its unit tests. */
final class GpsArchivePolicy {
    static boolean eligible(String status, boolean archived, long endedAt, long cutoff) {
        return !archived && ("saved".equals(status) || "interrupted".equals(status))
            && endedAt > 0 && endedAt < cutoff;
    }
    static boolean samePoint(double lat, double lng, double accuracy, long time,
                             double serverLat, double serverLng, double serverAccuracy, long serverTime) {
        return Double.isFinite(lat) && Double.isFinite(lng) && Double.isFinite(accuracy)
            && Double.compare(lat, serverLat) == 0 && Double.compare(lng, serverLng) == 0
            && Double.compare(accuracy, serverAccuracy) == 0 && time == serverTime;
    }
}
