package com.bearpoint.app;

/** Fix the first available repeated candidate; never invents confirmation. */
final class SdrFixedCwState {
    private int frequencyHz;
    private String source = "none";

    void reset() { frequencyHz=0; source="none"; }
    void choose(int listenHz, boolean available, int candidateHz, boolean remembered) {
        if (frequencyHz==0) { frequencyHz=listenHz; source="selected-frequency"; }
        if (source.equals("selected-frequency") && available) {
            frequencyHz=candidateHz; source=remembered ? "remembered" : "repeated-candidate";
        }
    }
    int frequencyHz() { return frequencyHz; }
    String source() { return source; }
}
