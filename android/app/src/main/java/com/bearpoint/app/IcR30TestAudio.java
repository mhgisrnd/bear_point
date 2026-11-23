package com.bearpoint.app;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;

/** Bounded PCM collected from the validated USB input during one S-Meter diagnostic. */
final class IcR30TestAudio {
    static final int RATE = IcR30AudioAnalysis.RATE;
    private final byte[] pcm = new byte[(int) (RATE * 2 * IcR30TestRecording.LIMIT_MS / 1000)];
    private final SdrRecordedAudioPeaks peaks = new SdrRecordedAudioPeaks(RATE, IcR30TestRecording.LIMIT_MS);
    private int size;
    private boolean finished;

    synchronized void append(short[] samples, int offset, int count) {
        if (finished) return;
        int accepted = Math.min(count, (pcm.length - size) / 2);
        int limit = offset + accepted;
        peaks.append(samples, offset, accepted);
        for (int i = offset; i < limit; i++) {
            pcm[size++] = (byte) samples[i];
            pcm[size++] = (byte) (samples[i] >> 8);
        }
    }

    synchronized int[] peaks() {
        return peaks.snapshot();
    }

    int save(File wave) throws IOException {
        synchronized (this) { finished = true; }
        if (size == 0) return 0;
        boolean complete = false;
        File partial = new File(wave.getPath() + ".partial");
        try {
            try (FileOutputStream output = new FileOutputStream(partial)) {
                output.write(SdrPcmWave.mono16Header(RATE, size));
                output.write(pcm, 0, size);
            }
            if (!partial.renameTo(wave)) throw new IOException("수신음 파일을 마무리하지 못했습니다.");
            complete = true;
            return size / 2;
        } finally {
            if (!complete) partial.delete();
        }
    }
}
