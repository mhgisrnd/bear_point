package com.bearpoint.app;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.ActivityCallback;
import java.io.*;
import java.net.*;
import java.security.MessageDigest;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONObject;

@CapacitorPlugin(name = "AppUpdate")
public final class AppUpdatePlugin extends Plugin {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final AtomicBoolean busy = new AtomicBoolean();
    private volatile boolean cancelled;
    private volatile HttpURLConnection connection;
    private volatile JSONObject downloaded;
    private volatile boolean installerOpen;

    private PackageInfo installed() throws Exception {
        return getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), signatureFlags());
    }
    @SuppressWarnings("deprecation")
    private static int signatureFlags() {
        return Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
    }
    @SuppressWarnings("deprecation")
    private static long code(PackageInfo info) { return Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode; }
    @SuppressWarnings("deprecation")
    private static String signer(PackageInfo info) throws Exception {
        Signature[] signatures = Build.VERSION.SDK_INT >= 28
            ? (info.signingInfo == null ? null : info.signingInfo.getApkContentsSigners()) : info.signatures;
        if (signatures == null || signatures.length != 1) throw new IOException("앱 서명을 확인할 수 없습니다.");
        return AppUpdatePolicy.hex(MessageDigest.getInstance("SHA-256").digest(signatures[0].toByteArray()));
    }
    private JSObject info() throws Exception {
        PackageInfo current = installed();
        JSONObject pending = pending();
        return new JSObject().put("packageName", current.packageName).put("versionName", current.versionName)
            .put("versionCode", code(current)).put("update", pending == null ? JSONObject.NULL : pending)
            .put("downloadReady", pending != null);
    }
    private JSONObject pending() throws Exception {
        if (downloaded == null) {
            String value = new AppUpdateCache(folder()).read();
            if (value != null) {
                try { downloaded = new JSONObject(value); }
                catch (org.json.JSONException invalid) { new AppUpdateCache(folder()).clear(); }
            }
        }
        if (downloaded == null) return null;
        File file = new File(folder(), "BearMap.apk");
        try {
            validate(downloaded);
            if (!file.isFile() || file.length() != downloaded.getLong("fileSize")) throw new IOException("APK 파일이 없습니다.");
            return downloaded;
        } catch (Exception stale) {
            downloaded = null; new AppUpdateCache(folder()).clear(); return null;
        }
    }
    private interface Work { void run() throws Exception; }
    private void run(PluginCall call, Work operation) {
        if (!busy.compareAndSet(false, true)) { call.reject("업데이트 작업이 진행 중입니다."); return; }
        cancelled = false;
        worker.execute(() -> {
            try { operation.run(); }
            catch (Exception e) { android.util.Log.w("BearAppUpdate", "Update operation failed", e); call.reject(cancelled ? "다운로드를 취소했습니다." : message(e)); }
            finally { busy.set(false); }
        });
    }
    private String message(Exception e) {
        if (e instanceof java.net.SocketTimeoutException || e instanceof java.net.UnknownHostException
                || e instanceof javax.net.ssl.SSLException)
            return "업데이트 서버에 연결하지 못했습니다. 인터넷 연결을 확인하고 다시 시도해주세요.";
        if (e instanceof IllegalArgumentException || e instanceof IOException && !(e instanceof java.net.SocketException))
            return e.getMessage() == null ? "업데이트 처리에 실패했습니다." : e.getMessage();
        return "업데이트 서버에 연결하지 못했습니다. 인터넷 연결을 확인하고 다시 시도해주세요.";
    }
    @PluginMethod public void getInfo(PluginCall call) {
        try { call.resolve(info()); } catch (Exception e) { call.reject("현재 앱 버전을 확인하지 못했습니다."); }
    }
    private HttpURLConnection open(URI uri) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) uri.toURL().openConnection();
        conn.setConnectTimeout(15000); conn.setReadTimeout(30000); conn.setInstanceFollowRedirects(false);
        conn.setUseCaches(false); conn.setRequestProperty("Accept-Encoding", "identity");
        connection = conn;
        int status = conn.getResponseCode();
        if (status != 200) {
            conn.disconnect(); connection = null;
            throw new IOException(status == 409 ? "배포 버전이 변경되었습니다. 업데이트를 다시 확인해주세요."
                : "업데이트 서버 응답을 확인해주세요. (HTTP " + status + ")");
        }
        return conn;
    }
    private JSONObject latest(URI endpoint) throws Exception {
        HttpURLConnection conn = open(endpoint);
        try (InputStream input = conn.getInputStream(); ByteArrayOutputStream buffer = new ByteArrayOutputStream()) {
            byte[] block = new byte[4096]; int count;
            while ((count = input.read(block)) != -1) {
                if (buffer.size() + count > 65536) throw new IOException("업데이트 정보가 올바르지 않습니다.");
                buffer.write(block, 0, count);
            }
            JSONObject result = new JSONObject(buffer.toString("UTF-8"));
            if (!result.optBoolean("ok")) throw new IOException("업데이트 정보를 확인할 수 없습니다.");
            return result;
        } finally { conn.disconnect(); connection = null; }
    }
    private void validate(JSONObject release) throws Exception {
        PackageInfo current = installed();
        if (!release.optBoolean("available") || !current.packageName.equals(release.optString("packageName")))
            throw new IllegalArgumentException("설치 가능한 업데이트가 없습니다.");
        AppUpdatePolicy.release(code(current), release.getLong("versionCode"), release.getLong("fileSize"), release.getInt("minSdk"), Build.VERSION.SDK_INT);
        try { AppUpdatePolicy.hash(release.getString("signerSha256"), signer(current)); }
        catch (IllegalArgumentException mismatch) { throw new IllegalArgumentException("설치된 앱과 배포 APK의 서명이 다릅니다. 관리자에게 확인해주세요."); }
        if (!release.getString("fileSha256").matches("(?i)[0-9a-f]{64}")) throw new IOException("APK 해시를 확인할 수 없습니다.");
    }
    @PluginMethod public void check(PluginCall call) {
        run(call, () -> {
            URI endpoint = AppUpdatePolicy.endpoint(call.getString("apiUrl", ""));
            JSONObject release = latest(endpoint);
            JSObject result = info();
            if (release.optBoolean("available") && release.optLong("versionCode") > installedCode()) {
                validate(release); AppUpdatePolicy.download(endpoint, release.getString("downloadUrl"));
                result.put("update", release);
                JSONObject cached = pending();
                result.put("downloadReady", cached != null && release.getString("fileSha256").equals(cached.optString("fileSha256")));
            } else result.put("update", JSONObject.NULL);
            call.resolve(result);
        });
    }
    private long installedCode() throws Exception { return code(installed()); }
    private File folder() throws IOException {
        // Keep a verified APK across permission settings, Activity recreation and cache eviction.
        File directory = new File(getContext().getFilesDir(), "app-updates");
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("APK 저장 공간을 준비하지 못했습니다.");
        return directory;
    }
    private void progress(long received, long total) {
        notifyListeners("progress", new JSObject().put("received", received).put("total", total));
    }
    @PluginMethod public void download(PluginCall call) {
        run(call, () -> {
            URI endpoint = AppUpdatePolicy.endpoint(call.getString("apiUrl", ""));
            JSONObject release = latest(endpoint); validate(release);
            AppUpdatePolicy.hash(call.getString("sha256", ""), release.getString("fileSha256"));
            long size = release.getLong("fileSize"); File directory = folder();
            File partial = new File(directory, "BearMap.partial.apk"), target = new File(directory, "BearMap.apk");
            downloaded = null;
            new AppUpdateCache(directory).clear();
            if (target.exists() && !target.delete()) throw new IOException("이전 APK 파일을 정리하지 못했습니다.");
            if (partial.exists() && !partial.delete()) throw new IOException("미완성 APK 파일을 정리하지 못했습니다.");
            File legacy = new File(new File(getContext().getCacheDir(), "app-updates"), "BearMap.apk");
            if (legacy.exists() && !legacy.delete()) throw new IOException("이전 APK 파일을 정리하지 못했습니다.");
            if (directory.getUsableSpace() < size + 64L * 1024 * 1024) throw new IOException("APK 다운로드에 필요한 저장 공간이 부족합니다.");
            HttpURLConnection conn = null;
            try {
                conn = open(AppUpdatePolicy.download(endpoint, release.getString("downloadUrl")));
                MessageDigest digest = MessageDigest.getInstance("SHA-256");
                long received = 0, lastProgress = 0;
                try (InputStream input = conn.getInputStream(); FileOutputStream output = new FileOutputStream(partial)) {
                    byte[] block = new byte[65536]; int count;
                    while ((count = input.read(block)) != -1) {
                        if (cancelled) throw new IOException("다운로드를 취소했습니다.");
                        received += count;
                        if (received > size) throw new IOException("APK 크기가 배포 정보와 다릅니다.");
                        output.write(block, 0, count); digest.update(block, 0, count);
                        long now = android.os.SystemClock.elapsedRealtime();
                        if (now - lastProgress >= 250) { progress(received, size); lastProgress = now; }
                    }
                    if (cancelled) throw new IOException("다운로드를 취소했습니다.");
                    if (received != size) throw new IOException("APK 다운로드가 완료되지 않았습니다. 다시 시도해주세요.");
                    output.getFD().sync();
                }
                AppUpdatePolicy.hash(release.getString("fileSha256"), AppUpdatePolicy.hex(digest.digest()));
                verifyArchive(partial, release);
                if (cancelled) throw new IOException("다운로드를 취소했습니다.");
                if (!partial.renameTo(target)) throw new IOException("APK 파일을 저장하지 못했습니다.");
                new AppUpdateCache(directory).save(release.toString());
                downloaded = release; progress(size, size); call.resolve(new JSObject().put("ready", true));
            } finally {
                if (conn != null) conn.disconnect(); connection = null;
                if (partial.exists()) partial.delete();
            }
        });
    }
    private void verifyArchive(File file, JSONObject release) throws Exception {
        PackageInfo archive = getContext().getPackageManager().getPackageArchiveInfo(file.getAbsolutePath(), signatureFlags());
        if (archive == null || !getContext().getPackageName().equals(archive.packageName)
                || code(archive) != release.getLong("versionCode") || !release.getString("versionName").equals(archive.versionName))
            throw new IOException("다운로드한 APK의 앱 또는 버전 정보가 다릅니다.");
        AppUpdatePolicy.hash(release.getString("signerSha256"), signer(archive));
        AppUpdatePolicy.hash(signer(installed()), signer(archive));
        if (Build.VERSION.SDK_INT >= 24 && archive.applicationInfo.minSdkVersion > Build.VERSION.SDK_INT)
            throw new IOException("이 기기에 설치할 수 없는 APK입니다.");
    }
    @PluginMethod public void cancelDownload(PluginCall call) {
        cancelled = true;
        HttpURLConnection conn = connection; if (conn != null) conn.disconnect();
        call.resolve();
    }
    @PluginMethod public void install(PluginCall call) {
        if (installerOpen) { call.reject("설치 화면이 이미 열려 있습니다. 설치를 완료하거나 취소한 뒤 다시 시도해주세요."); return; }
        run(call, () -> {
            if (pending() == null) { call.reject("APK 파일이 없습니다. 다시 다운로드해주세요.", "APK_MISSING"); return; }
            File file = new File(folder(), "BearMap.apk"); validate(downloaded);
            if (!file.isFile() || file.length() != downloaded.getLong("fileSize")) throw new IOException("APK 파일이 없습니다. 다시 다운로드해주세요.");
            if (Build.VERSION.SDK_INT >= 26 && !getContext().getPackageManager().canRequestPackageInstalls()) {
                // Download already verified the file. Ask permission before another expensive full-file check.
                getActivity().runOnUiThread(() -> requestInstallPermission(call));
                return;
            }
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            try (InputStream input = new FileInputStream(file)) {
                byte[] block = new byte[65536]; int count;
                while ((count = input.read(block)) != -1) digest.update(block, 0, count);
            }
            AppUpdatePolicy.hash(downloaded.getString("fileSha256"), AppUpdatePolicy.hex(digest.digest()));
            verifyArchive(file, downloaded);
            getActivity().runOnUiThread(() -> {
                try {
                    if (SdrScanService.isRunning() || GpsTrackService.running()) {
                        call.reject("수신 또는 이동기록을 종료한 뒤 업데이트를 설치해주세요."); return;
                    }
                    if (Build.VERSION.SDK_INT >= 26 && !getContext().getPackageManager().canRequestPackageInstalls()) {
                        requestInstallPermission(call);
                        return;
                    }
                    Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
                    // Let the installer show its completion screen and Open button. The old
                    // app process may be killed during replacement before it receives a result.
                    Intent intent = new Intent(Intent.ACTION_INSTALL_PACKAGE).setDataAndType(uri, "application/vnd.android.package-archive")
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    intent.setClipData(android.content.ClipData.newRawUri("BearMap APK", uri));
                    installerOpen = true;
                    startActivityForResult(call, intent, "installerResult");
                } catch (Exception e) {
                    installerOpen = false; android.util.Log.w("BearAppUpdate", "Installer handoff failed", e);
                    call.reject("설치 화면을 열지 못했습니다. 기기의 앱 설치 설정을 확인해주세요. (" + e.getClass().getSimpleName() + ")");
                }
            });
        });
    }
    private void requestInstallPermission(PluginCall call) {
        try {
            startActivityForResult(call, new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:" + getContext().getPackageName())), "installPermissionResult");
        } catch (Exception error) {
            android.util.Log.w("BearAppUpdate", "Install permission settings failed", error);
            call.reject("앱 설치 허용 설정을 열지 못했습니다. 기기 설정에서 앱 설치 허용을 확인해주세요.");
        }
    }
    @ActivityCallback private void installPermissionResult(PluginCall call, ActivityResult result) {
        if (call == null) return; // A recreated WebView restores the verified APK through getInfo/check.
        if (Build.VERSION.SDK_INT < 26 || getContext().getPackageManager().canRequestPackageInstalls()) {
            // The resultCode is not reliable for this settings screen; check the actual permission.
            install(call);
        } else call.resolve(new JSObject().put("permissionRequired", true));
    }
    @ActivityCallback private void installerResult(PluginCall call, ActivityResult result) {
        installerOpen = false;
        // Android displays the install outcome. A return to this WebView just allows retry.
        if (call != null) call.resolve(new JSObject().put("installerClosed", true));
    }
    @Override protected void handleOnDestroy() {
        cancelled = true; HttpURLConnection conn = connection; if (conn != null) conn.disconnect();
        worker.shutdown();
    }
}
