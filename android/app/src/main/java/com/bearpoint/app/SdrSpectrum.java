package com.bearpoint.app;

/** Worker-owned FFT. Input is normalized, interleaved I/Q; output is fftshifted dBFS/bin. */
final class SdrSpectrum {
    static final int SIZE = 1024;
    static final int MAX_FRAMES = 4;
    private final double[] window = new double[SIZE];
    private final double[] real = new double[SIZE], imaginary = new double[SIZE];
    private final double[] cosine = new double[SIZE / 2], sine = new double[SIZE / 2];
    private final int[] reverse = new int[SIZE];
    private final double normalization;

    SdrSpectrum() {
        double sum = 0;
        for (int i = 0; i < SIZE; i++) {
            window[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / SIZE); // Periodic Hann.
            sum += window[i];
            reverse[i] = Integer.reverse(i) >>> (32 - 10);
        }
        for (int i = 0; i < SIZE / 2; i++) {
            cosine[i] = Math.cos(-2 * Math.PI * i / SIZE);
            sine[i] = Math.sin(-2 * Math.PI * i / SIZE);
        }
        // Same per-I/Q-component full-scale convention as the existing band-power metric.
        normalization = 2 * sum * sum;
    }

    double[] analyze(double[] iq, int offset) {
        if (iq == null || offset < 0 || offset > iq.length) return new double[0];
        int frames = Math.min(MAX_FRAMES, (iq.length - offset) / (2 * SIZE));
        if (frames == 0) return new double[0];
        double[] power = new double[SIZE];
        for (int frame = 0; frame < frames; frame++) {
            int base = offset + frame * 2 * SIZE;
            for (int i = 0; i < SIZE; i++) {
                real[reverse[i]] = iq[base + i * 2] * window[i];
                imaginary[reverse[i]] = iq[base + i * 2 + 1] * window[i];
            }
            for (int length = 2; length <= SIZE; length *= 2) {
                int half = length / 2, stride = SIZE / length;
                for (int start = 0; start < SIZE; start += length) {
                    for (int j = 0; j < half; j++) {
                        int left = start + j, right = left + half, twiddle = j * stride;
                        double tr = cosine[twiddle] * real[right] - sine[twiddle] * imaginary[right];
                        double ti = cosine[twiddle] * imaginary[right] + sine[twiddle] * real[right];
                        real[right] = real[left] - tr; imaginary[right] = imaginary[left] - ti;
                        real[left] += tr; imaginary[left] += ti;
                    }
                }
            }
            for (int i = 0; i < SIZE; i++) {
                int shifted = (i + SIZE / 2) % SIZE;
                power[shifted] += (real[i] * real[i] + imaginary[i] * imaginary[i]) / normalization;
            }
        }
        for (int i = 0; i < SIZE; i++) {
            power[i] = Math.max(-120, Math.min(0, 10 * Math.log10(Math.max(1e-12, power[i] / frames))));
        }
        return power;
    }
}
