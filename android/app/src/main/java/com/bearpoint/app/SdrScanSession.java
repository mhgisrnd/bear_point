package com.bearpoint.app;

/** One USB connection's scan history. Mutable fields belong to the receiver worker. */
final class SdrScanSession {
    final SdrScan plan;
    final int gain, ppm;
    final long startedMs;
    int segment, cycle = 1, actualRate;
    double actualGainDb;
    long totalBytes;

    SdrScanSession(SdrScan plan, int gain, int ppm, long startedMs) {
        this.plan = plan; this.gain = gain; this.ppm = ppm; this.startedMs = startedMs;
        actualRate = plan.rate; actualGainDb = gain / 10.0;
    }

    boolean matches(SdrScan other, int gain, int ppm) {
        return this.gain == gain && this.ppm == ppm && plan.band.equals(other.band)
            && plan.startHz == other.startHz && plan.endHz == other.endHz && plan.rate == other.rate
            && plan.dwellMs == other.dwellMs && Double.compare(plan.thresholdDb, other.thresholdDb) == 0;
    }

    int centerHz() { return plan.centers[segment]; }

    void completeSegment() {
        if (++segment == plan.centers.length) { segment = 0; cycle++; }
    }

    double elapsedSeconds(long nowMs) { return Math.max(0, nowMs - startedMs) / 1000.0; }
}
