package com.bearpoint.app;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

/** Worker-owned scan planning and generic RF candidate detection, not beacon identification. */
final class SdrScan {
    static final int SETTLE_MS = 200;
    static final int MAX_CANDIDATES = 100;
    final int startHz, endHz, rate, dwellMs;
    final double thresholdDb;
    final String band;
    final int[] centers;
    private final List<Candidate> candidates = new ArrayList<>();
    private int nextId = 1;
    private static final int FM_FRAMES = 4;
    private final double[][] fmPower = new double[FM_FRAMES][];
    private final double[] fmFloor = new double[FM_FRAMES];
    private int fmCount, fmNext, fmCenter, fmRate;
    private double fmFirstSeconds, fmLastSeconds = -1;

    // A new tuning interval must not inherit the previous interval's noise or RF history.
    void beginSegment() {
        fmCount = fmNext = 0;
        fmLastSeconds = -1;
        Arrays.fill(fmPower, null);
    }

    SdrScan(String band, int startHz, int endHz, int rate, int dwellMs, double thresholdDb) {
        if (!SdrSettings.validFrequency(band, startHz) || !SdrSettings.validFrequency(band, endHz)
            || endHz - startHz < 100000 || !SdrSettings.validRate(rate)
            || dwellMs < 500 || dwellMs > 5000 || !Double.isFinite(thresholdDb)
            || thresholdDb < 6 || thresholdDb > 30) throw new IllegalArgumentException("탐색 범위와 고급 설정을 확인하세요. 최소 탐색 폭은 0.100 MHz입니다.");
        this.band = band; this.startHz = startHz; this.endHz = endHz;
        this.rate = rate; this.dwellMs = dwellMs; this.thresholdDb = thresholdDb;
        // Neighbouring windows cover each other's excluded DC bins and outer edges.
        int hop = (int) (rate * .35);
        int intervals = (int) Math.ceil((endHz - startHz) / (double) hop);
        centers = new int[intervals + 1];
        for (int i = 0; i <= intervals; i++) centers[i] = (int) Math.round(startHz + (endHz - startHz) * (i / (double) intervals));
    }

    double cycleSeconds() { return centers.length * (dwellMs + SETTLE_MS) / 1000.0; }

    static final class Candidate {
        int id, frequencyHz, observations, lastSeenCycle, confirmedCycle;
        double powerDbfs, snrDb, lastSeenSeconds;
    }

    List<Candidate> confirmed() {
        List<Candidate> result = new ArrayList<>();
        for (Candidate c : candidates) if (c.observations >= 2) result.add(c);
        Collections.sort(result, (a, b) -> Integer.compare(a.frequencyHz, b.frequencyHz));
        return result;
    }

    void observe(double[] bins, int centerHz, int actualRate, double seconds) {
        observe(bins, centerHz, actualRate, seconds, 1);
    }

    void observe(double[] bins, int centerHz, int actualRate, double seconds, int cycle) {
        if (bins == null || bins.length != SdrSpectrum.SIZE || actualRate <= 0) return;
        boolean fm = "fm".equals(band);
        if (fm) {
            bins = averageFm(bins, centerHz, actualRate, seconds);
            if (bins == null) return;
        }
        for (int i = candidates.size() - 1; i >= 0; i--) {
            Candidate c = candidates.get(i);
            if (c.observations < 2 && seconds - c.lastSeenSeconds > 5) candidates.remove(i);
        }
        double[] floor = new double[bins.length]; int count = 0;
        for (int i = 0; i < bins.length; i++) {
            if (usable(i) && Double.isFinite(bins[i])) floor[count++] = bins[i];
        }
        if (count < 32) return;
        Arrays.sort(floor, 0, count);
        double noise = floor[count / 2];
        if (noise <= -119) return; // Silence/invalid input must not look like RF.
        double breadthDb = Math.max(6, thresholdDb - 4);
        double limit = noise + (fm ? breadthDb : thresholdDb);
        int mergeHz = "fm".equals(band) ? 100000 : Math.max(10000, actualRate / SdrSpectrum.SIZE * 4);
        // Short gaps within a modulated channel do not create dozens of candidates.
        for (int i = 0; i < bins.length; i++) {
            if (!usable(i) || !Double.isFinite(bins[i]) || bins[i] < limit) continue;
            int gaps = 0;
            int firstBin = i, lastBin = i, occupied = 0;
            double peak = bins[i], weighted = 0, weight = 0;
            for (; i < bins.length && usable(i); i++) {
                if (!Double.isFinite(bins[i]) || bins[i] < limit || (fm && !persistentFm(i, breadthDb))) {
                    if (++gaps > 8) break;
                    continue;
                }
                gaps = 0; peak = Math.max(peak, bins[i]);
                if (occupied == 0) firstBin = i;
                lastBin = i; occupied++;
                double p = Math.pow(10, (bins[i] - noise) / 10);
                weighted += i * p; weight += p;
            }
            if (weight == 0) continue;
            if (fm) {
                double binHz = actualRate / (double) bins.length;
                double widthHz = (lastBin - firstBin + 1) * binHz;
                // Broadcast-like occupied spectrum, not an isolated spur or a wide noise hump.
                if (peak < noise + thresholdDb || occupied * binHz < 30000
                    || widthHz > 300000 || occupied < (lastBin - firstBin + 1) * .35) continue;
            }
            // FM energy can favour one modulation lobe. Use the occupied band's midpoint,
            // rather than pull the listening frequency toward the strongest lobe.
            double channelBin = fm ? (firstBin + lastBin) / 2.0 : weighted / weight;
            int hz = (int) Math.round(centerHz + (channelBin - bins.length / 2.0) * actualRate / bins.length);
            if (hz < startHz || hz > endHz) continue;
            Candidate nearest = null;
            for (Candidate c : candidates) if (Math.abs((long)c.frequencyHz - hz) <= mergeHz
                && (nearest == null || Math.abs(c.frequencyHz - hz) < Math.abs(nearest.frequencyHz - hz))) nearest = c;
            if (nearest == null) {
                if (candidates.size() >= MAX_CANDIDATES) {
                    Candidate expired = null;
                    for (Candidate c : candidates) if ((c.observations < 2 || cycle - c.lastSeenCycle >= 3)
                        && (expired == null || c.lastSeenSeconds < expired.lastSeenSeconds)) expired = c;
                    if (expired == null) continue;
                    candidates.remove(expired);
                }
                nearest = new Candidate(); nearest.id = nextId++; nearest.frequencyHz = hz; candidates.add(nearest);
            }
            // Count only distinct spectra, not multiple lobes of one channel in a frame.
            if (nearest.observations == 0 || nearest.lastSeenSeconds != seconds) nearest.observations++;
            if (nearest.observations >= 2 && nearest.confirmedCycle == 0) nearest.confirmedCycle = cycle;
            nearest.frequencyHz = (int) Math.round(nearest.frequencyHz * .75 + hz * .25);
            nearest.powerDbfs = peak; nearest.snrDb = peak - noise; nearest.lastSeenSeconds = seconds;
            nearest.lastSeenCycle = cycle;
        }
    }

    private double[] averageFm(double[] bins, int centerHz, int rateHz, double seconds) {
        if (fmCount > 0 && (centerHz != fmCenter || rateHz != fmRate || seconds - fmLastSeconds > .6)) beginSegment();
        if (seconds == fmLastSeconds) return null;
        double[] floor = new double[bins.length]; int count = 0;
        for (int i = 0; i < bins.length; i++) if (usable(i) && Double.isFinite(bins[i])) floor[count++] = bins[i];
        if (count < 700) { beginSegment(); return null; }
        Arrays.sort(floor, 0, count);
        if (floor[count / 2] <= -119) { beginSegment(); return null; }
        if (fmCount == 0) fmFirstSeconds = seconds;
        fmCenter = centerHz; fmRate = rateHz; fmLastSeconds = seconds;
        double[] power = new double[bins.length];
        for (int i = 0; i < bins.length; i++) power[i] = Double.isFinite(bins[i]) ? Math.pow(10, bins[i] / 10) : 0;
        fmPower[fmNext] = power; fmFloor[fmNext] = floor[count / 2];
        fmNext = (fmNext + 1) % FM_FRAMES;
        fmCount = Math.min(FM_FRAMES, fmCount + 1);
        if (fmCount < FM_FRAMES || seconds - fmFirstSeconds < .25) return null;
        double[] average = new double[bins.length];
        for (int i = 0; i < bins.length; i++) {
            double sum = 0;
            for (double[] frame : fmPower) sum += frame[i];
            average[i] = 10 * Math.log10(Math.max(1e-12, sum / FM_FRAMES));
        }
        return average;
    }

    private boolean persistentFm(int bin, double breadthDb) {
        int seen = 0;
        for (int i = 0; i < FM_FRAMES; i++) if (fmPower[i][bin] >= Math.pow(10, (fmFloor[i] + breadthDb) / 10)) seen++;
        return seen >= 3;
    }

    private static boolean usable(int bin) { return bin >= 103 && bin < 922 && Math.abs(bin - 512) > 4; }
}
