package com.bearpoint.app;
import org.junit.Test;
import static org.junit.Assert.*;
import java.io.File;
import java.util.*;
public class SdrComparisonTest {
    static final SdrComparison.Settings BASE=new SdrComparison.Settings(148241000,1024000,197,0,148241000,75,12000);
    static class Fake implements SdrComparison.Host {
        long now=1000;String rx="receiving",capture="idle";boolean hang;int bundles,records,restores,starts;
        SdrComparison.Settings last;List<File> bundled;Queue<Runnable> queue=new ArrayDeque<>();SdrComparison run=new SdrComparison(this,()->now);
        public String reception(){return rx;} public String captureState(){return capture;} public String error(){return "failure";}
        public void stop(Runnable done){rx="idle";done.run();}
        public void start(SdrComparison.Settings s){last=s;starts++;rx=hang?"starting":"receiving";}
        public void record(int index,String name){records++;capture="ready";}
        public File file(){return new File("stage-"+records);}
        public void bundle(List<File> files,List<String> names,String reason){bundles++;bundled=files;capture="ready";}
        public void later(Runnable r){queue.add(r);}public void changed(){}public void restoreAudio(){restores++;}
        void tick(){now+=250;if(!queue.isEmpty())queue.remove().run();}
        void finish(){for(int i=0;i<2000&&run.active;i++)tick();assertFalse(run.active);}
    }
    @Test public void changesOneSettingAndKeepsListenFrequency(){
        List<SdrComparison.Step> plan=SdrComparison.plan(BASE);assertEquals(8,plan.size());
        for(SdrComparison.Step step:plan){assertEquals(BASE.listen,step.settings.listen);assertEquals(BASE.ppm,step.settings.ppm);
            int changes=(step.settings.rate!=BASE.rate?1:0)+(step.settings.gain!=BASE.gain?1:0)+(step.settings.offset!=BASE.offset?1:0);assertTrue(changes<=1);}
        assertSame(BASE,plan.get(7).settings);
    }
    @Test public void completesEightCapturesBundlesAndRestoresOriginal(){Fake h=new Fake();h.run.begin(BASE);h.finish();assertEquals(8,h.records);assertEquals(1,h.bundles);assertEquals(8,h.bundled.size());assertSame(BASE,h.last);assertEquals(1,h.restores);assertEquals("ready",h.run.phase);}
    @Test public void cancellationRestoresAndBundlesCompletedStages(){Fake h=new Fake();h.run.begin(BASE);while(h.records<2)h.tick();h.run.cancel();h.finish();assertSame(BASE,h.last);assertEquals(1,h.bundles);assertTrue(h.bundled.size()<8);}
    @Test public void disconnectInvalidatesQueuedWorkWithoutRestart(){Fake h=new Fake();h.run.begin(BASE);int starts=h.starts;h.run.interrupt();for(int i=0;i<30;i++)h.tick();assertEquals(starts,h.starts);assertFalse(h.run.active);assertEquals(0,h.bundles);}
    @Test public void restorationTimeoutEndsWithoutLoop(){Fake h=new Fake();h.hang=true;h.run.begin(BASE);h.finish();assertEquals(2,h.starts);assertEquals("interrupted",h.run.phase);}
    @Test public void failedStageRestoresOriginal(){Fake h=new Fake();h.run.begin(BASE);h.rx="error";h.tick();h.finish();assertSame(BASE,h.last);assertTrue(h.run.message.contains("시험 실패"));}
}
