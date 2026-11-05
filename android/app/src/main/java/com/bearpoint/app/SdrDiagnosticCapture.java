package com.bearpoint.app;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.zip.Deflater;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import java.util.zip.ZipFile;

/** Bounded local capture of existing IQ/PCM buffers. Failures never stop reception. */
final class SdrDiagnosticCapture {
    private final Runnable changed;
    private final long durationMs;
    private final long limit;
    private final ExecutorService packager = Executors.newSingleThreadExecutor();
    private volatile String state = "idle", error = "", path = "";
    private volatile long bytes, omitted;
    private long started, firstAudioOffset = -1, usbBytes, audioSamples;
    private double writeMs;
    private int sampleRate;
    private File directory;
    private OutputStream iq, pcm, index, telemetry;
    private String receiver = "{}";
    private String lastReceiver = "{}";
    private final ArrayDeque<String[]> recent = new ArrayDeque<>();
    private File[] roots = new File[0];
    static final class Saved {
        final String id; final File file; final long size, time;
        Saved(File file) { this.file=file;id=file.getParentFile().getName();size=file.length();time=file.lastModified(); }
    }
    private volatile Saved[] saved = new Saved[0];
    Saved[] saved() { return saved; }
    synchronized void storage(File... roots) { this.roots=roots;refreshSaved(); }
    private synchronized void refreshSaved() {
        ArrayList<Saved> found=new ArrayList<>();
        for(File root:roots) {
            File[] folders=root.listFiles(file->file.isDirectory()&&file.getName().startsWith("sdr-diagnostic-"));
            if(folders==null)continue;
            for(File folder:folders) {
                File archive=new File(folder,"sdr-diagnostic.zip");
                if(archive.isFile()&&archive.length()>0)try(ZipFile zip=new ZipFile(archive)) {
                    if(zip.getEntry("metadata.json")!=null&&zip.getEntry("samples.cu8")!=null)found.add(new Saved(archive));
                }catch(IOException ignored){}
            }
        }
        found.sort((a,b)->Long.compare(b.time,a.time));saved=found.toArray(new Saved[0]);
    }
    synchronized File file(String id) {
        for(Saved record:saved)if(record.id.equals(id)&&record.file.isFile())return record.file;
        throw new IllegalStateException("저장된 진단 파일을 찾지 못했습니다.");
    }
    synchronized void noteTelemetry(long now,String data) {
        recent.addLast(new String[]{Long.toString(now),data});
        while(recent.size()>30 || (!recent.isEmpty() && now-Long.parseLong(recent.peekFirst()[0])>3000))recent.removeFirst();
    }

    SdrDiagnosticCapture(Runnable changed) { this(changed, 10000, 50L * 1024 * 1024); }
    SdrDiagnosticCapture(Runnable changed, long durationMs, long limit) {
        this.changed = changed; this.durationMs = durationMs; this.limit = limit;
    }
    String state() { return state; }
    String error() { return error; }
    long bytes() { return bytes; }
    long omitted() { return omitted; }
    synchronized File readyFile() {
        if (!"ready".equals(state)) throw new IllegalStateException("진단 기록이 아직 준비되지 않았습니다.");
        return new File(path);
    }
    synchronized void request(File cache) throws IOException {
        if ("waiting".equals(state) || "recording".equals(state) || "packaging".equals(state))
            throw new IllegalStateException("진단 기록을 준비하고 있습니다.");
        if(!cache.isDirectory()&&!cache.mkdirs())throw new IOException("진단 저장 폴더를 만들지 못했습니다.");
        directory = new File(cache,"sdr-diagnostic-" + UUID.randomUUID());
        if (!directory.mkdirs()) throw new IOException("진단 기록 저장 공간을 만들지 못했습니다.");
        bytes = omitted = usbBytes = audioSamples = 0;writeMs=0;sampleRate=0;firstAudioOffset = -1; path = error = "";
        state = "waiting"; changed.run();
    }
    synchronized void observe(double[] values, short[] audio, long now, String settings) {
        observe(values,audio,now,settings,"{}");
    }
    synchronized void observe(double[] values, short[] audio, long now, String settings,String details) {
        if (!"waiting".equals(state) && !"recording".equals(state)) return;
        try {
            if ("waiting".equals(state)) {
                started = now; receiver = settings;sampleRate=(int)values[4];
                iq = output("samples.cu8"); pcm = output("audio.s16le"); index = output("blocks.csv");
                telemetry = output("telemetry.jsonl");
                for(String[] entry:recent)if(now-Long.parseLong(entry[0])<=3000)event("baseline",Long.parseLong(entry[0])-started,entry[1]);
                index.write("file_offset,usb_offset,usb_bytes,saved_bytes,elapsed_ms\n".getBytes(StandardCharsets.UTF_8));
                state = "recording"; changed.run();
            }
            lastReceiver=settings;
            long writeBegan=System.nanoTime();
            int received = (int)values[0];
            int count = (int)Math.max(0, Math.min(Math.min(received,values.length-7),limit-bytes));
            count -= count % 2; // Preserve complete I/Q pairs, including at the byte limit.
            // Native FFT export truncates incomplete frames. Record every gap explicitly.
            index.write((bytes+","+usbBytes+","+received+","+count+","+(now-started)+"\n").getBytes(StandardCharsets.UTF_8));
            byte[] raw = new byte[count];
            for (int i=0;i<count;i++) raw[i]=(byte)Math.round(values[i+7]*127.5+127.5);
            iq.write(raw); bytes += count; omitted += received-count;
            if (audio != null && audio.length>0) {
                if (firstAudioOffset<0) firstAudioOffset=usbBytes;
                byte[] data = new byte[audio.length*2];
                for (int i=0;i<audio.length;i++) { data[i*2]=(byte)audio[i]; data[i*2+1]=(byte)(audio[i]>>8); }
                pcm.write(data);
                audioSamples+=audio.length;
            }
            usbBytes += received;
            writeMs+=(System.nanoTime()-writeBegan)/1e6;
            event("capture",now-started,details);
            if (now-started>=durationMs || bytes>=limit) finish(now,"completed");
        } catch (Exception failure) { fail(failure); }
    }
    private void event(String phase,long elapsed,String data) throws IOException {
        String line="{\"phase\":\""+phase+"\",\"elapsed_ms\":"+elapsed+",\"capture_write_total_ms\":"+writeMs+",\"data\":"+data+"}\n";
        telemetry.write(line.getBytes(StandardCharsets.UTF_8));
    }
    private OutputStream output(String name) throws IOException {
        return new BufferedOutputStream(new FileOutputStream(new File(directory,name)),131072);
    }
    synchronized void finish(long now, String reason) {
        if (!"waiting".equals(state) && !"recording".equals(state)) return;
        try {
            closeStreams();
            if (bytes==0) throw new IOException("진단 기록에 수신 데이터가 없습니다.");
            String metadata="{\"schema_version\":2,\"format\":\"unsigned 8-bit interleaved IQ, 127.5 midpoint\",\"receiver\":"+receiver+
                ",\"receiver_last\":"+lastReceiver+",\"audio_samples\":"+audioSamples+",\"sample_duration_ms\":"+(sampleRate>0?bytes*500.0/sampleRate:0)+
                ",\"delivered_duration_ms\":"+(sampleRate>0?usbBytes*500.0/sampleRate:0)+",\"capture_write_total_ms\":"+writeMs+
                ",\"captured_iq_bytes\":"+bytes+",\"omitted_iq_bytes\":"+omitted+",\"duration_ms\":"+(now-started)+
                ",\"audio_start_usb_offset\":"+firstAudioOffset+",\"reason\":\""+reason+"\","+
                "\"continuity\":\"blocks.csv indexes delivered USB bytes, not hardware sequence numbers. Unreceived hardware samples cannot be counted directly. telemetry.jsonl includes baseline and capture timing.\"}";
            try (OutputStream file=output("metadata.json")) { file.write(metadata.getBytes(StandardCharsets.UTF_8)); }
            state="packaging"; changed.run();
            final File folder=directory;
            packager.execute(()->packageFiles(folder));
        } catch (Exception failure) { fail(failure); }
    }
    private void packageFiles(File folder) {
        try {
            File partial=new File(folder,"sdr-diagnostic.zip.partial");
            File archive=new File(folder,"sdr-diagnostic.zip");
            try (ZipOutputStream zip=new ZipOutputStream(new FileOutputStream(partial))) {
                zip.setLevel(Deflater.NO_COMPRESSION);
                for (String name:new String[]{"metadata.json","blocks.csv","samples.cu8","telemetry.jsonl"}) {
                    zip.putNextEntry(new ZipEntry(name));copy(new File(folder,name),zip);zip.closeEntry();
                }
                File audio=new File(folder,"audio.s16le");
                zip.putNextEntry(new ZipEntry("received-audio.wav"));
                byte[] header=new byte[44];
                ascii(header,0,"RIFF");le(header,4,audio.length()+36,4);ascii(header,8,"WAVEfmt ");
                le(header,16,16,4);le(header,20,1,2);le(header,22,1,2);le(header,24,48000,4);
                le(header,28,96000,4);le(header,32,2,2);le(header,34,16,2);ascii(header,36,"data");le(header,40,audio.length(),4);
                zip.write(header);copy(audio,zip);zip.closeEntry();
            }
            if(!partial.renameTo(archive))throw new IOException("진단 파일 저장을 마무리하지 못했습니다.");
            for (String name:new String[]{"metadata.json","blocks.csv","samples.cu8","audio.s16le","telemetry.jsonl"}) new File(folder,name).delete();
            synchronized(this) {path=archive.getAbsolutePath();refreshSaved();state="ready";}changed.run();
        } catch (Exception failure) { synchronized(this) { fail(failure); } }
    }
    private static void ascii(byte[] target,int offset,String text) {
        byte[] bytes=text.getBytes(StandardCharsets.US_ASCII);System.arraycopy(bytes,0,target,offset,bytes.length);
    }
    private static void le(byte[] target,int offset,long value,int length) {
        for(int i=0;i<length;i++)target[offset+i]=(byte)(value>>(i*8));
    }
    private static void copy(File file,OutputStream output) throws IOException {
        try(InputStream input=new FileInputStream(file)) { byte[] buffer=new byte[65536];int n;while((n=input.read(buffer))!=-1)output.write(buffer,0,n); }
    }
    private void closeStreams() throws IOException {
        IOException failure=null;
        for(OutputStream stream:new OutputStream[]{iq,pcm,index,telemetry})if(stream!=null)try{stream.close();}catch(IOException e){failure=e;}
        iq=pcm=index=telemetry=null;if(failure!=null)throw failure;
    }
    private void fail(Exception failure) {
        try{closeStreams();}catch(IOException ignored){}
        error=failure.getMessage()==null?failure.toString():failure.getMessage();state="error";changed.run();
    }
    synchronized void shutdown(long now) { finish(now,"receiver-closed");packager.shutdown(); }
}
