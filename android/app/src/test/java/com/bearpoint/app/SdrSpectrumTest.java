package com.bearpoint.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class SdrSpectrumTest {
    @Test public void shortPulseSurvivesUntilNextDisplayAndThenDecays() {
        SdrSpectrum fft = new SdrSpectrum();
        SdrSpectrum.PeakHold hold = new SdrSpectrum.PeakHold();
        double[] input = tone(12, .5, 32, 7);
        // A one-frame pulse late in a USB block used to fall outside the captured four frames.
        for (int frame = 0; frame < 32; frame++) {
            if (frame == 20) continue;
            java.util.Arrays.fill(input, 7 + frame * 2048, 7 + (frame + 1) * 2048, 0);
        }
        double[] pulse = fft.analyzePeaks(input, 7);
        double[] first = hold.observe(pulse, 1000);
        double level = first[524];
        assertTrue(level > -10);
        double[] silence = fft.analyzePeaks(new double[2048], 0);
        assertEquals(level, hold.observe(silence, 1100)[524], 1e-8);
        assertEquals(level, hold.observe(silence, 1250)[524], 1e-8);
        assertEquals(level - 9, hold.observe(silence, 1500)[524], 1e-8);
        assertEquals(-120, hold.observe(silence, 5000)[524], 1e-8);
        assertEquals(level, first[524], 0); // Published snapshots cannot mutate later.
        assertEquals(-120, new SdrSpectrum.PeakHold().observe(silence, 1000)[524], 0);
    }

    @Test public void newPulseImmediatelyRaisesAHeldSpectrumWithoutAveragingItAway() {
        SdrSpectrum fft = new SdrSpectrum();
        SdrSpectrum.PeakHold hold = new SdrSpectrum.PeakHold();
        double low = hold.observe(fft.analyzePeaks(tone(-123, .05, 1, 0), 0), 0)[389];
        double high = hold.observe(fft.analyzePeaks(tone(-123, .5, 1, 0), 0), 100)[389];
        assertEquals(20, high - low, 1e-8);
        assertEquals(high, hold.observe(fft.analyzePeaks(new double[2048], 0), 349)[389], 0);
    }

    @Test public void continuousScanCapturesPulsesAfterTheFirstFourFrames() {
        double[] iq=tone(-159,.01,32,7);
        for(int i=0;i<32*SdrSpectrum.SIZE;i++) {
            if(i>=12*SdrSpectrum.SIZE && i<32*SdrSpectrum.SIZE) {
                double p=2*Math.PI*(-159)*i/SdrSpectrum.SIZE;
                iq[7+2*i]+=.4*Math.cos(p);iq[7+2*i+1]+=.4*Math.sin(p);
            }
        }
        SdrSpectrum fft=new SdrSpectrum();
        double old=fft.analyze(iq,7)[353], captured=fft.analyzePeaks(iq,7)[353];
        assertTrue(captured>old+25);
    }
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
