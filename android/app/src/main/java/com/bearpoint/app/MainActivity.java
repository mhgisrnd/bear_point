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
	static final String WEB_ASSET_REVISION = "1.0.4-ui141";

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

	/** Reserve system bars once, independently of the resulting WebView layout. */
	private void protectSystemBarAreas() {
		android.view.View content = findViewById(android.R.id.content);
		if (content == null) return;
		androidx.core.view.WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
		content.setBackgroundColor(android.graphics.Color.BLACK);
		androidx.core.view.WindowInsetsControllerCompat controller =
			new androidx.core.view.WindowInsetsControllerCompat(getWindow(), content);
		controller.setAppearanceLightStatusBars(false);
		controller.setAppearanceLightNavigationBars(false);
		androidx.core.view.ViewCompat.setOnApplyWindowInsetsListener(content, (view, insets) -> {
			androidx.core.graphics.Insets bars = insets.getInsets(
				androidx.core.view.WindowInsetsCompat.Type.systemBars()
					| androidx.core.view.WindowInsetsCompat.Type.displayCutout());
			if (view.getPaddingLeft() != bars.left || view.getPaddingTop() != bars.top
				|| view.getPaddingRight() != bars.right || view.getPaddingBottom() != bars.bottom) {
				view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
			}
			// Children receive only the remaining insets; HTML must not reserve these bars again.
			// Inset (rather than consume) so keyboard information still reaches the WebView.
			return insets.inset(bars.left, bars.top, bars.right, bars.bottom);
		});
		androidx.core.view.ViewCompat.requestApplyInsets(content);
	}

}
