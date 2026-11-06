package com.bearpoint.app;
import androidx.annotation.Keep;

/** JNI-only payload; raw samples and PCM are never sent to the WebView. */
@Keep
final class SdrBlock {
    final double[] values;
    final short[] audio;
    final double[] channelIq;
    final double[] diagnostic;
    final byte[] rawIq;
    final double signalPower;
    final double noisePower;
    SdrBlock(double[] values, short[] audio, double signalPower, double noisePower, double[] channelIq, double[] diagnostic, byte[] rawIq) {
        this.values = values; this.audio = audio; this.signalPower = signalPower; this.noisePower = noisePower;
        this.channelIq = channelIq;
        this.diagnostic = diagnostic;
        this.rawIq = rawIq;
    }
}
