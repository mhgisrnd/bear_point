package com.bearpoint.app;

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
            // ClipData는 버전 무관하게 항상 설정 — 미설정 시 chooser를 거치면 URI 권한이 소멸됨
            ClipData clip = ClipData.newUri(getContext().getContentResolver(), shareFile.getName(), contentUri);
            intent.setClipData(clip);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

            // 대상 앱들에 URI 권한 명시 부여 (카카오 등 엄격한 권한 체크 대응)
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
}