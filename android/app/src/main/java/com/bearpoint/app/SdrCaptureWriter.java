package com.bearpoint.app;

import java.io.File;
import java.io.IOException;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.TimeUnit;

/** A bounded, nonblocking handoff. Only this thread touches capture streams. */
final class SdrCaptureWriter {
    private final SdrDiagnosticCapture capture;
    private final Object lifecycle=new Object();
    private final ArrayBlockingQueue<Frame> queue;
    private final Thread thread;
    private volatile boolean closed;
    private volatile int generation;
    private volatile Finish finish;
    private volatile int highWater;
    private static final class Finish {
        final int generation;final long now;final String reason;
        Finish(int generation,long now,String reason){this.generation=generation;this.now=now;this.reason=reason;}
    }
    private static final class Frame {
        final int generation;final double[] values;final short[] audio;final byte[] raw;
        final long now;final String settings,details;
        Frame(int generation,double[] values,short[] audio,byte[] raw,long now,String settings,String details){
            this.generation=generation;this.values=values;this.audio=audio;this.raw=raw;this.now=now;this.settings=settings;this.details=details;
        }
    }
    SdrCaptureWriter(SdrDiagnosticCapture capture){this(capture,16);}
    SdrCaptureWriter(SdrDiagnosticCapture capture,int capacity){
        this.capture=capture;queue=new ArrayBlockingQueue<>(capacity);thread=new Thread(this::write,"sdr-capture");thread.start();
    }
    void request(File root)throws IOException {
        synchronized(lifecycle){
            if(closed)throw new IllegalStateException("진단 저장 작업이 종료되었습니다.");
            capture.request(root);generation++;queue.clear();finish=null;highWater=0;
        }
    }
    void offer(double[] values,short[] audio,byte[] raw,long now,String settings,String details){
        int token=generation;
        if(closed||finish!=null)return;
        Frame frame=new Frame(token,values,audio,raw,now,settings,details);
        if(!queue.offer(frame)){
            capture.writerDrop((long)values[0]);
            finish=new Finish(token,now,"writer-overflow");
        }else highWater=Math.max(highWater,queue.size());
    }
    int pending(){return queue.size();}
    int highWater(){return highWater;}
    void finish(long now,String reason){
        if(finish==null){finish=new Finish(generation,now,reason);queue.offer(new Frame(generation,null,null,null,now,null,null));}
    }
    void shutdown(long now){finish(now,"receiver-closed");closed=true;}
    boolean awaitStopped(long ms)throws InterruptedException{thread.join(ms);return !thread.isAlive();}
    private void write(){
        try{
            while(true){
                Frame frame=queue.poll(1,TimeUnit.SECONDS);
                if(frame!=null&&frame.values!=null)synchronized(lifecycle){
                    if(frame.generation==generation)capture.observe(frame.values,frame.audio,frame.now,frame.settings,frame.details,frame.raw);
                }
                Finish end=finish;
                if(end!=null&&queue.isEmpty())synchronized(lifecycle){
                    if(end==finish&&end.generation==generation){capture.finish(end.now,end.reason);finish=null;}
                }
                if(closed&&queue.isEmpty())break;
            }
        }catch(InterruptedException interrupted){Thread.currentThread().interrupt();}
        finally{capture.shutdown(System.nanoTime()/1000000);}
    }
}
