package com.bearpoint.app;

/** All calls and the authorized USB descriptor are owned by one SDR worker. */
final class SdrNative {
    static { System.loadLibrary("bear_sdr"); }
    static native long open(int fd, int frequencyHz, int sampleRate, int gainTenthsDb, int ppm);
    static native double[] describeTuner(long handle);
    static native void startStreaming(long handle);
    static native int[] diagnosticRegisters(long handle);
    static native SdrBlock read(long handle, boolean captureSpectrum, long demodulator, boolean continuousSpectrum);
    static native void tune(long handle, int frequencyHz);
    static native long createDemodulator(String mode, int sampleRate, int offsetHz, int deemphasisUs);
    static native void closeDemodulator(long handle);
    static native void setAudioGain(long handle, int db);
    static native void close(long handle);
}
