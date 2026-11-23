package com.bearpoint.app;

import android.app.Activity;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.Intent;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import java.util.zip.ZipOutputStream;

final class SdrDiagnosticExport {
    private static final ExecutorService writer = Executors.newSingleThreadExecutor();

    private SdrDiagnosticExport() {}

    interface ArchiveResolver {
        File resolve(String id) throws IOException;
    }

    static List<File> selectedFiles(PluginCall call, ArchiveResolver resolver) throws IOException {
        JSArray ids = call.getArray("ids");
        List<File> files = new ArrayList<>();
        if (ids == null) {
            files.add(resolver.resolve(call.getString("id", "")));
        } else {
            if (ids.length() == 0) throw new IOException("내보낼 진단 기록을 선택하세요.");
            for (int i = 0; i < ids.length(); i++) {
                String id = ids.optString(i, "");
                if (id.isEmpty()) throw new IOException("올바른 진단 기록을 선택하세요.");
                files.add(resolver.resolve(id));
            }
        }
        return files;
    }

    static void share(Activity activity, List<File> archives, String title) {
        ArrayList<Uri> uris = new ArrayList<>();
        for (File archive : archives) {
            uris.add(FileProvider.getUriForFile(activity, activity.getPackageName() + ".fileprovider", archive));
        }
        ClipData clip = ClipData.newRawUri(title, uris.get(0));
        for (int i = 1; i < uris.size(); i++) clip.addItem(new ClipData.Item(uris.get(i)));
        Intent send = new Intent(uris.size() == 1 ? Intent.ACTION_SEND : Intent.ACTION_SEND_MULTIPLE)
            .setType("application/zip").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        send.setClipData(clip);
        if (uris.size() == 1) send.putExtra(Intent.EXTRA_STREAM, uris.get(0));
        else send.putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris);
        activity.startActivity(Intent.createChooser(send, title));
    }

    static void shareSelection(PluginCall call, Activity activity, ArchiveResolver resolver, String title) {
        writer.execute(() -> {
            try {
                List<File> archives = selectedFiles(call, resolver);
                activity.runOnUiThread(() -> {
                    try {
                        share(activity, archives, title);
                        call.resolve();
                    } catch (RuntimeException error) {
                        call.reject("ZIP 공유 실패: " + error.getMessage(), error);
                    }
                });
            } catch (IOException | RuntimeException error) {
                call.reject("ZIP 공유 실패: " + error.getMessage(), error);
            }
        });
    }

    static Intent createDocument(String filename) {
        return new Intent(Intent.ACTION_CREATE_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType("application/zip")
            .putExtra(Intent.EXTRA_TITLE, filename);
    }

    static Uri destination(PluginCall call, ActivityResult result) {
        if (call == null) return null;
        if (result.getResultCode() != Activity.RESULT_OK) {
            call.resolve();
            return null;
        }
        Intent data = result.getData();
        Uri uri = data == null ? null : data.getData();
        if (uri == null) call.reject("파일을 저장할 위치를 확인하지 못했습니다.");
        return uri;
    }

    static void copy(PluginCall call, ContentResolver resolver, ArchiveResolver archives, Uri destination) {
        writer.execute(() -> {
            try {
                List<File> files = selectedFiles(call, archives);
                try (OutputStream output = resolver.openOutputStream(destination)) {
                    if (output == null) throw new IOException("선택한 파일을 열 수 없습니다.");
                    writeArchives(files, output);
                }
            } catch (IOException | RuntimeException error) {
                call.reject("ZIP 저장 실패: " + error.getMessage(), error);
                return;
            }
            call.resolve();
        });
    }

    static void writeArchives(List<File> archives, OutputStream output) throws IOException {
        byte[] buffer = new byte[64 * 1024];
        if (archives.size() == 1) {
            copyArchive(archives.get(0), output, buffer);
            return;
        }
        try (ZipOutputStream bundle = new ZipOutputStream(output)) {
            bundle.setLevel(java.util.zip.Deflater.NO_COMPRESSION);
            for (int i = 0; i < archives.size(); i++) {
                File archive = archives.get(i);
                bundle.putNextEntry(new ZipEntry(String.format(Locale.ROOT, "%02d-%s", i + 1, archive.getName())));
                copyArchive(archive, bundle, buffer);
                bundle.closeEntry();
            }
        }
    }

    private static void copyArchive(File archive, OutputStream output, byte[] buffer) throws IOException {
        try (FileInputStream input = new FileInputStream(archive)) {
            int count;
            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
        }
    }

    static void prepareAudioPreview(PluginCall call, File cache, File archive) {
        writer.execute(() -> {
            try {
                File preview = extractAudioPreview(cache, archive);
                call.resolve(new JSObject().put("uri", Uri.fromFile(preview).toString()));
            } catch (IOException | RuntimeException error) {
                call.reject("수신음을 열지 못했습니다: " + error.getMessage(), error);
            }
        });
    }

    static File extractAudioPreview(File cache, File archive) throws IOException {
        final long limit = 4L * 1024 * 1024;
        try (ZipFile zip = new ZipFile(archive)) {
            ZipEntry audio = zip.getEntry("received-audio.wav");
            if (audio == null || audio.getSize() <= 44 || audio.getSize() > limit)
                throw new IOException("이 기록에 재생할 수신음이 없습니다.");
            File directory = new File(cache, "sdr-audio-preview");
            if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("미리 듣기 공간을 만들지 못했습니다.");
            File[] previous = directory.listFiles((dir, name) -> name.startsWith("preview-") && name.endsWith(".wav"));
            if (previous != null) for (File file : previous) file.delete();
            File preview = File.createTempFile("preview-", ".wav", directory);
            try (InputStream input = zip.getInputStream(audio); OutputStream output = new FileOutputStream(preview)) {
                byte[] buffer = new byte[8192];
                long remaining = audio.getSize();
                int count;
                while ((count = input.read(buffer)) != -1) {
                    remaining -= count;
                    if (remaining < 0) throw new IOException("수신음 파일 크기가 올바르지 않습니다.");
                    output.write(buffer, 0, count);
                }
                if (remaining != 0) throw new IOException("수신음 파일 일부가 누락되었습니다.");
            } catch (IOException error) {
                preview.delete();
                throw error;
            }
            return preview;
        }
    }
}
