package com.bearpoint.app;

/** Shifts demodulated receiver audio into the CW detector's baseband search window. */
final class IcR30AudioAnalysis {
    static final int RATE = SdrCwDetector.RATE;
    static final int BLOCK = RATE / 50;
    static final int CENTER_HZ = 1200;
    private static final int MIX_PERIOD = RATE / CENTER_HZ;
    private final double[] cos = new double[MIX_PERIOD], sin = new double[MIX_PERIOD];
    private final double[] iq = new double[BLOCK * 2];
    final SdrCwDetector detector = SdrCwDetector.forAudio();
    private int phase;
    private long sequence;

    IcR30AudioAnalysis() {
        for (int i = 0; i < MIX_PERIOD; i++) {
            double angle = -2 * Math.PI * i / MIX_PERIOD;
            cos[i] = Math.cos(angle);
            sin[i] = Math.sin(angle);
        }
    }

    void observe(short[] audio, long timeMs) {
        for (int i = 0; i < BLOCK; i++) {
            double sample = audio[i] / 32768.0;
            iq[2 * i] = sample * cos[phase];
            iq[2 * i + 1] = sample * sin[phase];
            phase = (phase + 1) % MIX_PERIOD;
        }
        detector.observe(iq, ++sequence, timeMs);
    }
}
