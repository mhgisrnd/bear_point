package com.bearpoint.app;

/** Airspy HF+ operations run on the same receiver worker as RTL-SDR. */
final class AirspyNative {
    static { System.loadLibrary("bear_sdr"); }
    static native long open(int fd, int frequencyHz);
    static native int[] describe(long handle);
    static native void startStreaming(long handle);
    static native SdrBlock read(long handle, boolean capture, long demodulator);
    static native void close(long handle);
}
