package com.bearpoint.app;

/** Playback-only filter. Capture samples and the CW detector stay independent of listening settings. */
final class IcR30AudioFilter {
    private static final int RATE = IcR30AudioAnalysis.RATE;
    private static final double[] BAND_MIX = {0, .65, .88, .97};
    private static final double[] TONE_MIX = {0, .55, .80, .96};
    private static final double[] TONE_WIDTH = {0, 450, 250, 115};
    private final Biquad highPass = new Biquad(), lowPass = new Biquad(), tone = new Biquad();
    private double bandMix, toneMix, toneHz;
    private int toneLevel;

    IcR30AudioFilter() {
        highPass.configure(260, .707, 1);
        lowPass.configure(2250, .707, -1);
    }

    short[] process(short[] input, int level, double candidateHz) {
        if (level == 0 && bandMix == 0) return input.clone();
        boolean follow = level > 0 && candidateHz >= 300 && candidateHz <= 2100;
        if (follow && (Math.abs(candidateHz - toneHz) >= 45 || toneLevel != level)) {
            if (Math.abs(candidateHz - toneHz) >= 45) {
                tone.reset();
                toneMix = 0;
            }
            toneHz = candidateHz;
            toneLevel = level;
            tone.configure(toneHz, toneHz / TONE_WIDTH[level], 0);
        }
        double targetToneMix = follow ? TONE_MIX[level] : 0;
        double bandStep = (BAND_MIX[level] - bandMix) / input.length;
        double toneStep = (targetToneMix - toneMix) / input.length;
        short[] output = new short[input.length];
        for (int i = 0; i < input.length; i++) {
            bandMix += bandStep;
            toneMix += toneStep;
            double sample = input[i];
            double broad = lowPass.apply(highPass.apply(sample));
            double filtered = sample + bandMix * (broad - sample);
            if (toneHz > 0) filtered += toneMix * (tone.apply(sample) - filtered);
            output[i] = (short) Math.max(Short.MIN_VALUE, Math.min(Short.MAX_VALUE, Math.round(filtered)));
        }
        bandMix = BAND_MIX[level];
        toneMix = targetToneMix;
        return output;
    }

    private static final class Biquad {
        private double b0, b1, b2, a1, a2, z1, z2;

        // mode: +1 high-pass, -1 low-pass, 0 unity-gain band-pass.
        void configure(double hz, double q, int mode) {
            double angle = 2 * Math.PI * hz / RATE;
            double cosine = Math.cos(angle), alpha = Math.sin(angle) / (2 * q);
            double scale = 1 / (1 + alpha);
            a1 = -2 * cosine * scale;
            a2 = (1 - alpha) * scale;
            if (mode == 0) {
                b0 = alpha * scale;
                b1 = 0;
                b2 = -b0;
            } else {
                b0 = (1 + mode * cosine) * .5 * scale;
                b1 = -2 * mode * b0;
                b2 = b0;
            }
        }

        double apply(double input) {
            double output = b0 * input + z1;
            z1 = b1 * input - a1 * output + z2;
            z2 = b2 * input - a2 * output;
            return output;
        }

        void reset() { z1 = z2 = 0; }
    }
}
