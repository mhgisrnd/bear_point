package com.bearpoint.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class IcR30AudioFilterTest {
    private static short[] input() {
        short[] block = new short[IcR30AudioAnalysis.BLOCK];
        for (int i = 0; i < block.length; i++) {
            double phase = 2 * Math.PI * i / IcR30AudioAnalysis.RATE;
            block[i] = (short) (4000 * (Math.sin(700 * phase) + Math.sin(1400 * phase) + Math.sin(4000 * phase)));
        }
        return block;
    }

    private static double amplitude(short[] block, int hz) {
        double real = 0, imag = 0;
        for (int i = 0; i < block.length; i++) {
            double phase = 2 * Math.PI * hz * i / IcR30AudioAnalysis.RATE;
            real += block[i] * Math.cos(phase);
            imag += block[i] * Math.sin(phase);
        }
        return 2 * Math.hypot(real, imag) / block.length;
    }

    @Test public void strongerTrackingPreservesBeaconAndReducesOtherTones() {
        short[] pcm = input();
        double previousInterference = amplitude(pcm, 1400);
        for (int level = 1; level <= 3; level++) {
            IcR30AudioFilter filter = new IcR30AudioFilter();
            short[] filtered = pcm;
            for (int i = 0; i < 12; i++) filtered = filter.process(pcm, level, 700);
            assertTrue(amplitude(filtered, 700) > .85 * amplitude(pcm, 700));
            double interference = amplitude(filtered, 1400);
            assertTrue(interference < previousInterference);
            previousInterference = interference;
        }
        assertTrue(previousInterference < .15 * amplitude(pcm, 1400));
        assertArrayEquals(input(), pcm);
    }

    @Test public void broadFilterKeepsAnUnknownBeaconAndReturningToRawBypassesFilter() {
        short[] pcm = input();
        IcR30AudioFilter filter = new IcR30AudioFilter();
        assertArrayEquals(pcm, filter.process(pcm, 0, 0));
        short[] filtered = pcm;
        for (int i = 0; i < 12; i++) filtered = filter.process(pcm, 3, 0);
        assertTrue(amplitude(filtered, 700) > .85 * amplitude(pcm, 700));
        assertTrue(amplitude(filtered, 4000) < .4 * amplitude(pcm, 4000));
        filter.process(pcm, 0, 700);
        assertArrayEquals(pcm, filter.process(pcm, 0, 700));
    }
}
