package com.bearpoint.app;
import androidx.annotation.Keep;

/** JNI-only payload; raw samples and PCM are never sent to the WebView. */
@Keep
final class SdrBlock {
    final double[] values;
    final short[] audio;
    final double signalPower;
    final double noisePower;
    SdrBlock(double[] values, short[] audio, double signalPower, double noisePower) {
        this.values = values; this.audio = audio; this.signalPower = signalPower; this.noisePower = noisePower;
    }
}
