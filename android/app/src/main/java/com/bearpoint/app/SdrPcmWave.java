package com.bearpoint.app;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;

final class SdrPcmWave {
    private SdrPcmWave() {}

    static byte[] mono16Header(int sampleRate, long pcmBytes) {
        return ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
            .put("RIFF".getBytes(StandardCharsets.US_ASCII)).putInt((int) (pcmBytes + 36))
            .put("WAVEfmt ".getBytes(StandardCharsets.US_ASCII)).putInt(16)
            .putShort((short) 1).putShort((short) 1)
            .putInt(sampleRate).putInt(sampleRate * 2).putShort((short) 2).putShort((short) 16)
            .put("data".getBytes(StandardCharsets.US_ASCII)).putInt((int) pcmBytes).array();
    }
}
