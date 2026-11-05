package com.bearpoint.app;

/** Relative CW channel strength, independent of listening gain and beacon classification.
 * This is an empirical display curve, not a calibrated IC-R30 S-unit conversion. */
final class SdrSignalStrength {
    static final String REVISION = "cw-channel-relative-v2";
    static final long PEAK_HOLD_MS = 350;
    // A small noise guard, then finer low-level steps and progressively wider strong-signal steps.
    private static final double[] STEPS_DB = {3, 3.5, 5, 7, 10, 14, 19, 25, 32, 40};
    private int displayed;
    private long heldUntil;
    private double heldExcess;
    private boolean holding;

    static int level(double excessDb) {
        if (!Double.isFinite(excessDb)) return 0;
        int level = 0;
        for (double threshold : STEPS_DB) { if (excessDb < threshold) break; level++; }
        return level;
    }

    void observe(double peak, double noise, long now) {
        if (peak < 0 || noise <= 0 || !Double.isFinite(peak) || !Double.isFinite(noise)) {
            displayed = 0; holding = false; heldUntil = 0; heldExcess = 0; return;
        }
        double excess = Math.max(0, 10 * Math.log10(Math.max(1e-12, peak) / Math.max(1e-12, noise)));
        int current = level(excess);
        if (current > 0 && current >= displayed) {
            displayed = current; heldExcess = excess; heldUntil = now + PEAK_HOLD_MS;
        } else if (now >= heldUntil) {
            displayed = current; heldExcess = excess;
        }
        holding = displayed > current;
    }
    int displayed() { return displayed; }
    boolean holding() { return holding; }
    double heldExcess() { return heldExcess; }
}
