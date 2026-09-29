package com.bearpoint.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class SdrSettingsTest {
    @Test public void wfmNeedsAnInBandChannelAndEnoughFilterMargin() {
        assertTrue(SdrSettings.validDemodulation("wfm", "fm", 103300000, 103500000, 1024000, 75));
        assertTrue(SdrSettings.validDemodulation("wfm", "fm", 103500000, 103500000, 250000, 50));
        assertFalse(SdrSettings.validDemodulation("wfm", "fm", 103300000, 103500000, 250000, 75));
        assertFalse(SdrSettings.validDemodulation("wfm", "fm", 103300000, 104000000, 1024000, 75));
        assertFalse(SdrSettings.validDemodulation("wfm", "vhf", 150000000, 150000000, 1024000, 75));
        assertFalse(SdrSettings.validDemodulation("wfm", "fm", 108000000, 108000001, 1024000, 75));
        assertFalse(SdrSettings.validDemodulation("wfm", "fm", 103300000, 103500000, 1024000, 0));
        assertFalse(SdrSettings.validDemodulation("nfm", "vhf", 150000000, 150000000, 1024000, 75));
        assertTrue(SdrSettings.validDemodulation("iq", "vhf", 150000000, 150000000, 1024000, 75));
    }
    @Test public void fmAndVhfBoundsRequireTheMatchingBand() {
        assertTrue(SdrSettings.validFrequency("fm", 103500000));
        assertTrue(SdrSettings.validFrequency("fm", 88000000));
        assertTrue(SdrSettings.validFrequency("fm", 108000000));
        assertFalse(SdrSettings.validFrequency("fm", 87999999));
        assertFalse(SdrSettings.validFrequency("fm", 108000001));
        assertTrue(SdrSettings.validFrequency("vhf", 148000000));
        assertTrue(SdrSettings.validFrequency("vhf", 174000000));
        assertFalse(SdrSettings.validFrequency("vhf", 103500000));
        assertFalse(SdrSettings.validFrequency("fm", 150000000));
        assertFalse(SdrSettings.validFrequency("vhf", 147999999));
        assertFalse(SdrSettings.validFrequency("vhf", 174000001));
        assertFalse(SdrSettings.validFrequency("vhf", 125000000));
        assertFalse(SdrSettings.validFrequency("unknown", 103500000));
        assertFalse(SdrSettings.validFrequency(null, 103500000));
    }

    @Test public void sampleRatePresetsExcludeTheResamplerGapAndLossyHighRates() {
        for (int rate : new int[] {250000, 1024000, 1536000, 2048000, 2400000}) {
            assertTrue(SdrSettings.validRate(rate));
        }
        for (int rate : new int[] {-1, 0, 225000, 512000, 900000, 2400001, 3200000}) {
            assertFalse(SdrSettings.validRate(rate));
        }
    }
}
