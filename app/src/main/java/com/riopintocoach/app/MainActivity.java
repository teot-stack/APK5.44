package com.riopintocoach.app;

import android.Manifest;
import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewClientCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
    private static final int REQUEST_PERMISSIONS = 1001;
    private static final int REQUEST_MUSIC_TREE = 2002;
    private static final String MUSIC_PREFS = "rio_pinto_music";
    private static final String MUSIC_LIBRARY = "libraryJson";
    private static final String MUSIC_FOLDER = "folderName";
    private static final String MUSIC_TREE_URI = "treeUri";

    private WebView webView;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestRuntimePermissions();

        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setGeolocationEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);

        final WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
            .build();

        webView.setWebViewClient(new WebViewClientCompat() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                callback.invoke(origin, true, false);
            }
        });

        webView.addJavascriptInterface(new AndroidBridge(), "AndroidNative");
        ensurePersistentTrainingService();
        webView.loadUrl("https://appassets.androidplatform.net/assets/www/index.html");
    }

    private void ensurePersistentTrainingService() {
        if (NativeTrainingService.instance != null) return;
        try {
            JSONObject snapshot = new JSONObject(NativeTrainingService.storedSnapshot(this));
            if (!snapshot.optBoolean("running", false) || snapshot.optBoolean("finished", false)) return;
            Intent intent = new Intent(this, NativeTrainingService.class).setAction(NativeTrainingService.ACTION_RESTORE);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(intent);
            else startService(intent);
        } catch (Exception ignored) {}
    }

    private void requestRuntimePermissions() {
        if (Build.VERSION.SDK_INT >= 33) {
            requestPermissions(new String[]{
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION,
                Manifest.permission.POST_NOTIFICATIONS
            }, REQUEST_PERMISSIONS);
        } else {
            requestPermissions(new String[]{
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION
            }, REQUEST_PERMISSIONS);
        }
    }

    private void sendServiceIntent(Intent intent, boolean foreground) {
        runOnUiThread(() -> {
            try {
                if (foreground && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(intent);
                else startService(intent);
            } catch (Exception error) {
                error.printStackTrace();
            }
        });
    }

    public class AndroidBridge {
        @JavascriptInterface public boolean isNative() { return true; }
        @JavascriptInterface public String getAndroidVersion() { return "5.4.400"; }

        @JavascriptInterface
        public void startTrainingSession(String configJson) {
            Intent intent = new Intent(MainActivity.this, NativeTrainingService.class)
                .setAction(NativeTrainingService.ACTION_START)
                .putExtra("config", configJson);
            sendServiceIntent(intent, true);
        }

        @JavascriptInterface
        public void setTrainingPaused(boolean paused) {
            Intent intent = new Intent(MainActivity.this, NativeTrainingService.class)
                .setAction(NativeTrainingService.ACTION_PAUSE)
                .putExtra("paused", paused);
            sendServiceIntent(intent, false);
        }

        @JavascriptInterface
        public void changeTrainingPhase(int phaseIndex) {
            Intent intent = new Intent(MainActivity.this, NativeTrainingService.class)
                .setAction(NativeTrainingService.ACTION_CHANGE_PHASE)
                .putExtra("phaseIndex", phaseIndex);
            sendServiceIntent(intent, false);
        }

        @JavascriptInterface
        public void stopTrainingSession() {
            Intent intent = new Intent(MainActivity.this, NativeTrainingService.class)
                .setAction(NativeTrainingService.ACTION_STOP);
            sendServiceIntent(intent, false);
        }

        @JavascriptInterface
        public String getTrainingSnapshot() {
            NativeTrainingService service = NativeTrainingService.instance;
            return service != null ? service.getSnapshotJson() : NativeTrainingService.storedSnapshot(MainActivity.this);
        }

        @JavascriptInterface
        public String getStoredTrainingConfig() {
            return NativeTrainingService.storedConfig(MainActivity.this);
        }

        @JavascriptInterface
        public void updateTrainingSettings(String settingsJson) {
            Intent intent = new Intent(MainActivity.this, NativeTrainingService.class)
                .setAction(NativeTrainingService.ACTION_SETTINGS)
                .putExtra("settings", settingsJson);
            sendServiceIntent(intent, false);
        }

        @JavascriptInterface
        public void speak(String text, double volume, double rate) {
            Intent intent = new Intent(MainActivity.this, NativeTrainingService.class)
                .setAction(NativeTrainingService.ACTION_SPEAK)
                .putExtra("text", text)
                .putExtra("volume", (float) volume)
                .putExtra("rate", (float) rate);
            sendServiceIntent(intent, false);
        }

        @JavascriptInterface
        public void chooseMusicFolder() {
            runOnUiThread(() -> {
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                    | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
                    | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
                startActivityForResult(intent, REQUEST_MUSIC_TREE);
            });
        }

        @JavascriptInterface
        public void reindexMusicFolder() {
            String uriText = getSharedPreferences(MUSIC_PREFS, MODE_PRIVATE).getString(MUSIC_TREE_URI, "");
            if (uriText.isEmpty()) {
                chooseMusicFolder();
                return;
            }
            evaluateJs("window.RioPintoNative?.onMusicStatus('indexing','Reindexando carpeta musical…')");
            executor.execute(() -> indexMusicTree(Uri.parse(uriText)));
        }

        @JavascriptInterface
        public String getMusicLibraryJson() {
            return getSharedPreferences(MUSIC_PREFS, MODE_PRIVATE).getString(MUSIC_LIBRARY, "[]");
        }

        @JavascriptInterface
        public String getMusicFolderName() {
            return getSharedPreferences(MUSIC_PREFS, MODE_PRIVATE).getString(MUSIC_FOLDER, "Sin carpeta seleccionada");
        }

        @JavascriptInterface
        public void setMusicQueue(String queueJson, int startIndex, double volume, boolean paused, boolean loopSingle) {
            Intent intent = new Intent(MainActivity.this, NativeTrainingService.class)
                .setAction(NativeTrainingService.ACTION_SET_MUSIC_QUEUE)
                .putExtra("queue", queueJson)
                .putExtra("startIndex", startIndex)
                .putExtra("volume", (float) volume)
                .putExtra("paused", paused)
                .putExtra("loopSingle", loopSingle);
            sendServiceIntent(intent, false);
        }

        @JavascriptInterface public void pauseMusic() {
            sendServiceIntent(new Intent(MainActivity.this, NativeTrainingService.class).setAction(NativeTrainingService.ACTION_MUSIC_PAUSE), false);
        }
        @JavascriptInterface public void resumeMusic() {
            sendServiceIntent(new Intent(MainActivity.this, NativeTrainingService.class).setAction(NativeTrainingService.ACTION_MUSIC_RESUME), false);
        }
        @JavascriptInterface public void nextMusic() {
            sendServiceIntent(new Intent(MainActivity.this, NativeTrainingService.class).setAction(NativeTrainingService.ACTION_MUSIC_NEXT), false);
        }
        @JavascriptInterface public void stopMusic() {
            sendServiceIntent(new Intent(MainActivity.this, NativeTrainingService.class).setAction(NativeTrainingService.ACTION_MUSIC_STOP), false);
        }
        @JavascriptInterface public void setMusicVolume(double volume) {
            Intent intent = new Intent(MainActivity.this, NativeTrainingService.class)
                .setAction(NativeTrainingService.ACTION_MUSIC_VOLUME)
                .putExtra("volume", (float) volume);
            sendServiceIntent(intent, false);
        }
        @JavascriptInterface public boolean isMusicPlaying() {
            NativeTrainingService service = NativeTrainingService.instance;
            return service != null && service.isMusicPlaying();
        }
        @JavascriptInterface public int getMusicPositionMs() {
            NativeTrainingService service = NativeTrainingService.instance;
            return service != null ? service.getMusicPositionMs() : 0;
        }
        @JavascriptInterface public String getCurrentMusicName() {
            NativeTrainingService service = NativeTrainingService.instance;
            return service != null ? service.getCurrentMusicName() : "";
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQUEST_MUSIC_TREE || resultCode != RESULT_OK || data == null || data.getData() == null) return;
        Uri treeUri = data.getData();
        try {
            getContentResolver().takePersistableUriPermission(treeUri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (Exception ignored) {}
        evaluateJs("window.RioPintoNative?.onMusicStatus('indexing','Indexando carpeta musical…')");
        executor.execute(() -> indexMusicTree(treeUri));
    }

    private void indexMusicTree(Uri treeUri) {
        JSONArray tracks = new JSONArray();
        String folderName = queryDisplayName(treeUri);
        try {
            String rootDocumentId = DocumentsContract.getTreeDocumentId(treeUri);
            scanDocumentTree(treeUri, rootDocumentId, "", tracks);
            SharedPreferences prefs = getSharedPreferences(MUSIC_PREFS, MODE_PRIVATE);
            prefs.edit()
                .putString(MUSIC_LIBRARY, tracks.toString())
                .putString(MUSIC_FOLDER, folderName)
                .putString(MUSIC_TREE_URI, treeUri.toString())
                .apply();
            String js = "window.RioPintoNative?.onMusicLibrary("
                + JSONObject.quote(tracks.toString()) + ","
                + JSONObject.quote(folderName) + ")";
            evaluateJs(js);
        } catch (Exception error) {
            evaluateJs("window.RioPintoNative?.onMusicStatus('error','No se pudo indexar la carpeta musical.')");
        }
    }

    private void scanDocumentTree(Uri treeUri, String parentDocumentId, String prefix, JSONArray tracks) {
        Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, parentDocumentId);
        String[] projection = {
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE
        };
        try (Cursor cursor = getContentResolver().query(childrenUri, projection, null, null, null)) {
            if (cursor == null) return;
            int idIndex = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DOCUMENT_ID);
            int nameIndex = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DISPLAY_NAME);
            int mimeIndex = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_MIME_TYPE);
            while (cursor.moveToNext()) {
                String documentId = cursor.getString(idIndex);
                String name = cursor.getString(nameIndex);
                String mime = cursor.getString(mimeIndex);
                String path = prefix.isEmpty() ? name : prefix + "/" + name;
                if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) {
                    scanDocumentTree(treeUri, documentId, path, tracks);
                } else if (isMusicFile(name, mime)) {
                    Uri documentUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, documentId);
                    JSONObject track = new JSONObject();
                    try {
                        track.put("name", name);
                        track.put("path", path);
                        track.put("nativeUri", documentUri.toString());
                        track.put("bpm", extractBpm(name));
                        track.put("energy", inferEnergy(path));
                        tracks.put(track);
                    } catch (Exception ignored) {}
                }
            }
        } catch (Exception ignored) {}
    }

    private static boolean isMusicFile(String name, String mime) {
        String lower = name == null ? "" : name.toLowerCase(Locale.ROOT);
        boolean extension = lower.matches(".*\\.(mp3|m4a|aac|ogg|oga|wav|flac|opus)$");
        return extension || (mime != null && mime.startsWith("audio/"));
    }

    private static int extractBpm(String name) {
        if (name == null) return 0;
        java.util.regex.Matcher matcher = java.util.regex.Pattern
            .compile("(?:^|[^0-9])(\\d{2,3})\\s*(?:bpm)?(?:[^0-9]|$)", java.util.regex.Pattern.CASE_INSENSITIVE)
            .matcher(name);
        if (!matcher.find()) return 0;
        try {
            int value = Integer.parseInt(matcher.group(1));
            return value >= 50 && value <= 200 ? value : 0;
        } catch (Exception ignored) { return 0; }
    }

    private static String inferEnergy(String text) {
        String value = text == null ? "" : text.toLowerCase(Locale.ROOT);
        if (value.matches(".*(recup|relax|suave|ambient|calma|chill).*$")) return "low";
        if (value.matches(".*(rock|metal|power|intenso|hard|vo2|sprint).*$")) return "high";
        return "medium";
    }

    private String queryDisplayName(Uri uri) {
        String result = "Carpeta musical";
        try (Cursor cursor = getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (index >= 0) result = cursor.getString(index);
            }
        } catch (Exception ignored) {}
        return result == null || result.isEmpty() ? "Carpeta musical" : result;
    }

    private void evaluateJs(String code) {
        runOnUiThread(() -> {
            if (webView != null) webView.evaluateJavascript(code, null);
        });
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        executor.shutdownNow();
        if (webView != null) webView.destroy();
        super.onDestroy();
    }
}
