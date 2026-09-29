package com.bearpoint.app;
import androidx.annotation.Keep;

/** JNI-only payload; raw samples and PCM are never sent to the WebView. */
@Keep
final class SdrBlock {
    final double[] values;
    final short[] audio;
    SdrBlock(double[] values, short[] audio) { this.values = values; this.audio = audio; }
}
