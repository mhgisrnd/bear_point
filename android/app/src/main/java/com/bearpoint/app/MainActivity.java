package com.bearpoint.app;

import android.os.Bundle;
import android.util.Log;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.BridgeActivity;
import com.google.firebase.FirebaseApp;
import com.google.firebase.appcheck.FirebaseAppCheck;
import com.google.firebase.appcheck.playintegrity.PlayIntegrityAppCheckProviderFactory;

public class MainActivity extends BridgeActivity {
	private static final String TAG = "BearPointMain";
	private static final long LAUNCH_SPLASH_MIN_DURATION_MS = 1500L;
	static final String WEB_ASSET_REVISION = "1.0.4-ui131";

	@Override
	protected void load() {
		android.content.SharedPreferences assets = getSharedPreferences("bearpoint_web_assets", MODE_PRIVATE);
		boolean changed = !WEB_ASSET_REVISION.equals(assets.getString("revision", ""));
		if (changed) {
			// Clear only web resources before the first navigation, never local observations or settings.
			android.webkit.WebView webView = findViewById(com.getcapacitor.android.R.id.webview);
			if (webView != null) webView.clearCache(true);
		}
		super.load();
		if (changed) assets.edit().putString("revision", WEB_ASSET_REVISION).apply();
	}

	@Override
	public void onCreate(Bundle savedInstanceState) {
		Log.d(TAG, "onCreate start");
		if (!FirebaseApp.getApps(this).isEmpty()) {
			FirebaseAppCheck.getInstance().installAppCheckProviderFactory(PlayIntegrityAppCheckProviderFactory.getInstance());
		}
		registerPlugin(NativeTxtSharePlugin.class);
		registerPlugin(RtlSdrPlugin.class);
		registerPlugin(IcR30Plugin.class);
		registerPlugin(GpsTrackingPlugin.class);
		registerPlugin(BearPushPlugin.class);
		registerPlugin(AppUpdatePlugin.class);
		Log.d(TAG, "registerPlugin NativeTxtSharePlugin called");

		try {
			final long keepUntil = System.currentTimeMillis() + LAUNCH_SPLASH_MIN_DURATION_MS;
			SplashScreen splashScreen = SplashScreen.installSplashScreen(this);
			splashScreen.setKeepOnScreenCondition(() -> System.currentTimeMillis() < keepUntil);
		} catch (Throwable splashError) {
			Log.w(TAG, "Splash setup failed, fallback to default launch", splashError);
		}

		super.onCreate(savedInstanceState);
		protectSystemBarAreas();
		if (!FirebaseApp.getApps(this).isEmpty()) {
			BearMessagingService.createChannel(this);
		}
		Log.d(TAG, "onCreate end");
	}

	/** Keep every WebView dialog inside the system bars, including edge-to-edge devices. */
	private void protectSystemBarAreas() {
		android.view.View content = findViewById(android.R.id.content);
		if (content == null) return;
		content.setBackgroundColor(android.graphics.Color.BLACK);
		androidx.core.view.WindowInsetsControllerCompat controller =
			new androidx.core.view.WindowInsetsControllerCompat(getWindow(), content);
		controller.setAppearanceLightStatusBars(false);
		controller.setAppearanceLightNavigationBars(false);
		Runnable update = () -> {
			android.view.View window = getWindow().getDecorView();
			androidx.core.view.WindowInsetsCompat insets = androidx.core.view.ViewCompat.getRootWindowInsets(content);
			if (insets == null) return;
			androidx.core.graphics.Insets bars = insets.getInsets(
				androidx.core.view.WindowInsetsCompat.Type.systemBars()
					| androidx.core.view.WindowInsetsCompat.Type.displayCutout());
			int[] origin = new int[2], location = new int[2];
			window.getLocationInWindow(origin);
			content.getLocationInWindow(location);
			double[] overlap = SdrViewport.overlap(
				new int[]{origin[0], origin[1], origin[0] + window.getWidth(), origin[1] + window.getHeight()},
				new int[]{location[0], location[1], location[0] + content.getWidth(), location[1] + content.getHeight()},
				new int[]{bars.left, bars.top, bars.right, bars.bottom}, 1);
			int left = (int) Math.ceil(overlap[0]), top = (int) Math.ceil(overlap[1]);
			int right = (int) Math.ceil(overlap[2]), bottom = (int) Math.ceil(overlap[3]);
			if (content.getPaddingLeft() != left || content.getPaddingTop() != top
				|| content.getPaddingRight() != right || content.getPaddingBottom() != bottom) {
				content.setPadding(left, top, right, bottom);
			}
		};
		androidx.core.view.ViewCompat.setOnApplyWindowInsetsListener(content, (view, insets) -> {
			view.post(update);
			return insets;
		});
		content.addOnLayoutChangeListener((view, l, t, r, b, oldL, oldT, oldR, oldB) -> update.run());
		content.post(update);
		androidx.core.view.ViewCompat.requestApplyInsets(content);
	}

}
