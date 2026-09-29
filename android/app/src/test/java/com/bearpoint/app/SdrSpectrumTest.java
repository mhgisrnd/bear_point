package com.bearpoint.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class SdrSpectrumTest {
    private double[] tone(int bin, double amplitude, int frames, int prefix) {
        double[] iq = new double[prefix + frames * SdrSpectrum.SIZE * 2];
        for (int i = 0; i < frames * SdrSpectrum.SIZE; i++) {
            double phase = 2 * Math.PI * bin * i / SdrSpectrum.SIZE;
            iq[prefix + i * 2] = amplitude * Math.cos(phase);
            iq[prefix + i * 2 + 1] = amplitude * Math.sin(phase);
        }
        return iq;
    }

    private int peak(double[] spectrum) {
        int best = 0;
        for (int i = 1; i < spectrum.length; i++) if (spectrum[i] > spectrum[best]) best = i;
        return best;
    }

    @Test public void positiveAndNegativeTonesHaveTheCorrectFrequencyAndAmplitude() {
        SdrSpectrum fft = new SdrSpectrum();
        for (int bin : new int[] {-400, -123, 0, 123, 400}) {
            double[] spectrum = fft.analyze(tone(bin, 0.5, 4, 7), 7);
            assertEquals(SdrSpectrum.SIZE / 2 + bin, peak(spectrum));
            assertEquals(10 * Math.log10(0.5 * 0.5 / 2), spectrum[peak(spectrum)], 1e-8);
        }
    }

    @Test public void averagingUsesLinearPowerAndDoesNotDependOnFrameCount() {
        SdrSpectrum fft = new SdrSpectrum();
        double[] one = fft.analyze(tone(37, 0.25, 1, 0), 0);
        assertArrayEquals(one, fft.analyze(tone(37, 0.25, 4, 0), 0), 1e-7);
        double[] input = tone(37, 0.5, 2, 0);
        for (int i = SdrSpectrum.SIZE * 2; i < input.length; i++) input[i] = 0;
        double[] averaged = fft.analyze(input, 0);
        assertEquals(10 * Math.log10(0.5 * 0.5 / 4), averaged[512 + 37], 1e-8);
    }

    @Test public void hannWindowLimitsLeakageAwayFromAnOffBinTone() {
        double[] iq = new double[SdrSpectrum.SIZE * 2];
        for (int i = 0; i < SdrSpectrum.SIZE; i++) {
            double phase = 2 * Math.PI * 100.5 * i / SdrSpectrum.SIZE;
            iq[i * 2] = 0.5 * Math.cos(phase); iq[i * 2 + 1] = 0.5 * Math.sin(phase);
        }
        double[] spectrum = new SdrSpectrum().analyze(iq, 0);
        assertTrue(peak(spectrum) == 612 || peak(spectrum) == 613);
        assertTrue(spectrum[612] - spectrum[622] > 50);
    }

    @Test public void silenceAndIncompleteFramesNeverProduceInvalidValues() {
        SdrSpectrum fft = new SdrSpectrum();
        assertEquals(0, fft.analyze(new double[2047], 0).length);
        assertEquals(0, fft.analyze(null, 0).length);
        assertEquals(0, fft.analyze(new double[2048], -1).length);
        for (double bin : fft.analyze(new double[2048], 0)) assertEquals(-120, bin, 0);
    }
}
