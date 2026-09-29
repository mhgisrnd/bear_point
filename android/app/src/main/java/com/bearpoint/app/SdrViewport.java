package com.bearpoint.app;

/** Insets that actually overlap the WebView, in CSS pixels. Rectangles are L/T/R/B. */
final class SdrViewport {
    static double[] overlap(int[] window, int[] content, int[] insets, double density) {
        if (density <= 0 || content[2] <= content[0] || content[3] <= content[1]) return new double[4];
        return new double[]{
            Math.max(0, window[0] + insets[0] - content[0]) / density,
            Math.max(0, window[1] + insets[1] - content[1]) / density,
            Math.max(0, content[2] - (window[2] - insets[2])) / density,
            Math.max(0, content[3] - (window[3] - insets[3])) / density
        };
    }
}
