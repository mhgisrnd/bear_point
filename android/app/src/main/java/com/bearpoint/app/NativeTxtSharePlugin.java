package com.bearpoint.app;

import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.util.Log;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

@CapacitorPlugin(name = "NativeTxtShare")
public class NativeTxtSharePlugin extends Plugin {
    private static final String TAG = "NativeTxtShare";

    @PluginMethod
    public void openFile(PluginCall call) {
        String uriString = call.getString("uri");
        String fileName = call.getString("fileName", "");
        String dialogTitle = call.getString("dialogTitle", "파일 열기");

        if (uriString == null || uriString.trim().isEmpty()) {
            call.reject("uri is required");
            return;
        }

        try {
            Uri targetUri = normalizeToShareableUri(uriString.trim());
            String mimeType = guessMimeType(uriString, fileName);
            boolean opened = tryOpenFileIntent(targetUri, mimeType, fileName, dialogTitle);
            if (!opened && !"*/*".equals(mimeType)) {
                opened = tryOpenFileIntent(targetUri, "*/*", fileName, dialogTitle);
                if (opened) {
                    mimeType = "*/*";
                }
            }
            if (!opened) {
                call.reject("No app can open this file type");
                return;
            }

            JSObject result = new JSObject();
            result.put("ok", true);
            result.put("uri", targetUri.toString());
            result.put("mimeType", mimeType);
            call.resolve(result);
        } catch (Exception ex) {
            Log.e(TAG, "openFile failed: " + ex.getMessage(), ex);
            call.reject("openFile failed: " + ex.getMessage());
        }
    }

    private boolean tryOpenFileIntent(Uri targetUri, String mimeType, String fileName, String dialogTitle) {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(targetUri, mimeType);
            intent.addCategory(Intent.CATEGORY_DEFAULT);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

            ClipData clip = ClipData.newUri(
                getContext().getContentResolver(),
                (fileName != null && !fileName.isEmpty()) ? fileName : "file",
                targetUri
            );
            intent.setClipData(clip);

            PackageManager packageManager = getContext().getPackageManager();
            List<ResolveInfo> resInfos = packageManager.queryIntentActivities(intent, 0);
            for (ResolveInfo resolveInfo : resInfos) {
                String packageName = resolveInfo.activityInfo.packageName;
                getContext().grantUriPermission(packageName, targetUri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            }

            Intent chooser = Intent.createChooser(intent, dialogTitle);
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            chooser.setClipData(clip);
            getContext().startActivity(chooser);
            return true;
        } catch (ActivityNotFoundException notFound) {
            Log.w(TAG, "No activity for mimeType=" + mimeType + ", uri=" + targetUri);
            return false;
        }
    }

    @PluginMethod
    public void shareTxtFile(PluginCall call) {
        String fileName = call.getString("fileName");
        String txtContent = call.getString("txtContent", "");
        String dialogTitle = call.getString("dialogTitle", "파일 공유");

        if (fileName == null || fileName.trim().isEmpty()) {
            call.reject("fileName is required");
            return;
        }

        try {
            // Java가 직접 Cache에 파일을 쓴다 — JS의 file:// URI 경로 해석 오류 없음
            File shareFile = writeTxtToShareCache(fileName.trim(), txtContent);
            Log.d(TAG, "shareTxtFile start file=" + shareFile.getAbsolutePath() + ", bytes=" + shareFile.length());

            Uri contentUri = FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                shareFile
            );
            Log.d(TAG, "contentUri=" + contentUri);

            Intent intent = new Intent(Intent.ACTION_SEND_MULTIPLE);
            intent.setType("*/*");
            ArrayList<Uri> streamUris = new ArrayList<>();
            streamUris.add(contentUri);
            intent.putParcelableArrayListExtra(Intent.EXTRA_STREAM, streamUris);
            ClipData clip = ClipData.newUri(getContext().getContentResolver(), shareFile.getName(), contentUri);
            intent.setClipData(clip);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

            PackageManager packageManager = getContext().getPackageManager();
            List<ResolveInfo> resInfos = packageManager.queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY);
            for (ResolveInfo resolveInfo : resInfos) {
                String packageName = resolveInfo.activityInfo.packageName;
                getContext().grantUriPermission(packageName, contentUri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION);
                Log.d(TAG, "grantUriPermission -> " + packageName);
            }

            Intent chooser = Intent.createChooser(intent, dialogTitle);
            // chooser 자체에도 FLAG 부여 — chooser 경유 시 권한 전달을 보장
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            chooser.setClipData(clip);
            Log.d(TAG, "launch chooser share uri=" + contentUri);
            getContext().startActivity(chooser);

            JSObject result = new JSObject();
            result.put("ok", true);
            result.put("path", shareFile.getAbsolutePath());
            call.resolve(result);
        } catch (Exception ex) {
            Log.e(TAG, "native share failed: " + ex.getMessage(), ex);
            call.reject("native share failed: " + ex.getMessage());
        }
    }

    private File writeTxtToShareCache(String fileName, String content) throws Exception {
        File cacheRoot = new File(getContext().getCacheDir(), "share");
        if (!cacheRoot.exists() && !cacheRoot.mkdirs()) {
            throw new IllegalStateException("Failed to create cache/share directory");
        }
        File cacheFile = new File(cacheRoot, fileName);
        try (OutputStream out = new FileOutputStream(cacheFile, false)) {
            byte[] bytes = (content != null ? content : "").getBytes(StandardCharsets.UTF_8);
            out.write(bytes);
            out.flush();
        }
        return cacheFile;
    }

    private Uri normalizeToShareableUri(String uriString) {
        Uri parsed = Uri.parse(uriString);
        String scheme = parsed.getScheme() != null ? parsed.getScheme().toLowerCase() : "";

        if ("content".equals(scheme)) {
            return parsed;
        }

        if ("file".equals(scheme)) {
            File file = new File(parsed.getPath());
            return FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                file
            );
        }

        File maybeFile = new File(uriString);
        if (maybeFile.exists()) {
            return FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                maybeFile
            );
        }

        return parsed;
    }

    private String guessMimeType(String uriString, String fileName) {
        String lower = (fileName != null ? fileName : "").toLowerCase();
        if (lower.isEmpty() && uriString != null) {
            lower = uriString.toLowerCase();
        }

        if (lower.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
        if (lower.endsWith(".xls")) return "application/vnd.ms-excel";
        if (lower.endsWith(".txt")) return "text/plain";
        if (lower.endsWith(".csv")) return "text/csv";
        return "*/*";
    }
}