package com.bearpoint.app;

import static org.junit.Assert.*;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.After;
import org.junit.Test;

public class IcR30CivTest {
    private final List<Transport> transports = new ArrayList<>();
    @After public void closeTransports() throws Exception {
        for (Transport transport : transports) transport.civ.close();
    }
    private static byte[] bytes(int... values) {
        byte[] result = new byte[values.length];
        for (int i = 0; i < values.length; i++) result[i] = (byte) values[i];
        return result;
    }

    private final class Transport {
        final ByteArrayOutputStream sent = new ByteArrayOutputStream();
        final LinkedBlockingQueue<Integer> reply = new LinkedBlockingQueue<>();
        final CountDownLatch written = new CountDownLatch(1);
        final IcR30Civ civ;
        Transport(byte[] response, long timeout) {
            InputStream input = new InputStream() {
                @Override public int available() { return 0; }
                @Override public int read() throws IOException {
                    try { return reply.take(); }
                    catch (InterruptedException error) { Thread.currentThread().interrupt(); throw new IOException(error); }
                }
                @Override public int read(byte[] buffer) throws IOException {
                    int first = read();
                    if (first < 0) return -1;
                    buffer[0] = (byte) first;
                    int count = 1;
                    while (count < buffer.length) {
                        Integer next = reply.poll();
                        if (next == null) break;
                        if (next < 0) { reply.offer(-1); break; }
                        buffer[count++] = (byte) (int) next;
                    }
                    return count;
                }
                @Override public void close() { reply.offer(-1); }
            };
            OutputStream output = new OutputStream() {
                @Override public void write(int value) { sent.write(value); }
                @Override public void flush() {
                    for (byte value : response) reply.offer(value & 0xff);
                    written.countDown();
                }
            };
            civ = new IcR30Civ(input, output, timeout);
            transports.add(this);
        }
    }

    @Test public void decodesSmeterAsBcdNotBinary() throws Exception {
        assertEquals(0, IcR30Civ.decodeSmeter(bytes(0, 0)));
        assertEquals(153, IcR30Civ.decodeSmeter(bytes(1, 0x53)));
        assertEquals(255, IcR30Civ.decodeSmeter(bytes(2, 0x55)));
    }
    @Test public void rejectsInvalidSmeter() {
        assertThrows(IOException.class, () -> IcR30Civ.decodeSmeter(bytes(2, 0x56)));
        assertThrows(IOException.class, () -> IcR30Civ.decodeSmeter(bytes(0xfa, 0)));
        assertThrows(IOException.class, () -> IcR30Civ.decodeSmeter(bytes(0)));
    }
    @Test public void decodesAndEncodesLittleEndianFrequency() throws Exception {
        assertEquals(145520000L, IcR30Civ.decodeFrequency(bytes(0, 0, 0x52, 0x45, 1)));
        assertArrayEquals(bytes(5, 0, 0, 0x52, 0x45, 1), IcR30Civ.frequencyCommand(145520000L));
        assertEquals(3304999000L, IcR30Civ.decodeFrequency(bytes(0, 0x90, 0x99, 4, 0x33)));
        assertThrows(IllegalArgumentException.class, () -> IcR30Civ.frequencyCommand(99999));
        assertThrows(IllegalArgumentException.class, () -> IcR30Civ.frequencyCommand(3304999001L));
        assertThrows(IOException.class, () -> IcR30Civ.decodeFrequency(bytes(0, 0)));
        assertThrows(IOException.class, () -> IcR30Civ.decodeFrequency(bytes(0, 0, 0, 0, 0)));
    }
    @Test public void readsFragmentedFrameAndSendsExactSmeterQuery() throws Exception {
        Transport transport = new Transport(bytes(0xfe, 0xfe, 0xe0, 0x9c, 0x15, 2, 1, 0x53, 0xfd), 100);
        assertEquals(153, transport.civ.smeter());
        assertArrayEquals(bytes(0xfe, 0xfe, 0x9c, 0xe0, 0x15, 2, 0xfd), transport.sent.toByteArray());
    }
    @Test public void ignoresEchoNoiseOtherAddressesAndCommands() throws Exception {
        Transport transport = new Transport(bytes(
            1, 2, 0xfd, 0xfe, 0xfe, 0x9c, 0xe0, 3, 0xfd,
            0xfe, 0xfe, 0xe0, 0x90, 3, 0, 0, 0, 0, 1, 0xfd,
            0xfe, 0xfe, 0xe0, 0x9c, 0x15, 2, 0, 0, 0xfd,
            0xfe, 0xfe, 0xfe, 0xe0, 0x9c, 3, 0, 0, 0x52, 0x45, 1, 0xfd), 100);
        assertEquals(145520000L, transport.civ.frequency());
    }
    @Test public void writeRequiresAckAndReportsRejection() throws Exception {
        Transport accepted = new Transport(bytes(0xfe, 0xfe, 0xe0, 0x9c, 0xfb, 0xfd), 100);
        accepted.civ.setFrequency(145520000L);
        assertArrayEquals(bytes(0xfe, 0xfe, 0x9c, 0xe0, 5, 0, 0, 0x52, 0x45, 1, 0xfd), accepted.sent.toByteArray());
        Transport refused = new Transport(bytes(0xfe, 0xfe, 0xe0, 0x9c, 0xfa, 0xfd), 100);
        assertTrue(assertThrows(IOException.class, () -> refused.civ.setMode("CW")).getMessage().contains("FA"));
        Transport echoOnly = new Transport(bytes(0xfe, 0xfe, 0x9c, 0xe0, 6, 3, 1, 0xfd), 10);
        assertThrows(IOException.class, () -> echoOnly.civ.setMode("CW"));
    }
    @Test public void modeCodesAreAllowlistedAndValidated() throws Exception {
        assertArrayEquals(bytes(6, 3, 1), IcR30Civ.modeCommand("CW"));
        assertArrayEquals(bytes(6, 5, 2), IcR30Civ.modeCommand("FM-N"));
        assertThrows(IllegalArgumentException.class, () -> IcR30Civ.modeCommand("raw"));
        Transport known = new Transport(bytes(0xfe, 0xfe, 0xe0, 0x9c, 4, 3, 1, 0xfd), 100);
        assertEquals("CW", known.civ.mode());
        Transport invalid = new Transport(bytes(0xfe, 0xfe, 0xe0, 0x9c, 4, 0x55, 1, 0xfd), 100);
        assertThrows(IOException.class, () -> invalid.civ.mode());
    }
    @Test public void timeoutDoesNotReturnOldMeasurement() {
        Transport empty = new Transport(new byte[0], 10);
        String message = assertThrows(IOException.class, empty.civ::frequency).getMessage();
        assertTrue(message.contains("시간 초과"));
        assertTrue(message.contains("명령 03"));
        assertTrue(message.contains("수신 0바이트"));
    }
    @Test public void readsResponsesEvenWhenAvailableAlwaysReturnsZero() throws Exception {
        Transport transport = new Transport(bytes(0xfe, 0xfe, 0xe0, 0x9c, 3, 0, 0, 0x52, 0x45, 1, 0xfd), 100);
        assertEquals(145520000L, transport.civ.frequency());
        assertEquals(145520000L, transport.civ.frequency());
    }
    @Test public void closedSessionRejectsFurtherQueries() throws Exception {
        Transport transport = new Transport(new byte[0], 100);
        transport.civ.close();
        assertThrows(IOException.class, transport.civ::frequency);
    }
    @Test public void waitsForDelayedFragmentsWithoutUsingAvailable() throws Exception {
        Transport transport = new Transport(new byte[0], 1000);
        CompletableFuture<Long> result = CompletableFuture.supplyAsync(() -> {
            try { return transport.civ.frequency(); }
            catch (IOException error) { throw new java.util.concurrent.CompletionException(error); }
        });
        assertTrue(transport.written.await(1, TimeUnit.SECONDS));
        assertFalse(result.isDone());
        for (byte value : bytes(0xfe, 0xfe, 0xe0, 0x9c, 3, 0, 0, 0x52, 0x45, 1, 0xfd)) transport.reply.offer(value & 0xff);
        assertEquals(Long.valueOf(145520000), result.get(1, TimeUnit.SECONDS));
    }
    @Test public void closingSessionUnblocksAnOutstandingQuery() throws Exception {
        Transport transport = new Transport(new byte[0], 10000);
        CompletableFuture<String> result = CompletableFuture.supplyAsync(() -> {
            try { transport.civ.frequency(); return "unexpected success"; }
            catch (IOException error) { return error.getMessage(); }
        });
        assertTrue(transport.written.await(1, TimeUnit.SECONDS));
        transport.civ.close();
        assertNotEquals("unexpected success", result.get(1, TimeUnit.SECONDS));
    }
    @Test public void rejectsUnboundedFrames() {
        Transport oversized = new Transport(new byte[1025], 100);
        assertThrows(IOException.class, oversized.civ::frequency);
    }
}
