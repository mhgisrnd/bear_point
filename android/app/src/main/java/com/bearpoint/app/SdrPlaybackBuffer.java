package com.bearpoint.app;

import java.util.ArrayDeque;

/** At most 96 ms of PCM. Queue bookkeeping is atomic; no audio I/O under this lock. */
final class SdrPlaybackBuffer {
    static final int MAX_SAMPLES=4608;
    static final class Packet {
        final short[] samples;final long sequence;final double receivedMs;
        Packet(short[] samples,long sequence,double receivedMs){this.samples=samples;this.sequence=sequence;this.receivedMs=receivedMs;}
    }
    static final class Dropped {int blocks,samples;}
    private final ArrayDeque<Packet> queue=new ArrayDeque<>();
    private int samples;
    synchronized Dropped offer(Packet packet){
        Dropped dropped=new Dropped();
        if(packet.samples.length>MAX_SAMPLES){dropped.blocks=1;dropped.samples=packet.samples.length;return dropped;}
        while(!queue.isEmpty()&&(queue.size()>=8||samples+packet.samples.length>MAX_SAMPLES)){
            Packet old=queue.removeFirst();samples-=old.samples.length;dropped.blocks++;dropped.samples+=old.samples.length;
        }
        queue.addLast(packet);samples+=packet.samples.length;notifyAll();return dropped;
    }
    synchronized Packet poll(int timeoutMs)throws InterruptedException{
        long end=System.nanoTime()+timeoutMs*1000000L;
        while(queue.isEmpty()){
            long remaining=end-System.nanoTime();if(remaining<=0)return null;
            wait(Math.max(1,remaining/1000000));
        }
        Packet packet=queue.removeFirst();samples-=packet.samples.length;return packet;
    }
    synchronized Dropped clear(){Dropped dropped=new Dropped();dropped.blocks=queue.size();dropped.samples=samples;queue.clear();samples=0;notifyAll();return dropped;}
    synchronized int samples(){return samples;}
    synchronized int size(){return queue.size();}
}
