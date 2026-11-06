package com.bearpoint.app;

import java.util.Arrays;

/** Streaming, pre-AGC CW pulse analysis. Never gates audio or changes receiver tuning.
 * The input is CwDemod's 48 kHz complex channel, not the display's peak-held FFT.
 * Detection confidence and noise-subtracted directional power are separate quantities.
 */
final class SdrCwDetector {
    static final String REVISION = "cw-pulse-v1";
    static final int RATE = 48000, SIZE = 2048, HOP = 256;
    // Restrict search to the verified central part of the existing CW filter.
    static final int SEARCH_HZ = 900;
    static final int[] WIDTH_BINS = {9, 17}; // 211 / 398 Hz; selected by evidence, not transmitter ID.
    static final double ENTER_DB = 6, LEAVE_DB = 2.5;
    static final double MIN_PULSE_MS = 8, MAX_PULSE_MS = 450;
    static final long HOLD_MS = 350, TRACK_MS = 5000;
    private static final int CENTERS = 39, CANDIDATES = CENTERS * 2, HISTORY = 256;
    private final double[] ringI = new double[SIZE], ringQ = new double[SIZE];
    private final long[] sourceSequences = new long[SIZE];
    private final double[] real = new double[SIZE], imag = new double[SIZE], window = new double[SIZE];
    private final double[] cos = new double[SIZE / 2], sin = new double[SIZE / 2];
    private final int[] reverse = new int[SIZE];
    private final double[] powers = new double[SIZE], correction = new double[SIZE];
    private final double[] floors = new double[CANDIDATES], bands = new double[CANDIDATES];
    private final double[] candidateNoise = new double[CANDIDATES];
    private final double[][] history = new double[CANDIDATES][HISTORY];
    private final double[] sort = new double[256], neighbors = new double[64], broadbandHistory = new double[HISTORY];
    private final double normalization;
    private int position, filled, hop, frames, historyPosition, historyCount;
    private boolean active, blocked;
    private boolean runAssisted,lastAssisted;
    private double runStart, runPeakTime, runPeakSnr, runSignal, runNoise, runBand, runOffset;
    private int runCandidate;
    private long runSequence;
    private double lastPulseTime = Double.NEGATIVE_INFINITY, lastOffset, lastSignal, lastNoise, lastBand, lastSnr;
    private double lastWidth, lastDuration, lastInterval;
    private double periodMs, runDirectionSignal, runDirectionNoise, lastDirectionSignal, lastDirectionNoise;
    private double broadbandFloor, broadbandRiseDb, runBroadbandRise;
    private long lastSequence;
    private int pulseCount, repeated;
    private double analyzedTime, frameBestSnr = Double.NaN, frameBestOffset;
    private double frameStartMs, frameEndMs;

    SdrCwDetector(int inputRate) {
        double sum = 0;
        double alpha = 1 - Math.exp(-2 * Math.PI * 2500 / inputRate), pole = 1 - alpha;
        for (int i = 0; i < SIZE; i++) {
            window[i] = .5 - .5 * Math.cos(2 * Math.PI * i / SIZE);
            sum += window[i] * window[i];
            reverse[i] = Integer.reverse(i) >>> (32 - 11);
            double f = signed(i) * RATE / (double) SIZE;
            // Known channel response only: this restores power convention, not lost RF SNR.
            double d = 1 + pole * pole - 2 * pole * Math.cos(2 * Math.PI * f / inputRate);
            correction[i] = Math.pow(d / (alpha * alpha), 4);
        }
        normalization = 2 * SIZE * sum; // Integrated mean(|I+jQ|^2)/2 convention.
        for (int i = 0; i < SIZE / 2; i++) {
            cos[i] = Math.cos(-2 * Math.PI * i / SIZE); sin[i] = Math.sin(-2 * Math.PI * i / SIZE);
        }
    }

    void observe(double[] iq, long sequence, double receivedMs) {
        if (iq == null || iq.length % 2 != 0) return;
        int count = iq.length / 2;
        for (int i = 0; i < count; i++) {
            double vi = iq[i * 2], vq = iq[i * 2 + 1];
            if (!Double.isFinite(vi) || !Double.isFinite(vq)) continue;
            ringI[position] = vi; ringQ[position] = vq;
            sourceSequences[position] = sequence;
            position = (position + 1) % SIZE; filled = Math.min(SIZE, filled + 1);
            if (++hop < HOP) continue;
            hop = 0;
            if (filled < SIZE) continue;
            double time = receivedMs - (count - i - 1 + SIZE / 2.0) * 1000 / RATE;
            analyze(time, sourceSequences[(position + SIZE / 2) % SIZE]);
        }
    }

    private static int signed(int bin) { return bin < SIZE / 2 ? bin : bin - SIZE; }
    private static int bin(int signed) { return (signed + SIZE) % SIZE; }
    private static int center(int candidate) { return (candidate / 2 - CENTERS / 2) * 2; }
    private static double db(double power) { return 10 * Math.log10(Math.max(1e-20, power)); }

    private void analyze(double time, long sequence) {
        analyzedTime = time; frameEndMs = time + SIZE * 500.0 / RATE;
        frameStartMs = time - SIZE * 500.0 / RATE;
        for (int i = 0; i < SIZE; i++) {
            int src = (position + i) % SIZE;
            real[reverse[i]] = ringI[src] * window[i]; imag[reverse[i]] = ringQ[src] * window[i];
        }
        for (int length = 2; length <= SIZE; length *= 2) {
            int half = length / 2, stride = SIZE / length;
            for (int start = 0; start < SIZE; start += length) for (int j = 0; j < half; j++) {
                int l = start + j, r = l + half, tw = j * stride;
                double re = cos[tw] * real[r] - sin[tw] * imag[r], im = cos[tw] * imag[r] + sin[tw] * real[r];
                real[r] = real[l] - re; imag[r] = imag[l] - im; real[l] += re; imag[l] += im;
            }
        }
        for (int i = 0; i < SIZE; i++) powers[i] = (real[i] * real[i] + imag[i] * imag[i]) / normalization * correction[i];
        int broadbandBins = 0;
        for(int j=-85;j<=85;j++) sort[broadbandBins++]=powers[bin(j)];
        Arrays.sort(sort,0,broadbandBins);double broadband=sort[broadbandBins/2];
        if(historyCount>=96 && frames%10==0){
            System.arraycopy(broadbandHistory,0,sort,0,historyCount);Arrays.sort(sort,0,historyCount);
            broadbandFloor=sort[historyCount/2];
        }
        broadbandRiseDb=broadbandFloor>0?db(broadband/broadbandFloor):0;
        for (int c = 0; c < CANDIDATES; c++) {
            int mid = center(c), half = WIDTH_BINS[c % 2] / 2; double total = 0;
            for (int j = mid - half; j <= mid + half; j++) total += powers[bin(j)];
            bands[c] = total;
        }
        // Median is refreshed about every 53 ms; histories cover ~1.37 seconds.
        if (historyCount >= 96 && frames % 10 == 0) for (int c = 0; c < CANDIDATES; c++) {
            System.arraycopy(history[c], 0, sort, 0, historyCount); Arrays.sort(sort, 0, historyCount);
            floors[c] = sort[historyCount / 2];
        }
        for (int c = 0; c < CANDIDATES; c += 2) {
            int mid = center(c), used = 0;
            for (int d = 14; d < 38; d++) { neighbors[used++] = powers[bin(mid - d)]; neighbors[used++] = powers[bin(mid + d)]; }
            Arrays.sort(neighbors, 0, used);
            double local = neighbors[used / 2] / Math.log(2);
            candidateNoise[c] = Math.max(floors[c], local * WIDTH_BINS[0]);
            candidateNoise[c + 1] = Math.max(floors[c + 1], local * WIDTH_BINS[1]);
        }
        int best = -1, strongestTest = -1; double bestSnr = -100, bestSignal = -1, strongestTestSnr = -100;
        boolean locked = repeated >= 2 && time - lastPulseTime < TRACK_MS;
        double elapsed = time - lastPulseTime;
        double cycles = periodMs > 0 ? Math.max(1, Math.rint(elapsed / periodMs)) : 0;
        // Learned cadence only assists weak recovery; strong/first pulses need no repetition.
        // No transmitter-specific 1.52 s constant, and quiet gaps may span missing pulses.
        boolean nearExpected = locked && periodMs > 150 && cycles <= 6 &&
                Math.abs(elapsed - cycles * periodMs) < Math.max(60, periodMs * .15);
        double enter = nearExpected ? 4.5 : ENTER_DB;
        if(broadbandRiseDb>6)enter=Math.max(12,enter);
        if (ready()) for (int c = 0; c < CANDIDATES; c++) {
            double snr = snr(c);
            // Hold the candidate frequency across quiet gaps; do not hop to each noise maximum.
            if (locked && Math.abs(center(c) * RATE / (double) SIZE - lastOffset) > 150) continue;
            int mid = center(c), half = WIDTH_BINS[c % 2] / 2, peak = mid;
            for (int j = mid - half; j <= mid + half; j++) if (powers[bin(j)] > powers[bin(peak)]) peak = j;
            // A band edge containing a different tone must not become its own CW candidate.
            if (Math.abs(peak - mid) > 1 || Math.abs(peak * RATE / (double) SIZE) > SEARCH_HZ) continue;
            if(snr>strongestTestSnr){strongestTest=c;strongestTestSnr=snr;}
            double signal = bands[c] - noise(c);
            if (snr >= enter && signal > bestSignal) { best = c; bestSnr = snr; bestSignal = signal; }
        }
        frameBestSnr = strongestTest < 0 ? Double.NaN : strongestTestSnr;
        frameBestOffset = strongestTest < 0 ? 0 : center(strongestTest) * RATE / (double) SIZE;
        if (!active) {
            if (best < 0) blocked = false;
            if (!blocked && best >= 0 && time - lastPulseTime > 120) {
                active = true; runStart = time; runCandidate = best; runPeakSnr = -100;runBroadbandRise=broadbandRiseDb;
                runAssisted=nearExpected;
                peak(best, time, sequence);
            }
        } else {
            runBroadbandRise=Math.max(runBroadbandRise,broadbandRiseDb);
            if (best >= 0 && bestSignal > runSignal * 2 && best != runCandidate) {
                runCandidate = best; runPeakSnr = -100;
            }
            double current = snr(runCandidate);
            if (current >= LEAVE_DB) {
                peak(runCandidate, time, sequence);
                if (time - runStart > MAX_PULSE_MS) { active = false; blocked = true; }
            } else {
                double duration = time - runStart;
                double minimum=runAssisted?HOP*1000.0/RATE:MIN_PULSE_MS;
                if (duration+1e-6 >= minimum && duration <= MAX_PULSE_MS &&
                        (runBroadbandRise<=6 || runPeakSnr>=12)) accept(duration);
                active = false;
            }
        }
        // Short pulses are a minority of this median history; long carriers become baseline.
        for (int c = 0; c < CANDIDATES; c++) history[c][historyPosition] = bands[c];
        historyPosition = (historyPosition + 1) % HISTORY;
        broadbandHistory[(historyPosition+HISTORY-1)%HISTORY]=broadband;
        historyCount = Math.min(HISTORY, historyCount + 1); frames++;
    }

    private double snr(int candidate) { return db(Math.max(0, bands[candidate] - noise(candidate)) / Math.max(1e-20, noise(candidate))); }
    private double noise(int candidate) { return candidateNoise[candidate]; }
    private void peak(int c, double time, long sequence) {
        double noise = noise(c), snr = db(Math.max(0, bands[c] - noise) / Math.max(1e-20, noise));
        if (snr <= runPeakSnr) return;
        runPeakSnr = snr; runPeakTime = time; runSequence = sequence;
        runNoise = noise; runBand = bands[c]; runSignal = Math.max(0, runBand - noise);
        // Direction comparisons ALWAYS use 17 bins, regardless of detection bandwidth.
        int reference = c | 1;
        runDirectionNoise = noise(reference);
        runDirectionSignal = Math.max(0, bands[reference] - runDirectionNoise);
        int mid = center(c), half = WIDTH_BINS[c % 2] / 2, peak = mid;
        for (int j = mid - half; j <= mid + half; j++) if (powers[bin(j)] > powers[bin(peak)]) peak = j;
        runOffset = peak * RATE / (double) SIZE;
    }
    private void accept(double duration) {
        double interval = runPeakTime - lastPulseTime;
        repeated = interval >= 150 && interval <= 10000 && Math.abs(runOffset - lastOffset) <= 150 ? repeated + 1 : 1;
        if (repeated == 1) periodMs = 0;
        else if (periodMs <= 0) periodMs = interval;
        else {
            double cycles = Math.max(1, Math.rint(interval / periodMs));
            if (Math.abs(interval - cycles * periodMs) < periodMs * .25)
                periodMs += .2 * (interval / cycles - periodMs);
        }
        pulseCount++; lastPulseTime = runPeakTime; lastOffset = runOffset;
        lastSignal = runSignal; lastNoise = runNoise; lastBand = runBand; lastSnr = runPeakSnr;
        lastSequence = runSequence; lastWidth = WIDTH_BINS[runCandidate % 2] * RATE / (double) SIZE;
        lastDuration = duration; lastInterval = Double.isFinite(interval) ? interval : 0;
        lastAssisted=runAssisted;
        lastDirectionSignal = runDirectionSignal; lastDirectionNoise = runDirectionNoise;
    }

    boolean ready() { return floors[0] > 0; }
    int pulseCount() { return pulseCount; }
    boolean recent() { return analyzedTime - lastPulseTime <= HOLD_MS; }
    boolean tracked() { return analyzedTime - lastPulseTime <= TRACK_MS; }
    double offsetHz() { return lastOffset; }
    double signalDbfs() { return db(lastSignal); }
    double noiseDbfs() { return db(lastNoise); }
    double bandDbfs() { return db(lastBand); }
    double directionDbfs() { return db(lastDirectionSignal); }
    double directionNoiseDbfs() { return db(lastDirectionNoise); }
    double directionWidthHz() { return WIDTH_BINS[1] * RATE / (double) SIZE; }
    double snrDb() { return lastSnr; }
    double widthHz() { return lastWidth; }
    double pulseTimeMs() { return lastPulseTime; }
    long pulseSequence() { return lastSequence; }
    double pulseDurationMs() { return lastDuration; }
    double intervalMs() { return lastInterval; }
    double frameBestSnrDb() { return frameBestSnr; }
    double frameBestOffsetHz() { return frameBestOffset; }
    double broadbandRiseDb() { return broadbandRiseDb; }
    boolean assisted() { return lastAssisted; }
    double frameStartMs() { return frameStartMs; }
    double frameEndMs() { return frameEndMs; }
    int confidence() { return !tracked() ? 0 : repeated >= 2 ? 2 : 1; }
    // Fixed 6 dB directional-power steps. Relative dBFS, NOT calibrated IC-R30 S-units.
    static int directionLevel(double dbfs) { return !Double.isFinite(dbfs) ? 0 : Math.max(0, Math.min(10, 1 + (int)Math.floor((dbfs + 100) / 6))); }
    int level() { return recent() ? directionLevel(directionDbfs()) : 0; }
}
