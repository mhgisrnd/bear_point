package com.bearpoint.app;

/** FFT of the existing pre-audio complex CW channel: 46.875 Hz/bin, target +/-3 kHz. */
final class SdrCwSpectrum {
    static final int BINS = 128;
    static final int SPAN_HZ = 6000;
    private final SdrSpectrum fft = new SdrSpectrum();
    private final SdrSpectrum.PeakHold hold = new SdrSpectrum.PeakHold(BINS);
    private final double[] frame = new double[SdrSpectrum.SIZE * 2];
    private int filled;

    double[] observe(double[] iq, long now) {
        if (iq == null) return new double[0];
        double[] peaks = null;
        for (int offset = 0; offset < iq.length;) {
            int count = Math.min(frame.length - filled, iq.length - offset);
            System.arraycopy(iq, offset, frame, filled, count);filled += count;offset += count;
            if (filled != frame.length) continue;
            double[] bins = fft.analyze(frame, 0);
            // Half-window overlap avoids hiding a short pulse at a Hann window boundary.
            System.arraycopy(frame, frame.length / 2, frame, 0, frame.length / 2);
            filled = frame.length / 2;
            if (peaks == null) { peaks = new double[BINS]; java.util.Arrays.fill(peaks, -120); }
            int first = (SdrSpectrum.SIZE - BINS) / 2;
            for (int i = 0; i < BINS; i++) peaks[i] = Math.max(peaks[i], bins[first + i]);
        }
        return peaks == null ? new double[0] : hold.observe(peaks, now);
    }
}
