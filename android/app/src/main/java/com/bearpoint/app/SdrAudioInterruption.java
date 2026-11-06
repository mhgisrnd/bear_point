package com.bearpoint.app;

import android.media.AudioManager;

/** Main-thread policy: interruptions stop reception; normal mode/focus never restarts it. */
final class SdrAudioInterruption {
    interface ActiveReception { boolean active(); }
    interface StopReception { void stop(String reason); }
    private final ActiveReception receiving;
    private final StopReception stop;

    SdrAudioInterruption(ActiveReception receiving, StopReception stop) {
        this.receiving = receiving; this.stop = stop;
    }

    void focusChanged(int change) {
        if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT)
            interrupt("통화 또는 다른 오디오 사용으로 수신을 정지했습니다. 수신 시작을 눌러주세요.");
    }

    static boolean isCallMode(int mode) {
        return mode == AudioManager.MODE_IN_CALL || mode == AudioManager.MODE_IN_COMMUNICATION ||
                mode == AudioManager.MODE_CALL_REDIRECT || mode == AudioManager.MODE_COMMUNICATION_REDIRECT;
    }

    void modeChanged(int mode) {
        if (isCallMode(mode)) interrupt("통화로 수신을 정지했습니다. 통화 종료 후 수신 시작을 눌러주세요.");
    }

    private void interrupt(String reason) {
        if (receiving.active()) stop.stop(reason);
    }
}
