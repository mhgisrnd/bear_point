package com.bearpoint.app;

import java.io.File;
import java.util.ArrayList;
import java.util.List;

/** Main-thread comparison state machine. Every variant changes one RF variable. */
final class SdrComparison {
    static final class Settings {
        final int hz, rate, gain, ppm, listen, deemphasis, offset;
        Settings(int hz,int rate,int gain,int ppm,int listen,int deemphasis,int offset) {
            this.hz=hz;this.rate=rate;this.gain=gain;this.ppm=ppm;this.listen=listen;this.deemphasis=deemphasis;this.offset=offset;
        }
        Settings variant(int rate,int gain,int offset) { return new Settings(hz,rate,gain,ppm,listen,deemphasis,offset); }
    }
    static final class Step {
        final String name; final Settings settings;
        Step(String name,Settings settings){this.name=name;this.settings=settings;}
    }
    interface Host {
        String reception(); String captureState(); String error();
        void stop(Runnable done); void start(Settings settings); void record(int index,String name);
        File file(); void bundle(List<File> files,List<String> names,String reason);
        void later(Runnable action); void changed(); void restoreAudio();
    }
    static List<Step> plan(Settings s) {
        List<Step> p=new ArrayList<>();p.add(new Step("기준",s));
        p.add(new Step("감도 10dB 요청",s.variant(s.rate,100,s.offset)));
        p.add(new Step("감도 0dB 요청",s.variant(s.rate,0,s.offset)));
        p.add(new Step("중심 주파수 아래 100kHz",s.variant(s.rate,s.gain,100000)));
        p.add(new Step("중심 주파수 위 100kHz",s.variant(s.rate,s.gain,-100000)));
        p.add(new Step("수집 속도 250k",s.variant(250000,s.gain,s.offset)));
        p.add(new Step("수집 속도 2048k",s.variant(2048000,s.gain,s.offset)));
        p.add(new Step("기준 재확인",s));return p;
    }
    final Host host; boolean active; String phase="idle",message="";
    int index,serial; long deadline,settled; Settings original; List<Step> steps;
    final List<File> files=new ArrayList<>();final List<String> names=new ArrayList<>();
    private final java.util.function.LongSupplier clock;
    SdrComparison(Host host,java.util.function.LongSupplier clock){this.host=host;this.clock=clock;}
    void begin(Settings settings) {
        if(active)throw new IllegalStateException("비교 진단이 진행 중입니다.");
        original=settings;steps=plan(settings);files.clear();names.clear();index=0;active=true;serial++;
        phase="switching";next();
    }
    private void next() {
        if(!active)return;
        if(index==steps.size()){finish("완료");return;}
        int token=serial;phase="switching";message=(index+1)+"/"+steps.size()+" · "+steps.get(index).name;
        deadline=clock.getAsLong()+30000;host.changed();
        host.stop(()->{if(!active||token!=serial)return;try{host.start(steps.get(index).settings);phase="settling";settled=0;}catch(RuntimeException e){finish("설정 실패: "+e.getMessage());}});
        host.later(()->poll(token));
    }
    private void poll(int token) {
        if(!active||token!=serial)return;
        long now=clock.getAsLong();
        if(now>deadline){finish("시간 초과 · "+message);return;}
        if("bundling".equals(phase)&&"error".equals(host.captureState())){active=false;phase="error";message="비교 ZIP 저장 실패 · 단계별 기록은 보관됩니다: "+host.error();host.changed();return;}
        if("error".equals(host.reception())||("recording".equals(phase)&&"error".equals(host.captureState()))){finish("시험 실패: "+host.error());return;}
        if("settling".equals(phase)&&"receiving".equals(host.reception())) {
            if(settled==0)settled=now;
            if(now-settled>=2000){try{host.record(index,steps.get(index).name);phase="recording";deadline=now+45000;host.changed();}catch(RuntimeException e){finish("기록 실패: "+e.getMessage());return;}}
        } else if("recording".equals(phase)&&"ready".equals(host.captureState())) {
            files.add(host.file());names.add(steps.get(index).name);index++;next();return;
        } else if("restoring".equals(phase)&&"receiving".equals(host.reception())&&!java.util.Arrays.asList("waiting","recording","packaging").contains(host.captureState())) {
            host.restoreAudio();message+=" · 기존 설정 복원됨";phase="bundling";
            if(files.isEmpty()){active=false;phase="error";host.changed();return;}
            try{host.bundle(new ArrayList<>(files),new ArrayList<>(names),message);deadline=now+60000;}catch(RuntimeException failure){interrupt();message="비교 ZIP 실패 · 단계별 기록은 보관됩니다: "+failure.getMessage();host.changed();return;}
        } else if("bundling".equals(phase)&&"ready".equals(host.captureState())) {
            active=false;phase="ready";message+=" · 비교 ZIP 공유 가능";host.changed();return;
        }
        host.later(()->poll(token));
    }
    void cancel(){if(active)finish("중단");}
    // Stop/disconnect/phone interruption must NEVER restart the receiver.
    void interrupt(){if(!active)return;active=false;serial++;phase="interrupted";message="수신 종료로 비교 중단 · 완료된 단계 기록은 보관됩니다.";host.changed();}
    private void finish(String reason) {
        if(!active)return;
        if("restoring".equals(phase)||"bundling".equals(phase)){interrupt();message=reason+" · 원래 설정 복원을 확인하세요.";host.changed();return;}
        message=reason;phase="restoring";int token=++serial;deadline=clock.getAsLong()+30000;host.changed();
        host.stop(()->{if(!active||token!=serial)return;try{host.start(original);}catch(RuntimeException e){interrupt();message="복원 실패: "+e.getMessage();host.changed();}});
        host.later(()->poll(token));
    }
}
