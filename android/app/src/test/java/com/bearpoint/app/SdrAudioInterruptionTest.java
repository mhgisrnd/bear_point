package com.bearpoint.app;

import android.media.AudioManager;
import org.junit.Test;
import static org.junit.Assert.*;

public class SdrAudioInterruptionTest {
    private static final class Session {
        String state="receiving",reason="";
        int stops;
        final SdrAudioInterruption policy=new SdrAudioInterruption(
            () -> state.equals("starting") || state.equals("receiving") || state.equals("scanning"),
            message -> {stops++;state="stopping";reason=message;});
    }

    @Test public void callStopsOnceAndFocusReturningNeverRestartsReception() {
        Session s=new Session();
        s.policy.focusChanged(AudioManager.AUDIOFOCUS_LOSS_TRANSIENT);
        assertEquals("stopping",s.state);assertEquals(1,s.stops);assertTrue(s.reason.contains("수신 시작"));
        s.policy.modeChanged(AudioManager.MODE_IN_CALL);assertEquals(1,s.stops);
        s.state="idle";
        s.policy.focusChanged(AudioManager.AUDIOFOCUS_GAIN);s.policy.modeChanged(AudioManager.MODE_NORMAL);
        assertEquals("idle",s.state);assertEquals(1,s.stops);
        s.state="receiving"; // Only the user's new start arms another session.
        s.policy.modeChanged(AudioManager.MODE_IN_CALL);assertEquals(2,s.stops);
    }

    @Test public void callModeStopsEvenWithoutAnAudioFocusEventIncludingVoip() {
        for(int mode:new int[]{AudioManager.MODE_IN_CALL,AudioManager.MODE_IN_COMMUNICATION,
                AudioManager.MODE_CALL_REDIRECT,AudioManager.MODE_COMMUNICATION_REDIRECT}) {
            Session s=new Session();s.policy.modeChanged(mode);
            assertEquals(1,s.stops);assertEquals("stopping",s.state);
        }
    }

    @Test public void notificationsAndIdleStatesDoNotTriggerAStop() {
        Session s=new Session();s.policy.focusChanged(AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK);
        s.policy.focusChanged(AudioManager.AUDIOFOCUS_GAIN);s.policy.modeChanged(AudioManager.MODE_RINGTONE);
        assertEquals("receiving",s.state);assertEquals(0,s.stops);
        for(String state:new String[]{"idle","error","stopping"}) {
            s.state=state;s.policy.modeChanged(AudioManager.MODE_IN_CALL);
            s.policy.focusChanged(AudioManager.AUDIOFOCUS_LOSS);
            assertEquals(state,s.state);assertEquals(0,s.stops);
        }
    }

    @Test public void interruptionStopsStartingAndScanningSessionsToo() {
        for(String state:new String[]{"starting","scanning"}) {
            Session s=new Session();s.state=state;s.policy.focusChanged(AudioManager.AUDIOFOCUS_LOSS);
            assertEquals("stopping",s.state);assertEquals(1,s.stops);
        }
    }
}
