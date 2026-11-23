package com.bearpoint.app;

import java.util.Arrays;

/** Peak envelope measured on the saved PCM sample clock. */
final class SdrRecordedAudioPeaks {
    static final int INTERVAL_MS = 100;
    private final int samplesPerPoint;
    private final int sampleLimit;
    private final int[] peaks;
    private int samples;

    SdrRecordedAudioPeaks(int sampleRate, long durationMs) {
        samplesPerPoint = sampleRate * INTERVAL_MS / 1000;
        sampleLimit = (int) (sampleRate * durationMs / 1000);
        peaks = new int[(sampleLimit + samplesPerPoint - 1) / samplesPerPoint];
    }

    void reset() {
        Arrays.fill(peaks, 0);
        samples = 0;
    }

    void append(short[] pcm, int offset, int length) {
        int end = offset + Math.min(length, sampleLimit - samples);
        while (offset < end) {
            int bucket = samples / samplesPerPoint;
            int count = Math.min(end - offset, samplesPerPoint - samples % samplesPerPoint);
            int peak = peaks[bucket];
            for (int i = offset; i < offset + count; i++) peak = Math.max(peak, Math.abs(pcm[i]));
            peaks[bucket] = peak;
            samples += count;
            offset += count;
        }
    }

    int[] snapshot() {
        return Arrays.copyOf(peaks, (samples + samplesPerPoint - 1) / samplesPerPoint);
    }
}
