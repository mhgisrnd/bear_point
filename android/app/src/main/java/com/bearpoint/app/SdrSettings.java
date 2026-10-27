package com.bearpoint.app;

/** Device settings accepted by the native bridge as well as the UI. */
final class SdrSettings {
    static boolean validFrequency(String band, int hz) {
        if ("wide".equals(band)) return hz >= 100000 && hz <= 2000000000;
        if ("fm".equals(band)) return hz >= 88000000 && hz <= 108000000;
        if ("vhf".equals(band)) return hz >= 140000000 && hz <= 174000000;
        return false;
    }

    static boolean validRate(int rate) {
        // librtlsdr excludes 300001–900000 Hz and warns of loss above 2.4 MS/s.
        return rate == 250000 || rate == 1024000 || rate == 1536000
            || rate == 2048000 || rate == 2400000;
    }

    static boolean validDemodulation(String mode, String band, int center, int listen, int rate, int deemphasis) {
        if ("iq".equals(mode)) return true;
        if ("cw".equals(mode)) return validFrequency(band, center) && validFrequency(band, listen)
            && Math.abs((long) listen - center) + 5000 <= rate * .45;
        return "wfm".equals(mode) && validFrequency(band, center) && validFrequency(band, listen)
            && Math.abs((long) listen - center) + 100000 <= rate * .45
            && (deemphasis == 50 || deemphasis == 75);
    }
}
