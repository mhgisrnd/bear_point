package com.bearpoint.app;

import java.io.ByteArrayOutputStream;
import java.io.Closeable;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.TimeUnit;

/** CI-V over the IC-R30's Bluetooth Classic SPP stream (not audio). */
final class IcR30Civ implements Closeable {
    static final Map<String, byte[]> MODES = new LinkedHashMap<>();
    static {
        MODES.put("LSB", new byte[]{0x00, 0x01});
        MODES.put("USB", new byte[]{0x01, 0x01});
        MODES.put("AM", new byte[]{0x02, 0x01});
        MODES.put("AM-N", new byte[]{0x02, 0x02});
        MODES.put("CW", new byte[]{0x03, 0x01});
        MODES.put("FM", new byte[]{0x05, 0x01});
        MODES.put("FM-N", new byte[]{0x05, 0x02});
        MODES.put("WFM", new byte[]{0x06, 0x01});
        MODES.put("CW-R", new byte[]{0x07, 0x01});
        MODES.put("P25", new byte[]{0x16, 0x01});
        MODES.put("D-STAR", new byte[]{0x17, 0x01});
        MODES.put("dPMR", new byte[]{0x18, 0x01});
        MODES.put("NXDN-VN", new byte[]{0x19, 0x01});
        MODES.put("NXDN-N", new byte[]{0x20, 0x01});
        MODES.put("DCR", new byte[]{0x21, 0x01});
    }

    private final InputStream input;
    private final OutputStream output;
    private final long timeoutMillis;
    interface Trace { void log(String message); }
    private final Trace trace;
    private final ArrayBlockingQueue<Integer> receivedBytes = new ArrayBlockingQueue<>(4096);
    private final Thread reader;
    private volatile IOException inputError;
    private volatile boolean closed;

    IcR30Civ(InputStream input, OutputStream output, long timeoutMillis) {
        this(input, output, timeoutMillis, message -> {});
    }

    IcR30Civ(InputStream input, OutputStream output, long timeoutMillis, Trace trace) {
        this.input = input;
        this.output = output;
        this.timeoutMillis = timeoutMillis;
        this.trace = trace;
        // Bluetooth InputStream.available() is only an estimate; zero must not suppress a read.
        reader = new Thread(this::readInput, "ic-r30-input");
        reader.setDaemon(true);
        reader.start();
    }

    private void readInput() {
        byte[] buffer = new byte[256];
        try {
            while (!closed) {
                int count = input.read(buffer);
                if (count < 0) throw new IOException("Bluetooth 연결이 종료되었습니다.");
                for (int i = 0; i < count; i++) {
                    if (!receivedBytes.offer(buffer[i] & 0xff)) throw new IOException("CI-V 입력이 과도합니다. Echo Back OFF 설정을 확인하세요.");
                }
            }
        } catch (IOException error) {
            if (!closed) inputError = error;
        } finally {
            receivedBytes.offer(-1);
        }
    }

    @Override public void close() throws IOException {
        closed = true;
        reader.interrupt();
        receivedBytes.clear();
        receivedBytes.offer(-1);
        input.close();
    }

    static long decodeBcd(byte[] data) throws IOException {
        if (data.length == 0) throw new IOException("CI-V BCD 응답이 비어 있습니다.");
        long value = 0;
        for (byte b : data) {
            int high = (b & 0xff) >> 4, low = b & 0x0f;
            if (high > 9 || low > 9) throw new IOException("CI-V BCD 응답이 올바르지 않습니다.");
            value = value * 100 + high * 10 + low;
        }
        return value;
    }

    static long decodeFrequency(byte[] data) throws IOException {
        if (data.length != 5) throw new IOException("CI-V 주파수 응답 길이가 올바르지 않습니다.");
        byte[] reverse = new byte[5];
        for (int i = 0; i < 5; i++) reverse[i] = data[4 - i];
        long hz = decodeBcd(reverse);
        if (hz < 100000 || hz > 3304999000L) throw new IOException("IC-R30 주파수 응답이 범위를 벗어났습니다.");
        return hz;
    }

    static int decodeSmeter(byte[] data) throws IOException {
        if (data.length != 2) throw new IOException("CI-V S-Meter 응답 길이가 올바르지 않습니다.");
        long value = decodeBcd(data);
        if (value > 255) throw new IOException("CI-V S-Meter 값이 0–255 범위를 벗어났습니다.");
        return (int) value;
    }

    static byte[] frequencyCommand(long hz) {
        if (hz < 100000 || hz > 3304999000L) throw new IllegalArgumentException("주파수는 0.1–3304.999 MHz 범위여야 합니다.");
        byte[] command = new byte[6];
        command[0] = 0x05;
        for (int i = 1; i < command.length; i++) {
            int pair = (int) (hz % 100);
            command[i] = (byte) ((pair / 10 << 4) | pair % 10);
            hz /= 100;
        }
        return command;
    }

    static byte[] modeCommand(String mode) {
        byte[] data = MODES.get(mode);
        if (data == null) throw new IllegalArgumentException("지원하지 않는 수신 모드입니다.");
        return new byte[]{0x06, data[0], data[1]};
    }

    long frequency() throws IOException { return decodeFrequency(exchange(new byte[]{0x03}, false)); }
    int smeter() throws IOException { return decodeSmeter(exchange(new byte[]{0x15, 0x02}, false)); }
    String mode() throws IOException {
        byte[] value = exchange(new byte[]{0x04}, false);
        if (value.length != 2) throw new IOException("CI-V 모드 응답 길이가 올바르지 않습니다.");
        for (Map.Entry<String, byte[]> mode : MODES.entrySet()) {
            if (Arrays.equals(mode.getValue(), value)) return mode.getKey();
        }
        throw new IOException("알 수 없는 IC-R30 수신 모드 응답입니다.");
    }
    void setFrequency(long hz) throws IOException { exchange(frequencyCommand(hz), true); }
    void setMode(String mode) throws IOException { exchange(modeCommand(mode), true); }

    private static String hex(byte[] data) {
        StringBuilder text = new StringBuilder();
        for (byte value : data) {
            if (text.length() > 0) text.append(' ');
            text.append(String.format(java.util.Locale.ROOT, "%02X", value & 0xff));
        }
        return text.toString();
    }

    byte[] exchange(byte[] command, boolean acknowledgement) throws IOException {
        if (closed) throw new IOException("CI-V 통신이 취소되었습니다.");
        if (inputError != null) throw inputError;
        receivedBytes.clear();
        ByteArrayOutputStream request = new ByteArrayOutputStream();
        request.write(new byte[]{(byte) 0xfe, (byte) 0xfe, (byte) 0x9c, (byte) 0xe0});
        request.write(command);
        request.write(0xfd);
        trace.log("TX " + hex(request.toByteArray()));
        output.write(request.toByteArray());
        output.flush();
        long deadline = System.nanoTime() + timeoutMillis * 1000000L;
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        int received = 0;
        while (System.nanoTime() < deadline) {
            long remaining = deadline - System.nanoTime();
            if (remaining <= 0) break;
            final Integer next;
            try { next = receivedBytes.poll(remaining, TimeUnit.NANOSECONDS); }
            catch (InterruptedException error) {
                Thread.currentThread().interrupt();
                throw new IOException("CI-V 통신이 취소되었습니다.", error);
            }
            if (next == null) {
                if (inputError != null) throw inputError;
                break;
            }
            if (next < 0) throw inputError == null ? new IOException("Bluetooth 연결이 종료되었습니다.") : inputError;
            int b = next;
            received++;
            if (b != 0xfd) {
                buffer.write(b);
                if (buffer.size() > 1024) throw new IOException("CI-V 프레임이 너무 깁니다.");
                continue;
            }
            byte[] frame = buffer.toByteArray();
            trace.log("RX " + hex(frame) + " FD");
            buffer.reset();
            int start = -1;
            for (int i = 0; i + 1 < frame.length; i++) {
                if ((frame[i] & 0xff) == 0xfe && (frame[i + 1] & 0xff) == 0xfe) start = i + 2;
            }
            if (start < 0 || frame.length - start < 3 ||
                    (frame[start] & 0xff) != 0xe0 || (frame[start + 1] & 0xff) != 0x9c) continue;
            byte[] body = Arrays.copyOfRange(frame, start + 2, frame.length);
            if (body.length == 1 && (body[0] & 0xff) == 0xfa) throw new IOException("수신기가 CI-V 명령을 거절했습니다 (FA).");
            if (acknowledgement) {
                if (body.length == 1 && (body[0] & 0xff) == 0xfb) return new byte[0];
            } else if (body.length >= command.length &&
                    Arrays.equals(command, Arrays.copyOf(body, command.length))) {
                return Arrays.copyOfRange(body, command.length, body.length);
            }
        }
        trace.log("Timeout command=" + hex(command) + " received=" + received + " partial=" + hex(buffer.toByteArray()));
        throw new IOException("CI-V 응답 시간 초과 (명령 " + hex(command) + ", 수신 " + received +
            "바이트). Serialport Function=CI-V (Echo Back OFF), 주소 9C를 확인하고 다시 연결하세요.");
    }
}
