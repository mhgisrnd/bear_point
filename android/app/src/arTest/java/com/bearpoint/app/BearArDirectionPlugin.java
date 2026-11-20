package com.bearpoint.app;

import android.Manifest;
import android.graphics.Color;
import android.graphics.drawable.Drawable;
import android.util.Log;
import android.view.ViewGroup;
import android.webkit.WebView;
import androidx.coordinatorlayout.widget.CoordinatorLayout;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.ar.core.ArCoreApk;
import com.google.ar.core.Config;
import com.google.ar.core.Session;

@CapacitorPlugin(name = "BearArDirection", permissions = @Permission(alias = "camera", strings = Manifest.permission.CAMERA))
public final class BearArDirectionPlugin extends Plugin {
    private Session session;
    private ArDirectionPreview preview;
    private Drawable webBackground;
    private boolean promptedInstall;
    private boolean sessionResumed;
    private int revision;

    @PluginMethod public void availability(PluginCall call) {
        getActivity().runOnUiThread(() -> ArCoreApk.getInstance().checkAvailabilityAsync(getActivity(),
                available -> call.resolve(new JSObject().put("supported", available.isSupported()))));
    }

    @PluginMethod public void start(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (!ArCoreApk.getInstance().checkAvailability(getActivity()).isSupported()) {
                call.reject("이 기기는 ARCore 방향 실험을 지원하지 않아요.");
                return;
            }
            if (getPermissionState("camera") != PermissionState.GRANTED) requestPermissionForAlias("camera", call, "cameraResult");
            else open(call);
        });
    }

    @PermissionCallback private void cameraResult(PluginCall call) {
        if (getPermissionState("camera") == PermissionState.GRANTED) open(call);
        else call.reject("카메라 권한을 허용해야 ARCore 방향 실험을 열 수 있어요.");
    }

    private void open(PluginCall call) {
        if (session != null) { call.resolve(new JSObject().put("active", true)); return; }
        try {
            ArCoreApk.InstallStatus status = ArCoreApk.getInstance().requestInstall(getActivity(), !promptedInstall);
            if (status == ArCoreApk.InstallStatus.INSTALL_REQUESTED) {
                promptedInstall = true;
                call.resolve(new JSObject().put("active", false).put("installRequested", true));
                return;
            }
            promptedInstall = false;
            session = new Session(getContext());
            Config config = new Config(session);
            config.setFocusMode(Config.FocusMode.AUTO);
            config.setPlaneFindingMode(Config.PlaneFindingMode.DISABLED);
            config.setLightEstimationMode(Config.LightEstimationMode.DISABLED);
            config.setUpdateMode(Config.UpdateMode.BLOCKING);
            session.configure(config);
            session.resume();
            sessionResumed = true;
            WebView web = getBridge().getWebView();
            ViewGroup parent = (ViewGroup) web.getParent();
            final int token = ++revision;
            preview = new ArDirectionPreview(getContext(), session, new ArDirectionPreview.Listener() {
                @Override public void pose(Double yaw, String reason) {
                    getActivity().runOnUiThread(() -> {
                        if (token != revision) return;
                        JSObject event = new JSObject().put("state", yaw == null ? "paused" : "tracking").put("reason", reason);
                        if (yaw != null) event.put("yaw", yaw);
                        notifyListeners("pose", event);
                    });
                }
                @Override public void failed() {
                    getActivity().runOnUiThread(() -> { if (token == revision) close(true); });
                }
            });
            webBackground = web.getBackground();
            web.setBackgroundColor(Color.TRANSPARENT);
            parent.addView(preview, parent.indexOfChild(web), new CoordinatorLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            preview.onResume();
            call.resolve(new JSObject().put("active", true));
        } catch (Exception error) {
            Log.w("BearArDirection", "AR session could not start", error);
            close(false);
            promptedInstall = false;
            call.reject("ARCore 카메라를 시작하지 못했어요. Google Play Services for AR과 카메라 사용 상태를 확인하세요.");
        }
    }

    @PluginMethod public void stop(PluginCall call) {
        getActivity().runOnUiThread(() -> { close(false); call.resolve(); });
    }

    private void close(boolean notify) {
        if (session == null) return;
        revision++;
        if (preview != null) {
            preview.onPause();
            if (preview.getParent() instanceof ViewGroup) ((ViewGroup) preview.getParent()).removeView(preview);
            preview = null;
            WebView web = getBridge().getWebView();
            web.setBackgroundColor(Color.WHITE);
            if (webBackground != null) web.setBackground(webBackground);
            webBackground = null;
        }
        if (sessionResumed) session.pause();
        sessionResumed = false;
        session.close();
        session = null;
        if (notify) notifyListeners("pose", new JSObject().put("state", "stopped"));
    }

    @Override protected void handleOnPause() { close(true); }
    @Override protected void handleOnDestroy() { close(false); }
}
